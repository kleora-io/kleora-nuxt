/**
 * `useKleoraAccount()` — the end-user self-service (account) API, typed.
 *
 * `@kleora-io/browser`'s `kleora.account`, over this application's own client and
 * its own access token:
 *
 * ```ts
 * const account = useKleoraAccount()
 * const profile = await account.getProfile()
 * ```
 *
 * Two things must be true first, and neither is the module's to decide: the
 * Client lists `self_service` in `allowed_scopes` (the consent), and
 * the application asks for it — `kleora: { scope: 'openid profile email
 * offline_access self_service' }` in `nuxt.config`, since the default scope
 * does not include it. Without the second every call answers `403
 * insufficient-scope`; without the first, signing in fails with
 * `invalid_scope`.
 *
 * Client-only, like `$kleoraApi`: during server rendering there is no token.
 */

import type { AccountClient } from '@kleora-io/browser'
import { useKleora } from './useKleora'

export function useKleoraAccount(): AccountClient {
  return useKleora().client.account
}
