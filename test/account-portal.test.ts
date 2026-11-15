/**
 * `useAccountPortal()` and `useKleoraAccount()`, against a real `@kleora-io/browser` client and a replaced
 * `nuxt/app`, so what is asserted is the URL the SDK itself builds.
 */

import { createKleora, KleoraError, type KleoraClient } from '@kleora-io/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { resolvePortalReturnTo } from '../src/runtime/portal'

const ISSUER = 'https://acme-sandbox.kleora.eu'
const ORIGIN = 'https://app.example.com'
let client: KleoraClient

vi.mock('nuxt/app', () => ({
  useNuxtApp: () => ({ $kleora: { client } }),
  useRequestURL: () => new URL(`${ORIGIN}/dashboard?x=1`),
}))

const { useAccountPortal } = await import('../src/runtime/composables/useAccountPortal')
const { useKleoraAccount } = await import('../src/runtime/composables/useKleoraAccount')

function kleora(): KleoraClient {
  client = createKleora({ issuer: ISSUER, clientId: 'cl_app', redirectUri: `${ORIGIN}/auth/callback` })
  return client
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolvePortalReturnTo', () => {
  it('resolves a path on this site against the origin', () => {
    expect(resolvePortalReturnTo('/', ORIGIN)).toBe(`${ORIGIN}/`)
    expect(resolvePortalReturnTo('/settings?tab=1', ORIGIN)).toBe(`${ORIGIN}/settings?tab=1`)
  })

  it('passes everything else through for the browser package to judge', () => {
    expect(resolvePortalReturnTo(undefined, ORIGIN)).toBeUndefined()
    expect(resolvePortalReturnTo('https://other.example/', ORIGIN)).toBe('https://other.example/')
    expect(resolvePortalReturnTo('//evil.example/', ORIGIN)).toBe('//evil.example/')
    expect(resolvePortalReturnTo('/\\evil.example', ORIGIN)).toBe('/\\evil.example')
  })
})

describe('useAccountPortal', () => {
  it('is the portal URL for this app’s issuer and Client', () => {
    kleora()
    const portal = useAccountPortal()
    expect(portal.url.value).toBe(`${ISSUER}/account?client_id=cl_app`)
  })

  it('resolves returnTo: "/" to the site root, which is what the Client registers', () => {
    kleora()
    const portal = useAccountPortal({ returnTo: '/' })
    const url = new URL(portal.url.value)
    expect(url.searchParams.get('return_to')).toBe(`${ORIGIN}/`)
  })

  it('follows reactive options', () => {
    kleora()
    const section = ref<'security' | 'sessions'>('security')
    const portal = useAccountPortal({ section })
    expect(new URL(portal.url.value).pathname).toBe('/account/security')
    section.value = 'sessions'
    expect(new URL(portal.url.value).pathname).toBe('/account/sessions')
  })

  it('refuses a protocol-relative returnTo rather than resolving it', () => {
    kleora()
    const portal = useAccountPortal({ returnTo: '//evil.example/' })
    expect(() => portal.url.value).toThrow(KleoraError)
  })

  it('opens it in a new tab with noopener, and navigates nothing on its own', () => {
    kleora()
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const portal = useAccountPortal({ section: 'password', returnTo: '/' })
    expect(open).not.toHaveBeenCalled()
    portal.open()
    expect(open).toHaveBeenCalledWith(
      `${ISSUER}/account/password?client_id=cl_app&return_to=${encodeURIComponent(`${ORIGIN}/`)}`,
      '_blank',
      'noopener',
    )
  })
})

describe('useKleoraAccount', () => {
  it('is the client’s own self-service API', () => {
    const own = kleora()
    expect(useKleoraAccount()).toBe(own.account)
  })
})
