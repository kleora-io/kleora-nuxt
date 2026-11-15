/**
 * The account portal's `returnTo`, as a Nuxt application spells it.
 *
 * `@kleora-io/browser`'s `accountPortalUrl` takes an absolute URL, because that is
 * what the issuer compares with the Client's `post_logout_redirect_uris`. A Nuxt
 * page knows its own origin, so `'/'` here means the site root — the same
 * default `logout()` has — and is resolved against it. Anything else is passed
 * through for the browser package to validate, so a protocol-relative
 * `//elsewhere.example` is still refused there rather than resolved here.
 */

/** A single `/` followed by anything but another `/` or a `\`. */
const SITE_PATH = /^\/(?![/\\])/

export function resolvePortalReturnTo(returnTo: string | undefined, origin: string): string | undefined {
  if (returnTo === undefined) return undefined
  return SITE_PATH.test(returnTo) ? new URL(returnTo, origin).href : returnTo
}
