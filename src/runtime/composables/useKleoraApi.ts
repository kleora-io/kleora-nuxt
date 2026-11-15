/**
 * `useKleoraApi()` — the `$fetch` instance carrying the bearer.
 *
 * An application's own `useApi()` can simply return this; it is a
 * composable as well as an injection so that a consumer never has to reach
 * into `useNuxtApp()` for it.
 */

import { useNuxtApp } from 'nuxt/app'
import type { KleoraApi } from '../api'

export function useKleoraApi(): KleoraApi {
  const nuxtApp = useNuxtApp() as unknown as { $kleoraApi?: KleoraApi }
  const api = nuxtApp.$kleoraApi
  if (api === undefined) {
    throw new Error('useKleoraApi() was called before the kleora-auth plugin ran')
  }
  return api
}
