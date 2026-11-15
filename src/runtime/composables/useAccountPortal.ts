/**
 * `useAccountPortal()` — the hosted account portal's URL, and a way to open it
 * (`{ url, open }`).
 *
 * ```vue
 * <script setup lang="ts">
 * const portal = useAccountPortal({ returnTo: '/' })
 * </script>
 * <template>
 *   <a :href="portal.url.value" target="_blank" rel="noopener">Manage your account</a>
 * </template>
 * ```
 *
 * **The portal is offered only when this application's Client lists
 * `self_service` in `allowed_scopes`.** For any other Client the link still
 * opens, and every portal page says that managing the account there is not
 * offered. `returnTo` becomes the portal's "back" link only when it equals one
 * of the Client's `post_logout_redirect_uris` exactly — the site root, `'/'`,
 * is the entry `logout()` already needs.
 *
 * Nothing is auto-navigated: `url` is computed, and only `open()` — which
 * opens a new tab by default, never a frame — goes anywhere.
 */

import type { AccountPortalOptions, AccountPortalTarget } from '@kleora-io/browser'
import { useRequestURL } from 'nuxt/app'
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { resolvePortalReturnTo } from '../portal'
import { useKleora } from './useKleora'

export interface UseAccountPortalOptions {
  /** A section to open at; the portal home when absent. */
  section?: MaybeRefOrGetter<AccountPortalOptions['section']>
  /** An absolute URL, or a path on this site such as `'/'`. */
  returnTo?: MaybeRefOrGetter<string | undefined>
}

export interface AccountPortal {
  /** The portal URL, for an `<a href>`. */
  url: ComputedRef<string>
  /** Open it: a new tab (`noopener`) by default, or this window. Browser only. */
  open(options?: { target?: AccountPortalTarget }): void
}

export function useAccountPortal(options: UseAccountPortalOptions = {}): AccountPortal {
  const { client } = useKleora()
  const origin = useRequestURL().origin

  const portalOptions = (): AccountPortalOptions => {
    const section = toValue(options.section)
    const returnTo = resolvePortalReturnTo(toValue(options.returnTo), origin)
    return {
      ...(section === undefined ? {} : { section }),
      ...(returnTo === undefined ? {} : { returnTo }),
    }
  }

  return {
    url: computed(() => client.accountPortalUrl(portalOptions())),
    open: (openOptions = {}) => {
      client.openAccountPortal({
        ...portalOptions(),
        ...(openOptions.target === undefined ? {} : { target: openOptions.target }),
      })
    },
  }
}
