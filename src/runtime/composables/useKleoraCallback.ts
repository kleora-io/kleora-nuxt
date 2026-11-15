/**
 * `useKleoraCallback()` — everything the `/auth/callback` page does, as a
 * composable.
 *
 * An application that supplies its own page at `callbackPath` — styled in its
 * own design, which is what the module's opt-out in `module.ts` exists for —
 * calls this in that page's `setup` and runs the *same* logic, rather than a
 * copy of the most security-sensitive page in the SDK. The module's own page
 * is a thin template over it.
 *
 * The body is the page's former inline script, unchanged in what it does: the
 * frame early return, redeem-or-recover through the breaker, `settle()`, and
 * the navigation. Two things are new and neither changes a path: the failure
 * is kept as an `Error` rather than as its message, so a page can render the
 * message and keep the rest for itself; and `startAgain()` exists, so a page
 * need not know how a fresh sign-in is started.
 */

import { navigateTo } from 'nuxt/app'
import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { completeCallback } from '../callback'
import {
  browserStore,
  createUnauthenticatedRedirect,
  markLoginComplete,
} from '../unauthenticated'
import { useKleora } from './useKleora'

export interface KleoraCallback {
  /**
   * `'working'` while the page is redeeming, recovering or on its way
   * somewhere — including to the issuer — and `'failed'` once there is
   * nothing left to try.
   */
  state: ComputedRef<'working' | 'failed'>
  /** What went wrong, for the page to explain; `null` while working. */
  failure: Readonly<Ref<Error | null>>
  /** A fresh sign-in, from the site root. */
  startAgain: () => Promise<void>
}

/**
 * A frame never redeems. Earlier SDK versions had `checkSession()` load this same
 * route inside a hidden iframe and read the parameters out of the frame's URL
 * itself, so redeeming them here as well consumed the single-use `state` the
 * parent was waiting for. The SDK no longer frames anything; the rule stays
 * for an older SDK in a cached bundle, and because a frame is never where a
 * sign-in should finish.
 */
function inFrame(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

export function useKleoraCallback(): KleoraCallback {
  const auth = useKleora()
  const failure = ref<Error | null>(null)

  /** What the page shows for whatever went wrong. */
  function report(error: unknown): void {
    failure.value = error instanceof Error ? error : new Error(String(error))
  }

  onMounted(() => {
    if (inFrame()) return

    // The same breaker the API's 401 handling uses, for the same reason and with
    // the same stamps: a login started from here must be bounded at one round
    // trip through the issuer.
    //
    // The store is read once and checked, because the bound *is* the store: with
    // no `sessionStorage` there is no stamp to remember the attempt by — and no
    // PKCE transaction either, so every callback would fail the same way and
    // start another login. A browser without one gets the honest error instead.
    const store = browserStore()
    const relogin = createUnauthenticatedRedirect({
      store,
      now: () => Date.now(),
      returnTo: () => '/',
      login: (loginOptions) => auth.login(loginOptions),
      // `attempt()` has already returned `true` and this page is showing
      // "signing you in"; a navigation that never happens would leave it saying
      // that forever.
      onLoginFailed: report,
    })

    void (async () => {
      try {
        const outcome = await completeCallback({
          search: window.location.search,
          handleRedirectCallback: () => auth.client.handleRedirectCallback(),
          restore: () => auth.restore(),
          isAuthenticated: () => auth.isAuthenticated.value,
          relogin: () => store !== null && relogin.attempt(),
          fallback: '/',
        })
        auth.settle()

        // The browser is on its way to the issuer; the page keeps saying so.
        if (outcome.kind === 'pending') return

        if (outcome.kind === 'redirect') {
          // A session exists again. That retires the redirect the breaker may
          // have started, and stamps the login so that a 401 arriving straight
          // afterwards is recognised as one signing in did not fix.
          markLoginComplete()
          await navigateTo(outcome.to, { replace: true })
          return
        }
        report(outcome.error)
      }
      catch (error) {
        // Nothing above is allowed to leave the page spinning: a rejection here
        // would be swallowed by the `void` and the person would watch "signing
        // you in" forever.
        auth.settle()
        report(error)
      }
    })()
  })

  return {
    state: computed(() => (failure.value === null ? 'working' : 'failed')),
    failure,
    // A person asking to start again is not the breaker's automatic retry, so
    // it goes straight to `login()`. If the navigation to the issuer cannot even
    // begin, that is the next thing the page has to explain.
    startAgain: () => auth.login({ returnTo: '/' }).catch(report),
  }
}
