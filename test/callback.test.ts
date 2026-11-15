/**
 * `/auth/callback`: what it redeems, where it goes next, and what it refuses
 * to treat as a destination.
 */

import { EnvironmentMismatch, LoginRequired, KleoraError } from '@kleora-io/browser'
import { describe, expect, it, vi } from 'vitest'
import { completeCallback, returnToOf, type CallbackDeps } from '../src/runtime/callback'

function deps(overrides: Partial<CallbackDeps> = {}): CallbackDeps {
  return {
    search: '?code=abc&state=xyz&iss=http%3A%2F%2Fid.localhost',
    handleRedirectCallback: () => Promise.resolve({}),
    restore: () => Promise.resolve(),
    isAuthenticated: () => false,
    // The breaker refuses by default, so a test that wants the last resort has
    // to say so.
    relogin: () => false,
    fallback: '/',
    ...overrides,
  }
}

describe('returnToOf', () => {
  it('takes a path off the appState', () => {
    expect(returnToOf({ returnTo: '/apps?page=2' }, '/')).toBe('/apps?page=2')
  })

  it('falls back when there is nothing usable', () => {
    expect(returnToOf(undefined, '/')).toBe('/')
    expect(returnToOf(null, '/')).toBe('/')
    expect(returnToOf({}, '/')).toBe('/')
    expect(returnToOf({ returnTo: 42 }, '/')).toBe('/')
    expect(returnToOf(['/apps'], '/')).toBe('/')
  })

  it('refuses anything that could leave this site', () => {
    // `appState` survived a round trip through the address bar, so a tampered
    // login link must not be able to choose the destination.
    expect(returnToOf({ returnTo: 'https://evil.example/' }, '/')).toBe('/')
    expect(returnToOf({ returnTo: '//evil.example/' }, '/')).toBe('/')
    expect(returnToOf({ returnTo: '/\\evil.example/' }, '/')).toBe('/')
    expect(returnToOf({ returnTo: 'apps' }, '/')).toBe('/')
  })
})

