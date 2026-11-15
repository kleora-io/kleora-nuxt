/**
 * Turning `runtimeConfig.public.kleora` into `createKleora` options.
 *
 * Every key is present as a string, because that is what makes a Nuxt runtime
 * config key overridable by an environment variable: a key absent from the
 * config object at build time is never read from `NUXT_PUBLIC_*` at runtime.
 * An empty string therefore means "not configured" and must be dropped rather
 * than passed on — `createKleora` would refuse `audience: ''` as a real
 * value, and `scope: ''` would ask the issuer for no scopes at all.
 */

import { KleoraError, type KleoraOptions, type StorageStrategy } from '@kleora-io/browser'

/** The shape the module writes into `runtimeConfig.public.kleora`. */
export interface PublicKleoraConfig {
  issuer: string
  clientId: string
  redirectUri: string
  scope: string
  audience: string
  tenant: string
  storage: StorageStrategy
  /** Where the module's own callback page is mounted. */
  callbackPath: string
}

const MISSING = 'kleora.%s is not configured; set it in nuxt.config or as NUXT_PUBLIC_KLEORA_%s'

function required(value: string, name: string, envSuffix: string): string {
  if (value.trim() === '') {
    throw new KleoraError(
      'invalid_configuration',
      MISSING.replace('%s', name).replace('%s', envSuffix),
    )
  }
  return value.trim()
}

function optional(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * The absolute URL of the callback route on `origin`.
 *
 * `redirectUri` is left as a module option because a Client's registered URI
 * is matched byte for byte, so a deployment behind a proxy that rewrites the
 * path has to be able to say so. Unset, it is this — the module's own page on
 * the site the browser is looking at.
 */
export function defaultRedirectUri(callbackPath: string, origin: string): string {
  return new URL(callbackPath, origin).href
}

/** `createKleora` options from the public runtime config. */
export function resolveKleoraOptions(
  config: PublicKleoraConfig,
  origin: string,
): KleoraOptions {
  const callbackPath = optional(config.callbackPath) ?? '/auth/callback'
  const options: KleoraOptions = {
    issuer: required(config.issuer, 'issuer', 'ISSUER'),
    clientId: required(config.clientId, 'clientId', 'CLIENT_ID'),
    redirectUri: optional(config.redirectUri) ?? defaultRedirectUri(callbackPath, origin),
  }
  const scope = optional(config.scope)
  if (scope !== undefined) options.scope = scope
  const audience = optional(config.audience)
  if (audience !== undefined) options.audience = audience
  const tenant = optional(config.tenant)
  if (tenant !== undefined) options.tenant = tenant
  if (config.storage === 'session' || config.storage === 'memory') options.storage = config.storage
  return options
}

/**
 * Where `logout()` sends the browser when the caller names nothing.
 *
 * The site root, which is the second URL `KLEORA_CONSOLE_URLS` registers.
 * The trailing slash matters: `post_logout_redirect_uris` are matched exactly.
 */
export function defaultPostLogoutUri(origin: string): string {
  return new URL('/', origin).href
}
