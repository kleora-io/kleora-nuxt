/**
 * `$kleoraApi` — a `$fetch` instance for calling the Kleora management API
 * (or any API that accepts the same access token) from the browser.
 *
 * Three things it adds to a bare `$fetch`: the bearer from
 * `getAccessToken()`, RFC 9457 problem documents turned into `ApiError`, and
 * one retry with a *forced* refresh when the answer is 401. No cookies are
 * ever sent — the management API authenticates by bearer only, and a
 * credentialled cross-origin request would be refused before it left the
 * browser.
 */

import { ApiError } from '@kleora-io/browser'
import { $fetch } from 'ofetch'
import type { $Fetch, FetchContext, FetchResponse } from 'ofetch'

/**
 * ofetch's own default set, given in full because `retryStatusCodes` replaces
 * it rather than extending it.
 *
 * 401 is deliberately absent: it is handled below, once, with a forced token
 * refresh, and for every method — unlike these, which follow ofetch's rule
 * that a request which may have been acted on is not re-sent.
 */
export const RETRY_STATUS_CODES = [408, 409, 425, 429, 500, 502, 503, 504]

/** The methods ofetch declines to retry, because re-sending one repeats it. */
const PAYLOAD_METHODS = new Set(['PATCH', 'POST', 'PUT', 'DELETE'])

/**
 * Marks the one retry a 401 is allowed, and carries into it.
 *
 * A plain property rather than a `WeakSet`: ofetch re-enters the retry with
 * `{ ...context.options }`, so a key on the object survives and an identity
 * does not. `fetch` ignores members of `RequestInit` it does not know, which
 * is already true of `retry`, `baseURL` and the rest.
 */
const FORCED_REFRESH = '__kleoraForcedRefresh'

interface ForcedRefreshCarrier {
  [FORCED_REFRESH]?: boolean
}

function carrier(context: FetchContext): ForcedRefreshCarrier {
  return context.options as ForcedRefreshCarrier
}

function forcedRefresh(context: FetchContext): boolean {
  return carrier(context)[FORCED_REFRESH] === true
}

export interface KleoraApiOptions {
  /** `NUXT_PUBLIC_API_BASE`. */
  baseURL: string
  /** The SDK's `getAccessToken()`; throws `LoginRequired` when signed out. */
  getAccessToken: (options?: { force?: boolean }) => Promise<string>
  /**
   * Called when a 401 has survived the forced-refresh retry.
   *
   * It is a request to consider signing in again, not an instruction: the
   * caller decides, and the breaker in `./unauthenticated` is what keeps the
   * decision from repeating.
   */
  onUnauthenticated?: () => void
}

/**
 * What `ApiError` has no room for, carried alongside it.
 *
 * `ApiError` is the browser SDK's shape and holds `type`, `status`, `detail`
 * and `errors` — enough to branch on, and not enough to render. A user
 * interface wants to show the `request_id` of a 5xx, count down a 429's
 * `Retry-After` and recognise an idempotent replay, and all four of `title`,
 * `instance`, `request_id` and the response headers are gone by the time the
 * error reaches a page. So the whole document is attached to the error under
 * `problem`, rather than widening a class this package does not own.
 */
export interface ProblemDetails {
  /** The RFC 9457 document as it arrived, extension members included. */
  document: Record<string, unknown>
  /** `Retry-After` in seconds, falling back to the document's `retry_after`. */
  retryAfter: number | null
  /** `Idempotency-Replayed`: `true`, `unavailable`, or absent. */
  idempotencyReplayed: string | null
}

/** An `ApiError` this module threw, with the document it was built from. */
export interface ProblemCarrier {
  problem?: ProblemDetails
}

/** `Retry-After` as whole seconds, ignoring the HTTP-date form we never send. */
function retryAfterOf(response: FetchResponse<unknown>, document: Record<string, unknown>): number | null {
  // `Number(null)` is 0 and `Number('')` is 0, so an absent header would read
  // as "retry immediately" rather than as "no advice".
  const raw = response.headers.get('retry-after')
  const header = raw === null || raw.trim() === '' ? Number.NaN : Number(raw)
  if (Number.isFinite(header) && header >= 0) return header
  const fromDocument = document['retry_after']
  return typeof fromDocument === 'number' && Number.isFinite(fromDocument) ? fromDocument : null
}

/** The RFC 9457 document a management-API failure carries, as an `ApiError`. */
export function toApiError(response: FetchResponse<unknown>): ApiError {
  const body: unknown = response._data
  const document = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const errors = document['errors']
  const error = new ApiError(
    typeof document['type'] === 'string' ? document['type'] : 'about:blank',
    response.status,
    typeof document['detail'] === 'string'
      ? document['detail']
      : response.statusText || undefined,
    Array.isArray(errors) ? (errors as unknown[]) : undefined,
  )
  const details: ProblemDetails = {
    document,
    retryAfter: retryAfterOf(response, document),
    idempotencyReplayed: response.headers.get('idempotency-replayed'),
  }
  return Object.assign(error, { problem: details })
}

/**
 * How many attempts ofetch has left, by its own rules.
 *
 * Mirrored rather than assumed: `onResponseError` runs *before* the retry
 * decision, so this hook has to predict it exactly. Throwing when ofetch
 * would have retried cancels the retry; returning when it would not have
 * swallows the error and answers `undefined` to the caller.
 */
export function retriesLeft(context: FetchContext): number {
  const retry = context.options.retry
  if (retry === false) return 0
  if (typeof retry === 'number') return retry
  // The default: one retry for a safe method, none for one that mutates.
  return PAYLOAD_METHODS.has((context.options.method ?? 'GET').toUpperCase()) ? 0 : 1
}

/** Whether ofetch is about to try this request again. */
export function willRetry(context: FetchContext & { response: FetchResponse<unknown> }): boolean {
  const codes = context.options.retryStatusCodes ?? RETRY_STATUS_CODES
  return retriesLeft(context) > 0 && codes.includes(context.response.status)
}

export function createKleoraApi(options: KleoraApiOptions): $Fetch {
  return $fetch.create({
    baseURL: options.baseURL,
    credentials: 'omit',
    // `retry` is deliberately left to ofetch for everything but 401: one
    // attempt for a safe method, none for one that mutates. Forcing `retry: 1`
    // here would re-send a POST the server may already have processed — a 502
    // after a successful write would create the resource twice.
    retryDelay: 0,
    retryStatusCodes: RETRY_STATUS_CODES,
    async onRequest(context) {
      // On the server this throws `LoginRequired`, which is intended: during
      // server-side rendering there is no session, only the browser has one.
      const token = await options.getAccessToken(
        forcedRefresh(context) ? { force: true } : undefined,
      )
      context.options.headers.set('Authorization', `Bearer ${token}`)
    },
    onResponseError(context) {
      if (context.response.status === 401) {
        if (!forcedRefresh(context)) {
          // The one retry a 401 gets, whatever the method: the request was
          // refused before it was acted on, so re-sending it repeats nothing.
          // Without `force` the SDK would hand back the very token that was
          // just rejected and the retry would be a wasted round trip.
          carrier(context)[FORCED_REFRESH] = true
          context.options.retry = 1
          context.options.retryStatusCodes = [401]
          return
        }
        options.onUnauthenticated?.()
        throw toApiError(context.response)
      }
      if (willRetry(context)) return
      throw toApiError(context.response)
    },
  })
}

/**
 * The type `$kleoraApi` and `useApi()` carry.
 *
 * Re-exported from the package root so an application can name it without
 * depending on `ofetch` directly — under a strict node_modules layout it has
 * no reason to have it installed.
 */
export type KleoraApi = $Fetch
