/**
 * `$kleoraApi`: the bearer, the RFC 9457 translation, and the single retry.
 */

import { ApiError, LoginRequired } from '@kleora-io/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKleoraApi, type ProblemCarrier } from '../src/runtime/api'

interface Call {
  url: string
  authorization: string | null
}

function stubFetch(responses: Response[]): Call[] {
  const calls: Call[] = []
  const queue = [...responses]
  vi.stubGlobal('fetch', (request: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    calls.push({ url: request, authorization: headers.get('authorization') })
    const next = queue.shift()
    if (next === undefined) throw new Error('unexpected extra request')
    return Promise.resolve(next)
  })
  return calls
}

function problem(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createKleoraApi', () => {
  it('sends the SDK bearer on every call, and no cookies', async () => {
    const calls = stubFetch([
      new Response(JSON.stringify({ name: 'kleora-management-api' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
    })

    await expect(api('/')).resolves.toEqual({ name: 'kleora-management-api' })
    expect(calls).toEqual([
      { url: 'http://api.localhost:8100/api/v1', authorization: 'Bearer at-1' },
    ])
  })

  it('fails the request when there is no session, rather than calling anonymously', async () => {
    const calls = stubFetch([])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.reject(new LoginRequired('no refresh token')),
    })

    await expect(api('/')).rejects.toBeInstanceOf(LoginRequired)
    expect(calls).toEqual([])
  })

  it('turns a problem document into an ApiError', async () => {
    stubFetch([
      problem(422, {
        type: 'https://kleora.io/problems/validation-error',
        status: 422,
        detail: '1 field invalid.',
        errors: [{ field: 'slug', message: 'Already taken.', code: 'conflict' }],
      }),
    ])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
    })

    const error = await api('/apps', { method: 'POST', body: {} }).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      type: 'https://kleora.io/problems/validation-error',
      status: 422,
      detail: '1 field invalid.',
      errors: [{ field: 'slug', message: 'Already taken.', code: 'conflict' }],
    })
  })

  it('retries a 401 once with a FORCED refresh, then gives up on the session', async () => {
    const calls = stubFetch([
      problem(401, { type: 'https://kleora.io/problems/unauthenticated', status: 401 }),
      problem(401, { type: 'https://kleora.io/problems/unauthenticated', status: 401 }),
    ])
    const tokens = ['at-stale', 'at-fresh']
    const asked: ({ force?: boolean } | undefined)[] = []
    const onUnauthenticated = vi.fn()
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: (tokenOptions) => {
        asked.push(tokenOptions)
        return Promise.resolve(tokens.shift() ?? 'at-exhausted')
      },
      onUnauthenticated,
    })

    await expect(api('/me')).rejects.toBeInstanceOf(ApiError)
    expect(calls.map((call) => call.authorization)).toEqual([
      'Bearer at-stale',
      'Bearer at-fresh',
    ])
    // Without `force` the SDK hands back the token that was just rejected and
    // the retry is a wasted round trip.
    expect(asked).toEqual([undefined, { force: true }])
    expect(onUnauthenticated).toHaveBeenCalledOnce()
  })

  it('retries a 401 on a write too, because a refused request was never acted on', async () => {
    const calls = stubFetch([
      problem(401, { type: 'https://kleora.io/problems/unauthenticated', status: 401 }),
      new Response(JSON.stringify({ id: 'app-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    ])
    const asked: ({ force?: boolean } | undefined)[] = []
    const onUnauthenticated = vi.fn()
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: (tokenOptions) => {
        asked.push(tokenOptions)
        return Promise.resolve('at-1')
      },
      onUnauthenticated,
    })

    await expect(api('/apps', { method: 'POST', body: { name: 'Acme' } })).resolves.toEqual({
      id: 'app-1',
    })
    expect(calls).toHaveLength(2)
    expect(asked).toEqual([undefined, { force: true }])
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('does not announce a lost session when the forced retry succeeds', async () => {
    stubFetch([
      problem(401, { type: 'https://kleora.io/problems/unauthenticated', status: 401 }),
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ])
    const onUnauthenticated = vi.fn()
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
      onUnauthenticated,
    })

    await expect(api('/me')).resolves.toEqual({ ok: true })
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('asks about the session exactly once, however many 401s a page collects', async () => {
    stubFetch([
      problem(401, {}),
      problem(401, {}),
      problem(401, {}),
      problem(401, {}),
    ])
    const onUnauthenticated = vi.fn()
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
      onUnauthenticated,
    })

    const results = await Promise.allSettled([api('/me'), api('/apps')])

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    // Two calls, two forced retries, two reports — the breaker in
    // `./unauthenticated` is what turns them into one redirect.
    expect(onUnauthenticated).toHaveBeenCalledTimes(2)
  })

  it('reports a body that is not a problem document as an ApiError all the same', async () => {
    stubFetch([new Response('<html>gateway</html>', { status: 502 })])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
    })

    await expect(api('/', { retry: 0 })).rejects.toMatchObject({
      name: 'ApiError',
      type: 'about:blank',
      status: 502,
    })
  })

  it('never re-sends a write the server may already have processed', async () => {
    // ofetch does not retry a payload method, and this instance must not
    // override that: a 502 after a successful POST would create the resource
    // twice, which is a worse failure than the one a retry was to fix.
    const calls = stubFetch([problem(502, {})])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
    })

    await expect(api('/apps', { method: 'POST', body: {} })).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
    })
    expect(calls).toHaveLength(1)
  })

  it('retries a safe method that ofetch would retry, and no more', async () => {
    const calls = stubFetch([
      problem(503, {}),
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
    })

    await expect(api('/apps')).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('carries the whole problem document, and the two headers, on the error', async () => {
    stubFetch([
      new Response(
        JSON.stringify({
          type: 'https://kleora.io/problems/rate-limited',
          title: 'Too many requests',
          status: 429,
          request_id: 'req_01J',
          retry_after: 30,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/problem+json',
            'Retry-After': '17',
            'Idempotency-Replayed': 'unavailable',
          },
        },
      ),
    ])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
      // Nothing here retries a 429: `retry` is 0 for a write.
    })

    const error = await api('/accounts', { method: 'POST', body: {} }).catch(
      (raised: unknown) => raised as ApiError & ProblemCarrier,
    )

    expect(error).toBeInstanceOf(ApiError)
    // The header wins over the document's mirror of it — they agree in
    // production, and a proxy that rewrote one did not rewrite the other.
    expect(error.problem?.retryAfter).toBe(17)
    expect(error.problem?.idempotencyReplayed).toBe('unavailable')
    expect(error.problem?.document['request_id']).toBe('req_01J')
    expect(error.problem?.document['title']).toBe('Too many requests')
  })

  it('falls back to the document when Retry-After is an HTTP date', async () => {
    stubFetch([
      new Response(
        JSON.stringify({
          type: 'https://kleora.io/problems/rate-limited',
          status: 429,
          retry_after: 30,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/problem+json',
            // RFC 9110 allows this form. We never send it, and an
            // intermediary that rewrote the header might: read as a number it
            // is `NaN`, and the document still says what the wait is.
            'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT',
          },
        },
      ),
    ])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
    })

    const error = await api('/accounts', { method: 'POST', body: {} }).catch(
      (raised: unknown) => raised as ApiError & ProblemCarrier,
    )

    expect(error.problem?.retryAfter).toBe(30)
  })

  it('reports no retry-after and no replay marker when the response carries neither', async () => {
    stubFetch([problem(500, { type: 'about:blank', title: 'Server error', status: 500 })])
    const api = createKleoraApi({
      baseURL: 'http://api.localhost:8100/api/v1',
      getAccessToken: () => Promise.resolve('at-1'),
    })

    const error = await api('/apps', { method: 'POST', body: {} }).catch(
      (raised: unknown) => raised as ApiError & ProblemCarrier,
    )

    expect(error.problem?.retryAfter).toBeNull()
    expect(error.problem?.idempotencyReplayed).toBeNull()
  })
})
