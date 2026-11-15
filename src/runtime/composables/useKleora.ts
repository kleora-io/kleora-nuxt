/**
 * `useKleora()` — the client, the reactive auth state and the three
 * actions (`login`, `logout`, `getAccessToken`).
 */

import { useNuxtApp } from 'nuxt/app'
import type { KleoraContext } from '../state'

/**
 * The cast is the module boundary: the plugin provides `$kleora`, and the
 * `NuxtApp` augmentation that says so is generated into the *application's*
 * types, not this package's, so it is not in scope here.
 */
export function useKleora(): KleoraContext {
  const nuxtApp = useNuxtApp() as unknown as { $kleora?: KleoraContext }
  const kleora = nuxtApp.$kleora
  if (kleora === undefined) {
    throw new Error('useKleora() was called before the kleora-auth plugin ran')
  }
  return kleora
}
