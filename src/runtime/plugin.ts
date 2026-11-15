/**
 * Creates the client, the reactive state and `$kleoraApi`, once per Nuxt
 * app, and starts session recovery as soon as the browser has one.
 *
 * It runs on the server too. Server rendering needs `$kleoraApi` to exist
 * (so a page calling it fails with `LoginRequired` rather than
 * `undefined is not a function`) and needs `useKleoraUser()` to answer
 * `null` — server rendering always produces the unauthenticated shell.
 */

import { createKleora } from '@kleora-io/browser'
import { defineNuxtPlugin, useRequestURL, useRuntimeConfig } from 'nuxt/app'
import { createKleoraApi } from './api'
import { defaultPostLogoutUri, resolveKleoraOptions, type PublicKleoraConfig } from './config'
import { shouldRestoreOnBoot } from './restore-on-boot'
import { createKleoraContext } from './state'
import { browserStore, createUnauthenticatedRedirect } from './unauthenticated'

/**
 * Whether this evaluation has a browser.
 *
 * `typeof window` rather than `import.meta.client`: the same modules are
 * typechecked here by a plain `vue-tsc` with no Nuxt-generated globals, and
 * are unit-tested by vitest, neither of which defines Nuxt's build-time
 * constants.
 */
function inBrowser(): boolean {
  return typeof window !== 'undefined'
}

/**
 * A frame never starts a session recovery or a redirect of its own. Earlier
 * SDK versions had `checkSession()` run a `prompt=none` authorization in a hidden
 * iframe that landed on this very origin's callback route and booted the
 * whole application a second time, racing the parent for the same single-use
 * `state`; the SDK no longer frames anything, but an older one in a cached
 * bundle might, and a page framed by anybody else must not navigate its frame
 * to an issuer that refuses to be framed.
 */
function inFrame(): boolean {
  try {
    return window.self !== window.top
  } catch {
    // A cross-origin parent makes the comparison throw, which answers it.
    return true
  }
}

export default defineNuxtPlugin({
  name: 'kleora-auth',
  setup() {
    const config = useRuntimeConfig()
    const kleoraConfig = config.public.kleora as PublicKleoraConfig
    const origin = useRequestURL().origin
    const client = createKleora(resolveKleoraOptions(kleoraConfig, origin))
    const auth = createKleoraContext(client, {
      browser: inBrowser(),
      postLogoutRedirectUri: defaultPostLogoutUri(origin),
    })

    // One breaker per app, so concurrent 401s collapse into a single
    // redirect and a 401 that signing in cannot fix is rendered instead.
    const unauthenticated = createUnauthenticatedRedirect({
      store: inBrowser() ? browserStore() : null,
      now: () => Date.now(),
      returnTo: () => window.location.pathname + window.location.search,
      login: (loginOptions) => auth.login(loginOptions),
    })

    const api = createKleoraApi({
      baseURL: typeof config.public.apiBase === 'string' ? config.public.apiBase : '',
      getAccessToken: (tokenOptions) => auth.getAccessToken(tokenOptions),
      onUnauthenticated: () => {
        // Navigating a frame would load the issuer inside the page rather
        // than instead of it (`inFrame()`, above).
        if (!inBrowser() || inFrame()) return
        // A 401 the forced refresh could not fix
        // means the session is gone, whatever the token store believes — but
        // only if signing in has not just been tried.
        unauthenticated.attempt()
      },
    })

    // Order matters and mirrors `shouldRestoreOnBoot`'s own exclusions:
    // `window` is only ever touched once `browser` is known true, so a
    // server evaluation never reaches `inFrame()` or `window.location`.
    const browser = inBrowser()
    const frame = browser && inFrame()
    const pathname = browser ? window.location.pathname : ''

    if (
      shouldRestoreOnBoot({ browser, inFrame: frame, pathname, callbackPath: kleoraConfig.callbackPath })
    ) {
      // Start early so the route middleware usually finds the answer
      // waiting. See `restore-on-boot.ts` for why this is unconditional —
      // in particular, not gated on `auth.hasLikelySession`.
      auth.restore().catch(() => {
        // Reported wherever it is awaited — the middleware, or the shell.
      })
    }

    return {
      provide: {
        kleora: auth,
        kleoraApi: api,
      },
    }
  },
})