describe('completeCallback', () => {
  it('redeems the code and goes where the login started', async () => {
    const handleRedirectCallback = vi.fn(() =>
      Promise.resolve({ appState: { returnTo: '/apps/acme' } }),
    )
    await expect(completeCallback(deps({ handleRedirectCallback }))).resolves.toEqual({
      kind: 'redirect',
      to: '/apps/acme',
    })
    expect(handleRedirectCallback).toHaveBeenCalledOnce()
  })

  it('goes to the fallback when the login carried no returnTo', async () => {
    await expect(completeCallback(deps({ fallback: '/apps' }))).resolves.toEqual({
      kind: 'redirect',
      to: '/apps',
    })
  })

  it('reports a refused redemption instead of starting another login', async () => {
    // The silent check is tried (the login may have been completed in another
    // tab), and when it recovers nothing the original failure is what the page
    // shows — never a second `loginWithRedirect`.
    const failure = new KleoraError('invalid_state', 'unknown state')
    const handleRedirectCallback = vi.fn(() => Promise.reject(failure))
    const restore = vi.fn(() => Promise.resolve())
    await expect(
      completeCallback(deps({ handleRedirectCallback, restore })),
    ).resolves.toEqual({ kind: 'error', error: failure })
    expect(restore).toHaveBeenCalledOnce()
  })

  it('recovers the session when the login was completed in another tab', async () => {
    // A verification link opens in a tab of the mail client's choosing,
    // and confirming there finishes the flow there. The code arrives in a tab
    // that never started a login, so its verifier and `state` are missing —
    // but the issuer's session cookie is the browser's, and the silent check
    // in this tab has everything it needs.
    const handleRedirectCallback = vi.fn(() =>
      Promise.reject(new KleoraError('invalid_state', 'unknown state')),
    )
    let authenticated = false
    const outcome = await completeCallback(
      deps({
        handleRedirectCallback,
        restore: () => {
          authenticated = true
          return Promise.resolve()
        },
        isAuthenticated: () => authenticated,
        fallback: '/apps',
      }),
    )
    expect(outcome).toEqual({ kind: 'redirect', to: '/apps' })
  })

  it('starts one login of its own when nothing else can recover the session', async () => {
    // The silent check cannot reach the session — the issuer is on another
    // site, or third-party cookies are blocked — but the person is signed in
    // there, so a login this tab owns comes back with a code it can redeem.
    // The breaker bounds it: a second failure inside the cooldown refuses, and
    // the original error is shown after all.
    const handleRedirectCallback = vi.fn(() =>
      Promise.reject(new KleoraError('invalid_state', 'unknown state')),
    )
    const relogin = vi.fn(() => true)

    const outcome = await completeCallback(deps({ handleRedirectCallback, relogin }))

    expect(outcome).toEqual({ kind: 'pending' })
    expect(relogin).toHaveBeenCalledOnce()
  })

  it('never recovers past an `error` that arrived beside a `code`', async () => {
    // A response carrying both is still the issuer saying no. Reading only the
    // `code` would recover a session past a refusal.
    const failure = new KleoraError('access_denied', 'the person said no')
    const handleRedirectCallback = vi.fn(() => Promise.reject(failure))
    const restore = vi.fn(() => Promise.resolve())
    const relogin = vi.fn(() => true)

    const outcome = await completeCallback(
      deps({
        search: '?error=access_denied&code=x&state=xyz',
        handleRedirectCallback,
        restore,
        relogin,
      }),
    )

    expect(outcome).toEqual({ kind: 'error', error: failure })
    expect(restore).not.toHaveBeenCalled()
    expect(relogin).not.toHaveBeenCalled()
  })

  it('reports a mismatched environment instead of recovering from it', async () => {
    // A sandbox client against a production issuer is a configuration fault,
    // and a login started against the same configuration would repeat it.
    const failure = new EnvironmentMismatch('sandbox token, production issuer')
    const handleRedirectCallback = vi.fn(() => Promise.reject(failure))
    const restore = vi.fn(() => Promise.resolve())
    const relogin = vi.fn(() => true)

    const outcome = await completeCallback(deps({ handleRedirectCallback, restore, relogin }))

    expect(outcome).toEqual({ kind: 'error', error: failure })
    expect(restore).not.toHaveBeenCalled()
    expect(relogin).not.toHaveBeenCalled()
  })

  it('still recovers when the silent check itself rejects', async () => {
    // `restore()` rethrows an environment mismatch of its own; a rejection
    // escaping here would leave the page spinning on "signing you in".
    const failure = new KleoraError('invalid_state', 'unknown state')
    const handleRedirectCallback = vi.fn(() => Promise.reject(failure))
    const restore = vi.fn(() => Promise.reject(new Error('the silent check blew up')))
    const relogin = vi.fn(() => true)

    const outcome = await completeCallback(deps({ handleRedirectCallback, restore, relogin }))

    expect(outcome).toEqual({ kind: 'pending' })
    expect(relogin).toHaveBeenCalledOnce()
  })

  it('surfaces a mismatched environment found by the silent check', async () => {
    // The redemption failed for a reason that says nothing useful; the silent
    // check found the real one. A login would only repeat the misconfiguration.
    const mismatch = new EnvironmentMismatch('sandbox client, production issuer')
    const handleRedirectCallback = vi.fn(() =>
      Promise.reject(new KleoraError('invalid_state', 'unknown state')),
    )
    const relogin = vi.fn(() => true)

    const outcome = await completeCallback(
      deps({ handleRedirectCallback, restore: () => Promise.reject(mismatch), relogin }),
    )

    expect(outcome).toEqual({ kind: 'error', error: mismatch })
    expect(relogin).not.toHaveBeenCalled()
  })

  it('reports the original failure when the breaker refuses the last resort', async () => {
    // No `sessionStorage`, so nothing can bound a second attempt: the page
    // says what went wrong rather than spinning.
    const failure = new KleoraError('invalid_state', 'unknown state')
    const handleRedirectCallback = vi.fn(() => Promise.reject(failure))
    const restore = vi.fn(() => Promise.reject(new Error('no session to be had')))

    const outcome = await completeCallback(
      deps({ handleRedirectCallback, restore, relogin: () => false }),
    )

    expect(outcome).toEqual({ kind: 'error', error: failure })
  })

  it('hands an `error` response to the SDK, which names it', async () => {
    // And recovers nothing: `error=` is the issuer saying no, and a session
    // found afterwards would be signing somebody in past a refusal.
    const failure = new KleoraError('access_denied', 'the person said no')
    const handleRedirectCallback = vi.fn(() => Promise.reject(failure))
    const restore = vi.fn(() => Promise.resolve())
    const relogin = vi.fn(() => true)
    const outcome = await completeCallback(
      deps({
        search: '?error=access_denied&state=xyz',
        handleRedirectCallback,
        restore,
        relogin,
      }),
    )
    expect(outcome).toEqual({ kind: 'error', error: failure })
    expect(restore).not.toHaveBeenCalled()
    expect(relogin).not.toHaveBeenCalled()
  })

  it('recovers the session silently when the URL carries no response at all', async () => {
    // A direct visit to the hosted `/login` page ends its
    // `session_only` request by sending the browser here with no parameters.
    const handleRedirectCallback = vi.fn(() => Promise.resolve({}))
    let authenticated = false
    const outcome = await completeCallback(
      deps({
        search: '',
        handleRedirectCallback,
        restore: () => {
          authenticated = true
          return Promise.resolve()
        },
        isAuthenticated: () => authenticated,
      }),
    )
    expect(outcome).toEqual({ kind: 'redirect', to: '/' })
    expect(handleRedirectCallback).not.toHaveBeenCalled()
  })

  it('reports LoginRequired when the parameterless arrival has no session either', async () => {
    const outcome = await completeCallback(deps({ search: '' }))
    expect(outcome.kind).toBe('error')
    expect((outcome as { error: unknown }).error).toBeInstanceOf(LoginRequired)
  })
})
