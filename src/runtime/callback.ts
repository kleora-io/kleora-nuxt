/**
 * What the `/auth/callback` page does, minus the rendering.
 *
 * Three arrivals end up here. An authorization response carries `code` (or
 * `error`) and is redeemed. A hosted-login page visited directly ends its
 * `session_only` AuthRequest by sending the browser to `redirectUri` with no
 * parameters at all, and the
 * tokens come from `restore()` if this tab can recover a session without the
 * issuer, or the arrival is reported. And a `code`
 * whose login was started in *another tab* — the one a verification link was
 * opened from finishes the flow it was carrying — cannot be redeemed here at
 * all, and tries `restore()` too before one bounded login of its own.
 */

import { EnvironmentMismatch, LoginRequired } from '@kleora-io/browser'
import type { CallbackResult } from '@kleora-io/browser'

/** Where the page goes next, or why it cannot go anywhere. */
export type CallbackOutcome =
  | { kind: 'redirect'; to: string }
  /** A login of this tab's own is in flight; the page keeps waiting. */
  | { kind: 'pending' }
  | { kind: 'error'; error: unknown }

export interface CallbackDeps {
  /** `location.search` of the callback URL. */
  search: string
  handleRedirectCallback: () => Promise<CallbackResult>
  /** Idempotent `checkSession()`, for the parameterless arrival. */
  restore: () => Promise<void>
  isAuthenticated: () => boolean
  /**
   * Start a login this tab owns, for a response it cannot redeem.
   * `false` when the circuit breaker refuses — see `unauthenticated.ts`,
   * which bounds this at one round trip.
   */
  relogin: () => boolean
  /** Where to go when the login carried no `returnTo`. */
  fallback: string
}

const NO_SILENT_SESSION =
  'the callback URL carries no authorization response and no session could be recovered'

/**
 * A `returnTo` that is safe to hand to the router.
 *
 * Only a path on this site. `appState` survived a round trip through the
 * issuer and back through the address bar, so treating it as a URL would turn
 * any tampered login link into an open redirect. `//evil.example` and
 * `/\evil.example` are both protocol-relative to a browser, which is why a
 * leading slash alone is not the test.
 */
export function returnToOf(appState: unknown, fallback: string): string {
  if (typeof appState !== 'object' || appState === null || Array.isArray(appState)) return fallback
  const candidate = (appState as { returnTo?: unknown }).returnTo
  if (typeof candidate !== 'string') return fallback
  if (!candidate.startsWith('/')) return fallback
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback
  return candidate
}

/** Complete the redirect and say where the browser should go next. */
export async function completeCallback(deps: CallbackDeps): Promise<CallbackOutcome> {
  const params = new URLSearchParams(deps.search)

  if (!params.has('code') && !params.has('error')) {
    await deps.restore()
    return deps.isAuthenticated()
      ? { kind: 'redirect', to: deps.fallback }
      : { kind: 'error', error: new LoginRequired(NO_SILENT_SESSION) }
  }

  try {
    const result = await deps.handleRedirectCallback()
    return { kind: 'redirect', to: returnToOf(result.appState, deps.fallback) }
  } catch (error) {
    // A response carrying a `code` this tab cannot redeem is not necessarily a
    // failed sign-in. The verifier and the `state` of a login live in the tab
    // that started it (`sessionStorage`), and a link in an email opens in a tab
    // of the mail client's choosing: confirming an address there finishes the
    // flow *there*, and the code arrives in a tab that never asked for one
    // The sign-in itself really happened — the issuer's session cookie
    // is the browser's, not the tab's — so the same `restore()` the
    // parameterless arrival makes is tried first, and a login this tab owns
    // after it, before anything is reported.
    //
    // Only for a `code`. An `error=` response is the issuer saying no, and
    // recovering a session after one would sign somebody in past a refusal.
    //
    // `restore()` can only recover what this tab already holds (a refresh
    // token under `session` storage); it never asks the issuer.
    // So the usual way through is a login this tab *does* own. The person is already signed
    // in at the issuer, so it costs a redirect nobody sees, and it comes back
    // with a code whose verifier is in this tab.
    //
    // A second `loginWithRedirect()` here could, in principle, become an
    // infinite round trip through the issuer, and `relogin` is the circuit
    // breaker that bounds it at one — a second failure inside the cooldown
    // refuses, and the reason the redemption failed is shown after all.
    //
    // `EnvironmentMismatch` is never recovered from: a sandbox token against a
    // production issuer (or the other way round) is a configuration fault to
    // surface, and every other place in this package treats it that way.
    if (params.has('code') && !params.has('error') && !(error instanceof EnvironmentMismatch)) {
      try {
        await deps.restore()
        if (deps.isAuthenticated()) return { kind: 'redirect', to: deps.fallback }
      }
      catch (silent) {
        // A mismatch found by `restore()` is the same configuration fault
        // as one found by the redemption, and it is the one worth reading: a
        // login started against that configuration would repeat it, and the
        // page would then be showing `invalid_state` about a code that was
        // never the problem. So it surfaces in place of that message.
        if (silent instanceof EnvironmentMismatch) return { kind: 'error', error: silent }
        // Anything else — a dead network, a refused refresh — is not a reason to
        // leave the page spinning: fall through to the login below, and to the
        // original error after it.
      }
      if (deps.relogin()) return { kind: 'pending' }
    }
    return { kind: 'error', error }
  }
}
