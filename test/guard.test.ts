/**
 * The `kleora-auth` middleware's decision, tested through the function the
 * middleware file is a five-line wrapper around.
 */

import { describe, expect, it, vi } from 'vitest'
import { enforceAuth, requiresAuth, type GuardDeps } from '../src/runtime/guard'

function deps(overrides: Partial<GuardDeps> = {}): GuardDeps & {
  restore: ReturnType<typeof vi.fn>
  login: ReturnType<typeof vi.fn>
} {
  const base = {
    browser: true,
    restore: vi.fn(() => Promise.resolve()),
    isAuthenticated: () => false,
    // Most scenarios here are about what happens once a session is worth
    // checking; the "no marker at all" behaviour has its own describe block
    // below, where this is overridden to `false`.
    hasLikelySession: () => true,
    login: vi.fn(() => Promise.resolve()),
  }
  return { ...base, ...overrides } as never
}

describe('requiresAuth', () => {
  it('is true only for a literal `auth: true`', () => {
    expect(requiresAuth({ fullPath: '/', meta: { auth: true } })).toBe(true)
    expect(requiresAuth({ fullPath: '/', meta: {} })).toBe(false)
    expect(requiresAuth({ fullPath: '/', meta: { auth: 'yes' } })).toBe(false)
    expect(requiresAuth({ fullPath: '/', meta: { auth: 1 } })).toBe(false)
  })
})

describe('enforceAuth', () => {
  it('lets an unguarded page through without recovering a session', async () => {
    const context = deps()
    await expect(enforceAuth({ fullPath: '/public', meta: {} }, context)).resolves.toBe(true)
    expect(context.restore).not.toHaveBeenCalled()
    expect(context.login).not.toHaveBeenCalled()
  })

  it('renders the unauthenticated shell on the server instead of redirecting', async () => {
    const context = deps({ browser: false })
    await expect(
      enforceAuth({ fullPath: '/apps', meta: { auth: true } }, context),
    ).resolves.toBe(true)
    expect(context.restore).not.toHaveBeenCalled()
    expect(context.login).not.toHaveBeenCalled()
  })

  it('lets an authenticated visitor through', async () => {
    const context = deps({ isAuthenticated: () => true })
    await expect(enforceAuth({ fullPath: '/apps', meta: { auth: true } }, context)).resolves.toBe(
      true,
    )
    await vi.waitFor(() => expect(context.restore).toHaveBeenCalledOnce())
    expect(context.login).not.toHaveBeenCalled()
  })

  /**
   * With a marker, the navigation is allowed *before* `restore()`
   * settles, not after — a page that only mounts once verification is done
   * could never show "verifying" while it runs. `deps.restore` is the
   * caller's single-flight `checkSession()`, so a background caller — the
   * plugin's own eager call, most of the time — still shares it.
   */
  it('lets a marked visitor through at once, without waiting for restore() to settle', async () => {
    let restoreSettled = false
    const context = deps({
      restore: vi.fn(() => new Promise<void>((resolve) => {
        setTimeout(() => {
          restoreSettled = true
          resolve()
        }, 0)
      })),
      isAuthenticated: () => true,
    })
    await expect(enforceAuth({ fullPath: '/apps', meta: { auth: true } }, context)).resolves.toBe(
      true,
    )
    expect(restoreSettled).toBe(false)
  })

  it('redirects once the background verification settles and finds no session', async () => {
    const context = deps({ isAuthenticated: () => false })
    await expect(
      enforceAuth({ fullPath: '/apps/acme/production/users?q=ada', meta: { auth: true } }, context),
    ).resolves.toBe(true)
    await vi.waitFor(() => expect(context.login).toHaveBeenCalledWith({
      returnTo: '/apps/acme/production/users?q=ada',
    }))
  })

  it('does not loop: a second guarded navigation reuses the one recovery', async () => {
    const context = deps({ isAuthenticated: () => true })
    await enforceAuth({ fullPath: '/a', meta: { auth: true } }, context)
    await enforceAuth({ fullPath: '/b', meta: { auth: true } }, context)
    await vi.waitFor(() => expect(context.restore).toHaveBeenCalled())
    // `restore` is idempotent by contract; the guard never calls `login` for
    // a visitor it has already seen authenticated.
    expect(context.login).not.toHaveBeenCalled()
  })
})

/**
 * Without a session to check (a fresh browser, which certainly is not signed
 * in) the guard redirects to login immediately.
 */
describe('enforceAuth without a session marker', () => {
  it('redirects immediately, without spending checkSession()\'s budget first', async () => {
    const context = deps({ hasLikelySession: () => false })
    await expect(
      enforceAuth({ fullPath: '/apps', meta: { auth: true } }, context),
    ).resolves.toBe(false)
    expect(context.restore).not.toHaveBeenCalled()
    expect(context.login).toHaveBeenCalledWith({ returnTo: '/apps' })
  })

  /**
   * The marker is a snapshot taken as the app booted, and the callback
   * page finishes a login and then navigates to the `returnTo` *inside the
   * same document* — so this middleware runs on a guarded route with the
   * marker still reading as it did before the redemption wrote it. Sending
   * that navigation to the issuer would make every first visit in a
   * marker-less browser pay two full authorization round trips (`guard.ts`'s
   * fourth "cannot loop"), and a browser with `localStorage` blocked would
   * pay them for ever.
   *
   * `restore()` is still fired: it is the single-flight the callback page has
   * already settled, so it costs nothing here, and this stays one path rather
   * than two.
   */
  it('does not send a document that already holds a session to the issuer', async () => {
    const context = deps({ hasLikelySession: () => false, isAuthenticated: () => true })
    await expect(
      enforceAuth({ fullPath: '/apps/id/production/users', meta: { auth: true } }, context),
    ).resolves.toBe(true)
    await vi.waitFor(() => expect(context.restore).toHaveBeenCalledOnce())
    expect(context.login).not.toHaveBeenCalled()
  })

  it('still renders the unauthenticated shell on the server', async () => {
    const context = deps({ browser: false, hasLikelySession: () => false })
    await expect(
      enforceAuth({ fullPath: '/apps', meta: { auth: true } }, context),
    ).resolves.toBe(true)
    expect(context.restore).not.toHaveBeenCalled()
    expect(context.login).not.toHaveBeenCalled()
  })

  it('still lets an unguarded page through', async () => {
    const context = deps({ hasLikelySession: () => false })
    await expect(enforceAuth({ fullPath: '/public', meta: {} }, context)).resolves.toBe(true)
    expect(context.restore).not.toHaveBeenCalled()
    expect(context.login).not.toHaveBeenCalled()
  })
})
