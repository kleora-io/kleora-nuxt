/**
 * The decision a shell renders by: shell-with-skeletons, or redirect — with
 * no Nuxt in sight, so it is tested as the small state machine it is.
 *
 * The behaviour it encodes: with a session to check, show the app shell with
 * skeleton loaders, validate the session and hydrate once it is valid; if it
 * is not valid, redirect to login. Only when there is no session to check at
 * all (a fresh browser, which certainly is not signed in) redirect to login
 * immediately.
 */

/**
 * `shell`: render the app chrome — sidebar, nav, page chrome — now.
 * Data-bearing regions show their own skeletons until `isAuthenticated`
 * turns `true`, at which point they hydrate with no further decision needed
 * here.
 *
 * `redirect`: the caller should be on its way to the issuer, or already is.
 * Nothing here is worth painting.
 */
export type SessionRenderDecision = 'shell' | 'redirect'

export interface SessionRenderState {
  /** `KleoraClient.hasLikelySession()` — a render hint, never an auth check. */
  hasMarker: boolean
  /** `useKleora().isLoading` — `true` until `checkSession()` settles. */
  isLoading: boolean
  /** `useKleora().isAuthenticated`. */
  isAuthenticated: boolean
}

/**
 * `shell` whenever there is something to show for the wait — already
 * authenticated, or a marker says verification is worth doing and it has not
 * yet failed. `redirect` the moment either runs out: no marker at all (the
 * "fresh browser" case, nothing to wait for), or verification finished
 * without producing a session.
 */
export function decideSessionRender(state: SessionRenderState): SessionRenderDecision {
  if (state.isAuthenticated) return 'shell'
  if (!state.hasMarker) return 'redirect'
  return state.isLoading ? 'shell' : 'redirect'
}
