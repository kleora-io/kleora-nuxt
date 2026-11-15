/**
 * The reactive state `useKleora()` and `useKleoraUser()` hand out.
 *
 * One of these exists per Nuxt app — per request on the server, per tab in
 * the browser — and it is the only place the SDK's imperative
 * `onAuthChange` callback is turned into refs.
 */

import { EnvironmentMismatch } from '@kleora-io/browser'
import type {
  AccessTokenOptions,
  AuthState,
  LoginOptions,
  KleoraClient,
  User,
} from '@kleora-io/browser'
import { ref, shallowRef, type Ref } from 'vue'

export interface KleoraContext {
  /** The `@kleora-io/browser` client itself, for anything not wrapped here. */
  client: KleoraClient
  /** ID-token claims, or `null`. `null` throughout server rendering. */
  user: Ref<User | null>
  isAuthenticated: Ref<boolean>
  /** `true` until the first `checkSession()` settles; always `true` on the server. */
  isLoading: Ref<boolean>
  /**
   * `KleoraClient.hasLikelySession()`, kept in sync across a `restore()` —
   * a render hint only. `false` throughout server
   * rendering: there is no `localStorage` to read there, which is also why
   * `restore()`'s guard-facing "no marker" branch never applies server-side.
   */
  hasLikelySession: Ref<boolean>
  login: (options?: LoginOptions) => Promise<void>
  /** Defaults `returnTo` to the site root, which is the registered post-logout URI. */
  logout: (options?: { returnTo?: string }) => Promise<void>
  /** `force` discards the cached token and refreshes — see the browser SDK. */
  getAccessToken: (options?: AccessTokenOptions) => Promise<string>
  /**
   * Recover a session, at most once per app. The route middleware awaits
   * this before deciding, and a second call is free.
   */
  restore: () => Promise<void>
  /** Mark the state known without a `checkSession()` — the callback page's job. */
  settle: () => void
}

export interface KleoraContextOptions {
  /** `false` during server rendering: there is no session to recover there. */
  browser: boolean
  /** Where `logout()` sends the browser when the caller names nothing. */
  postLogoutRedirectUri: string
}

export function createKleoraContext(
  client: KleoraClient,
  options: KleoraContextOptions,
): KleoraContext {
  // `shallowRef`: the claims are a frozen snapshot replaced wholesale on every
  // change, and deep reactivity over a token payload buys nothing.
  const user = shallowRef<User | null>(client.getUser())
  const isAuthenticated = ref(false)
  const isLoading = ref(true)
  // `client.hasLikelySession()` reads `localStorage` directly and is cheap,
  // so this is read eagerly rather than deferred to `restore()` — the whole
  // point is a correct answer at first client-side render, before
  // `checkSession()` has had a chance to run at all.
  const hasLikelySession = ref(options.browser ? client.hasLikelySession() : false)

  client.onAuthChange((state: AuthState) => {
    user.value = state.user
    isAuthenticated.value = state.isAuthenticated
  })

  let restoring: Promise<void> | null = null

  function settle(): void {
    restoring ??= Promise.resolve()
    isLoading.value = false
  }

  function restore(): Promise<void> {
    // Server rendering produces the unauthenticated shell with
    // `isLoading: true`. Leaving the flag set is what stops a page rendering a
    // signed-out state that hydration is about to contradict.
    if (!options.browser) return Promise.resolve()

    restoring ??= (
      hasLikelySession.value
        ? client
          .checkSession()
          .then(() => undefined)
          .catch((error: unknown) => {
            // A mixed sandbox/production configuration is a fault to
            // surface, not a "no session" answer. Everything else — a
            // blocked third-party cookie, a refused refresh token, a dead
            // network — means signed out, and the guard sends the browser to
            // the issuer from there.
            if (error instanceof EnvironmentMismatch) throw error
          })
        // No marker, nothing to verify. `restore()` is the one place
        // every caller shares — this app's route middleware and the module's
        // own guard alike — so a skip here is a skip everywhere, rather than
        // a rule each caller would otherwise have to repeat: without it,
        // `checkSession()` still runs (a discovery fetch, and a refresh when
        // a token is stored) for a caller that never learned to check first.
        : Promise.resolve()
    ).finally(() => {
      isLoading.value = false
      // `checkSession()` may have cleared the marker (a refresh token the
      // issuer refused) or left it set (a stored refresh token that worked, or
      // none to try, which proves nothing); the skip branch above leaves it
      // exactly as it was. Either way this is the one place that has to
      // notice, since nothing else re-reads `localStorage` once the page has
      // loaded.
      hasLikelySession.value = client.hasLikelySession()
    })
    return restoring
  }

  return {
    client,
    user,
    isAuthenticated,
    isLoading,
    hasLikelySession,
    login: (loginOptions: LoginOptions = {}) => client.loginWithRedirect(loginOptions),
    logout: (logoutOptions: { returnTo?: string } = {}) =>
      client.logout({ returnTo: logoutOptions.returnTo ?? options.postLogoutRedirectUri }),
    getAccessToken: (tokenOptions?: AccessTokenOptions) => client.getAccessToken(tokenOptions),
    restore,
    settle,
  }
}
