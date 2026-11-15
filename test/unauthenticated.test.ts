/**
 * The circuit breaker: when a 401 is allowed to send the browser to the
 * issuer, and when it must be rendered instead.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  createUnauthenticatedRedirect,
  LOGIN_MARKER_KEY,
  markLoginComplete,
  REDIRECT_COOLDOWN_MS,
  REDIRECT_MARKER_KEY,
  type UnauthenticatedRedirectDeps,
} from '../src/runtime/unauthenticated'

/** A `Storage` that is a Map, plus one that refuses everything. */
function fakeStore(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

function hostileStore(): Storage {
  const refuse = (): never => {
    throw new Error('storage is blocked')
  }
  return {
    get length(): number {
      return refuse()
    },
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  }
}

/** A store that accepts every write and remembers nothing — a full quota. */
function amnesiacStore(): Storage {
  return {
    length: 0,
    clear: () => {},
    getItem: () => null,
    key: () => null,
    removeItem: () => {},
    setItem: () => {},
  }
}

const NOW = 1_700_000_000_000

function breaker(overrides: Partial<UnauthenticatedRedirectDeps> = {}) {
  const login = vi.fn(() => Promise.resolve())
  const deps: UnauthenticatedRedirectDeps = {
    store: fakeStore(),
    now: () => NOW,
    returnTo: () => '/apps?page=2',
    login,
    ...overrides,
  }
  return { login, deps, redirect: createUnauthenticatedRedirect(deps) }
}

describe('createUnauthenticatedRedirect', () => {
  it('sends the browser to the issuer the first time, carrying the current path', () => {
    const { login, redirect, deps } = breaker()

    expect(redirect.attempt()).toBe(true)
    expect(login).toHaveBeenCalledWith({ returnTo: '/apps?page=2' })
    expect(deps.store?.getItem(REDIRECT_MARKER_KEY)).toBe(String(NOW))
  })

  it('does not redirect for the second 401 after a login that just completed', async () => {
    // The finding: the retry re-sends a token the API refuses for a reason
    // signing in cannot change, so the redirect must not repeat.
    const store = fakeStore()
    markLoginComplete(store, NOW)

    const { login, redirect } = breaker({ store, now: () => NOW + 3_000 })

    expect(redirect.attempt()).toBe(false)
    expect(login).not.toHaveBeenCalled()
    await Promise.resolve()
  })

  it('does not redirect twice within the cooldown of its own redirect', () => {
    const store = fakeStore()
    const first = breaker({ store })
    expect(first.redirect.attempt()).toBe(true)

    // A second page load — a new breaker, the same tab's storage.
    const second = breaker({ store, now: () => NOW + REDIRECT_COOLDOWN_MS - 1 })
    expect(second.redirect.attempt()).toBe(false)
    expect(second.login).not.toHaveBeenCalled()
  })

  it('allows a redirect again once both stamps are stale', () => {
    const store = fakeStore()
    breaker({ store }).redirect.attempt()
    markLoginComplete(store, NOW + 1_000)

    const later = breaker({ store, now: () => NOW + REDIRECT_COOLDOWN_MS + 5_000 })
    expect(later.redirect.attempt()).toBe(true)
    expect(later.login).toHaveBeenCalledOnce()
  })

  it('collapses concurrent 401s into one redirect', () => {
    const { login, redirect } = breaker()

    const started = [redirect.attempt(), redirect.attempt(), redirect.attempt()]

    expect(started).toEqual([true, false, false])
    expect(login).toHaveBeenCalledOnce()
  })

  it('unlatches when the navigation itself fails, rather than latching forever', async () => {
    const login = vi.fn(() => Promise.reject(new Error('discovery is down')))
    const store = fakeStore()
    const redirect = createUnauthenticatedRedirect({
      store,
      now: () => NOW,
      returnTo: () => '/',
      login,
    })

    expect(redirect.attempt()).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    // The stamp still holds it for the cooldown; the in-flight latch does not.
    expect(store.getItem(REDIRECT_MARKER_KEY)).toBe(String(NOW))
    expect(redirect.attempt()).toBe(false)
  })

  it('refuses when the stamp it just wrote did not persist', () => {
    // Safari in private browsing, and every embedding that blocks storage: the
    // write is accepted and forgotten. Without a stamp there is nothing to
    // bound a second attempt by — the redirect would come back, fail the same
    // way and start another — so the redirect is refused and the caller
    // surfaces the failure it already had.
    const { redirect, login } = breaker({ store: hostileStore() })

    expect(redirect.attempt()).toBe(false)
    expect(login).not.toHaveBeenCalled()
  })

  it('refuses a store that accepts writes and keeps nothing', () => {
    const { redirect, login } = breaker({ store: amnesiacStore() })

    expect(redirect.attempt()).toBe(false)
    expect(login).not.toHaveBeenCalled()
  })

  it('refuses when there is no store at all', () => {
    const { redirect, login } = breaker({ store: null })

    expect(redirect.attempt()).toBe(false)
    expect(login).not.toHaveBeenCalled()
  })

  it('tells the caller when the navigation it promised never happened', async () => {
    // `attempt()` has already answered `true`; a page showing "signing you in"
    // has no other way to learn that nothing is on its way.
    const onLoginFailed = vi.fn()
    const failure = new Error('discovery is down')
    const { redirect } = breaker({ login: () => Promise.reject(failure), onLoginFailed })

    expect(redirect.attempt()).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(onLoginFailed).toHaveBeenCalledWith(failure)
  })
})

describe('markLoginComplete', () => {
  it('retires the redirect stamp and records the login', () => {
    const store = fakeStore({ [REDIRECT_MARKER_KEY]: String(NOW - 5_000) })

    markLoginComplete(store, NOW)

    expect(store.getItem(REDIRECT_MARKER_KEY)).toBeNull()
    expect(store.getItem(LOGIN_MARKER_KEY)).toBe(String(NOW))
  })
})
