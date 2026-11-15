/**
 * `createKleoraContext`'s `restore()` — specifically that a marker-less
 * browser never reaches `checkSession()` at all, which is what makes every
 * caller of `restore()` (the module's guard and an application's own
 * middleware alike) skip the session check for a visitor the marker already
 * says has nothing to verify.
 */

import type { AuthState, KleoraClient, User } from '@kleora-io/browser'
import { EnvironmentMismatch } from '@kleora-io/browser'
import { describe, expect, it, vi } from 'vitest'
import { createKleoraContext } from '../src/runtime/state'

/**
 * Every mock is kept as its own named reference rather than read back off
 * the returned client — `expect(kleora.checkSession)` extracts a method
 * from an interface-typed value, which `@typescript-eslint/unbound-method`
 * (rightly) refuses.
 */
function mocks(hasLikelySession: boolean) {
  return {
    hasLikelySession: vi.fn(() => hasLikelySession),
    checkSession: vi.fn((): Promise<AuthState | null> => Promise.resolve(null)),
  }
}

function client(overrides: Partial<KleoraClient>): KleoraClient {
  return {
    loginWithRedirect: vi.fn(() => Promise.resolve()),
    handleRedirectCallback: vi.fn(() => Promise.resolve({})),
    getAccessToken: vi.fn(() => Promise.resolve('token')),
    getUser: vi.fn((): User | null => null),
    hasLikelySession: vi.fn(() => false),
    checkSession: vi.fn((): Promise<AuthState | null> => Promise.resolve(null)),
    logout: vi.fn(() => Promise.resolve()),
    onAuthChange: vi.fn(() => () => undefined),
    accountPortalUrl: vi.fn(() => 'https://acme.kleora.eu/account?client_id=cl'),
    openAccountPortal: vi.fn(),
    account: {} as KleoraClient['account'],
    ...overrides,
  }
}

const options = { browser: true, postLogoutRedirectUri: 'https://app.example.com/' }

describe('restore, with no session marker', () => {
  it('never calls checkSession()', async () => {
    const m = mocks(false)
    const context = createKleoraContext(client(m), options)

    await context.restore()

    expect(m.checkSession).not.toHaveBeenCalled()
    expect(context.isLoading.value).toBe(false)
    expect(context.isAuthenticated.value).toBe(false)
  })

  it('is still single-flight — a second call is the same settled promise', async () => {
    const m = mocks(false)
    const context = createKleoraContext(client(m), options)

    await context.restore()
    await context.restore()

    expect(m.checkSession).not.toHaveBeenCalled()
  })
})

describe('restore, with a session marker', () => {
  it('calls checkSession() exactly once, however many callers await it', async () => {
    const m = mocks(true)
    const context = createKleoraContext(client(m), options)

    await Promise.all([context.restore(), context.restore(), context.restore()])

    expect(m.checkSession).toHaveBeenCalledOnce()
    expect(context.isLoading.value).toBe(false)
  })

  it('re-reads the marker once checkSession() settles', async () => {
    const hasLikelySession = vi.fn()
      .mockReturnValueOnce(true) // the eager read at context creation
      .mockReturnValue(false) // checkSession() found nothing and cleared it
    const checkSession = vi.fn((): Promise<AuthState | null> => Promise.resolve(null))
    const context = createKleoraContext(client({ hasLikelySession, checkSession }), options)
    expect(context.hasLikelySession.value).toBe(true)

    await context.restore()

    expect(context.hasLikelySession.value).toBe(false)
  })

  it('still surfaces an EnvironmentMismatch rather than treating it as "no session"', async () => {
    const hasLikelySession = vi.fn(() => true)
    const checkSession = vi.fn(() =>
      Promise.reject(new EnvironmentMismatch('mixed sandbox/production')))
    const context = createKleoraContext(client({ hasLikelySession, checkSession }), options)

    await expect(context.restore()).rejects.toBeInstanceOf(EnvironmentMismatch)
    expect(context.isLoading.value).toBe(false)
  })
})

describe('restore, on the server', () => {
  it('never reads the marker or calls checkSession()', async () => {
    const m = mocks(true)
    const context = createKleoraContext(client(m), { ...options, browser: false })

    // The eager read at context creation is skipped too (during server
    // rendering there is no `localStorage` to read).
    expect(m.hasLikelySession).not.toHaveBeenCalled()
    expect(context.hasLikelySession.value).toBe(false)

    await context.restore()

    expect(m.checkSession).not.toHaveBeenCalled()
    expect(context.isLoading.value).toBe(true)
  })
})
