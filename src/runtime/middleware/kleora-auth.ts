/**
 * `kleora-auth` — the module's route middleware.
 *
 * Registered globally by the module and keyed on page metadata, so a page
 * opts in with `definePageMeta({ auth: true })` and nothing else has to be
 * remembered. The decision itself lives in `../guard`, which knows nothing
 * about Nuxt and is unit-tested on its own.
 */

import { defineNuxtRouteMiddleware } from 'nuxt/app'
import { useKleora } from '../composables/useKleora'
import { enforceAuth } from '../guard'

function inBrowser(): boolean {
  return typeof window !== 'undefined'
}

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useKleora()

  const allowed = await enforceAuth(
    { fullPath: to.fullPath, meta: to.meta },
    {
      browser: inBrowser(),
      restore: () => auth.restore(),
      isAuthenticated: () => auth.isAuthenticated.value,
      hasLikelySession: () => auth.hasLikelySession.value,
      login: (options) => auth.login(options),
    },
  )

  // `false` cancels the navigation silently. The document is already on its
  // way to the issuer; the alternative is rendering a protected page for the
  // milliseconds in between.
  return allowed ? undefined : false
})
