/**
 * `runtimeConfig.public.kleora` → `createKleora` options.
 *
 * Every key reaches the runtime as a string because that is what makes it
 * settable from `NUXT_PUBLIC_*`; the empty ones must not be passed on.
 */

import { KleoraError } from '@kleora-io/browser'
import { describe, expect, it } from 'vitest'
import {
  defaultPostLogoutUri,
  resolveKleoraOptions,
  type PublicKleoraConfig,
} from '../src/runtime/config'

const CONFIG: PublicKleoraConfig = {
  issuer: 'http://id.localhost:8100',
  clientId: 'kleora-console',
  redirectUri: '',
  scope: '',
  audience: '',
  tenant: '',
  storage: 'memory',
  callbackPath: '/auth/callback',
}

describe('resolveKleoraOptions', () => {
  it('drops the empty keys and derives the redirect URI from the origin', () => {
    expect(resolveKleoraOptions(CONFIG, 'http://localhost:3100')).toEqual({
      issuer: 'http://id.localhost:8100',
      clientId: 'kleora-console',
      redirectUri: 'http://localhost:3100/auth/callback',
      storage: 'memory',
    })
  })

  it('keeps the values that are set', () => {
    expect(
      resolveKleoraOptions(
        {
          ...CONFIG,
          redirectUri: 'https://console.example/cb',
          scope: 'openid profile',
          audience: 'https://api.example',
          tenant: 'acme',
          storage: 'session',
        },
        'http://localhost:3100',
      ),
    ).toEqual({
      issuer: 'http://id.localhost:8100',
      clientId: 'kleora-console',
      redirectUri: 'https://console.example/cb',
      scope: 'openid profile',
      audience: 'https://api.example',
      tenant: 'acme',
      storage: 'session',
    })
  })

  it('names the environment variable when a required option is missing', () => {
    expect(() => resolveKleoraOptions({ ...CONFIG, issuer: '' }, 'http://localhost:3100')).toThrow(
      /NUXT_PUBLIC_KLEORA_ISSUER/,
    )
    expect(() => resolveKleoraOptions({ ...CONFIG, clientId: '  ' }, 'http://localhost:3100'))
      .toThrow(KleoraError)
  })
})

describe('defaultPostLogoutUri', () => {
  it('is the site root, trailing slash and all', () => {
    // `post_logout_redirect_uris` are matched exactly, and the registered one
    // is `http://localhost:{port}/`.
    expect(defaultPostLogoutUri('http://localhost:3100')).toBe('http://localhost:3100/')
  })
})
