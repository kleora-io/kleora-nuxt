/**
 * The decision the `kleora-auth` route middleware makes, with no Nuxt in
 * sight so that it can be tested as the small state machine it is.
 *
 * The middleware runs for pages registered with
 * `definePageMeta({ auth: true })`, on the client only: it waits for
 * `checkSession()`, then calls `loginWithRedirect({ returnTo: route.fullPath })`
 * if the visitor is unauthenticated.
 */

/**
 * The parts of a resolved route the guard reads.
 *
 * `meta` is `object` rather than `{ auth?: unknown }` so that vue-router's
 * own `RouteMeta` — an interface applications augment, with no index
 * signature of its own — is assignable to it without a cast at the call site.
 */
export interface GuardRoute {
  fullPath: string
  meta: object
}

export interface GuardDeps {
  /** `false` during server rendering, where there is no session to find. */
  browser: boolean
  /** Idempotent `checkSession()`; resolves once the auth state is known. */
  restore: () => Promise<void>
  isAuthenticated: () => boolean
  /**
   * `KleoraClient.hasLikelySession()`. `false` means this browser
   * has nothing worth verifying, so the guard skips `restore()` entirely
   * rather than spending `checkSession()`'s requests finding out what a
   * fresh visitor already is: signed out.
   *
   * A **hint**, and never the last word: `@kleora-io/browser` documents its
   * session marker as never an input to anything that decides whether a
   * request is authorised. The Nuxt
   * module hands over a ref read once, as the app booted, and nothing
   * re-reads it when a sign-in completes in that same document — so `false`
   * here can mean "signed out" *or* "signed in a moment ago, in this very
   * document". Only `isAuthenticated()` tells those two apart, which is why
   * the branch below consults it first.
   */
  hasLikelySession: () => boolean
  /** `loginWithRedirect`. Navigates the document away; never resolves usefully. */
  login: (options: { returnTo: string }) => Promise<void>
}

/** Whether a page asked to be protected with `definePageMeta({ auth: true })`. */
export function requiresAuth(route: GuardRoute): boolean {
  return (route.meta as { auth?: unknown }).auth === true
}

/**
 * `true` when the navigation may proceed, `false` when the browser is on its
 * way to the issuer and the current navigation must be abandoned.
 *
 * The four ways this cannot loop: the server never redirects; `restore()` is
 * single-flight and settles exactly once per page load, so a second
 * navigation does not re-run silent authentication; the callback route is
 * not marked `auth: true`, so the page that finishes a login is never itself
 * guarded; and a document that already holds a session is never sent to the
 * issuer whatever the marker says.
 *
 * **The fourth guards against a real round trip, not a theoretical one.**
 * "The callback route is not guarded" is true and is not enough: the callback page finishes a login and then `navigateTo()`s the
 * `returnTo` *within the same document*, which runs this middleware on a
 * guarded route with `hasLikelySession()` still answering from the snapshot
 * the app booted with — taken before the redemption that has since written
 * the marker. So the no-marker branch fired on an application that had just
 * signed in, and every first visit in a browser without the marker would go to
 * the issuer **twice**: two authorization codes, two token redemptions, two
 * whole-bundle loads, and two passes of "Signing you in…" (`authorize →
 * callback → token → authorize → callback → token`). It would be easy to miss
 * because it works: the issuer's session cookie mints the second code without
 * a prompt. A browser where `localStorage` throws — the marker then never
 * readable — would not stop at two at all.
 *
 * The marker also decides what "may proceed" means for a returning visitor. A
 * browser with **no** session marker skips `restore()` outright and is sent
 * to the issuer at once: if there is no session to check, verifying one that
 * almost certainly does not exist only spends `checkSession()`'s requests to
 * confirm what the marker's absence already says. A browser **with** a marker
 * is let through immediately too, but for the opposite reason: the application
 * shell should render straight away (with skeleton loaders), and the session
 * is validated and the page hydrated once it is known to be valid. Blocking the navigation on `restore()` — as this used to, and
 * as the no-marker branch still effectively does by awaiting `login()` — would
 * hold the whole route, layout included, un-mounted until verification
 * settles: Nuxt does not commit an initial navigation's DOM until every
 * global middleware resolves, so a page's reactive shell cannot render
 * "verifying" if the middleware that would let it render is the thing doing
 * the waiting. So this returns `true` at once and verifies in the
 * background, redirecting only once `restore()` actually says no —
 * `deps.login()` is a full-document navigation, so firing it after the page
 * has already rendered still lands the browser on the issuer correctly, just
 * a little later than a blocking check would have.
 */
export async function enforceAuth(route: GuardRoute, deps: GuardDeps): Promise<boolean> {
  if (!requiresAuth(route)) return true
  // SSR renders the unauthenticated shell. Redirecting here
  // would put the issuer's URL in a server response for a page whose session
  // only the browser can see.
  if (!deps.browser) return true

  // `isAuthenticated()` outranks the marker, and is read first for that
  // reason: it is this document's own answer about this document's own
  // session, where the marker is a hint about the browser taken at boot
  // (see above). A session in hand is never a reason to visit the issuer.
  if (!deps.isAuthenticated() && !deps.hasLikelySession()) {
    await deps.login({ returnTo: route.fullPath })
    return false
  }

  // Fire-and-verify: the caller's `restore` is the single-flight
  // `checkSession()` every other reader of `isLoading`/`isAuthenticated`
  // shares, so this does not start a second one — it only adds the
  // corrective redirect once whichever call started it settles.
  void deps.restore().then(() => {
    if (!deps.isAuthenticated()) void deps.login({ returnTo: route.fullPath })
  })
  return true
}
