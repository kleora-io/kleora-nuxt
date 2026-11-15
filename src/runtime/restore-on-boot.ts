/**
 * Whether the plugin should start `restore()` proactively as the Nuxt app
 * boots, before any route middleware has had a chance to.
 *
 * Extracted out of `plugin.ts` so the decision is testable on its own — the
 * same reason `session-render.ts` holds `decideSessionRender` rather than
 * leaving it inline. It is tempting to add a fourth exclusion here, gated on
 * `auth.hasLikelySession`, reasoning that there is "nothing to verify
 * without a marker". That would be wrong: `restore()` itself (`state.ts`)
 * already skips `checkSession()` when there is no marker, and settles
 * `isLoading` regardless — gating the call *here* on the same condition would
 * not save that cost a second time, it would only stop `restore()` from ever
 * running at all for a page with no marker. The route middleware only calls `restore()` for a page marked
 * `definePageMeta({ auth: true })` (`guard.ts`), so an **unguarded** page
 * with no marker — every page a fresh browser has not visited before, which
 * is every `@kleora-io/nuxt` quickstart's `isLoading` idiom on its first
 * visit — would have nothing left to call `restore()` at all, and its
 * `isLoading` would stay `true` forever.
 *
 * So this function takes no marker, deliberately: the three exclusions below
 * are the only ones that are real. The regression this guards against is
 * exactly "somebody adds a fourth" — the test for this file asserts the
 * unconditional case restores with no marker in sight.
 */
export interface RestoreOnBootState {
  /** `false` during server rendering — there is no session to recover there. */
  browser: boolean
  /**
   * A frame never starts a session recovery of its own (`plugin.ts`'s
   * `inFrame()`, which says why the rule outlived the hidden iframe).
   */
  inFrame: boolean
  /** `window.location.pathname`, always `''` when `browser` is `false`. */
  pathname: string
  /** `PublicKleoraConfig.callbackPath` — the route that completes a login. */
  callbackPath: string
}

/**
 * `true` on every page but the callback, in a browser, outside any frame —
 * whatever the session marker says.
 */
export function shouldRestoreOnBoot(state: RestoreOnBootState): boolean {
  if (!state.browser) return false
  if (state.inFrame) return false
  if (state.pathname === state.callbackPath) return false
  return true
}
