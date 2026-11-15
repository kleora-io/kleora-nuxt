/**
 * `useKleoraCallback()`: the `/auth/callback` page's logic,
 * driven the way a page drives it — call it in `setup`, let it mount — against
 * a fake `$kleora` and a fake window.
 *
 * `onMounted` is captured rather than run by a component, and `nuxt/app` is
 * replaced, so the unit stays framework-free like every other one in this
 * package (`vitest.config.ts`: the `node` environment, no Nuxt application).
 */

import { LoginRequired } from '@kleora-io/browser'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { KleoraContext } from '../src/runtime/state'
import { LOGIN_MARKER_KEY, REDIRECT_MARKER_KEY } from '../src/runtime/unauthenticated'

const mounted: Array<() => void> = []
const navigateTo = vi.fn<(to: string, options?: unknown) => Promise<void>>(() => Promise.resolve())
let kleora: KleoraContext | undefined

vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: (hook: () => void) => void mounted.push(hook),
}))

vi.mock('nuxt/app', () => ({
  navigateTo: (to: string, options?: unknown) => navigateTo(to, options),
  useNuxtApp: () => ({ $kleora: kleora }),
}))

const { useKleoraCallback } = await import('../src/runtime/composables/useKleoraCallback')

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

interface Fakes {
  handleRedirectCallback: Mock<() => Promise<unknown>>
  restore: Mock<() => Promise<void>>
  login: Mock<(options?: unknown) => Promise<void>>
  settle: Mock<() => void>
  authenticated: { value: boolean }
}

function fakeKleora(overrides: Partial<Fakes> = {}): Fakes {
  const fakes: Fakes = {
    handleRedirectCallback: vi.fn<() => Promise<unknown>>(() =>
      Promise.resolve({ appState: { returnTo: '/apps/acme' } }),
    ),
    restore: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    login: vi.fn<(options?: unknown) => Promise<void>>(() => Promise.resolve()),
    settle: vi.fn<() => void>(),
    authenticated: { value: false },
    ...overrides,
  }
  kleora = {
    client: { handleRedirectCallback: fakes.handleRedirectCallback },
    restore: fakes.restore,
    login: fakes.login,
    settle: fakes.settle,
    isAuthenticated: fakes.authenticated,
  } as unknown as KleoraContext
  return fakes
}

/** A top-level window on the callback URL, or a frame inside another one. */
function stubWindow(search: string, { framed = false } = {}): void {
  const self = {}
  vi.stubGlobal('window', {
    self,
    top: framed ? {} : self,
    location: { search },
  })
}

/** Mount the page: run every `onMounted` hook, then let the async body finish. */
async function mount(): Promise<void> {
  for (const hook of mounted.splice(0)) hook()
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

let store: Storage

beforeEach(() => {
  mounted.length = 0
  navigateTo.mockClear()
  store = memoryStorage()
  vi.stubGlobal('sessionStorage', store)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useKleoraCallback', () => {
  it('redeems the code, settles, stamps the login and goes where the login started', async () => {
    const fakes = fakeKleora()
    stubWindow('?code=abc&state=xyz')
    store.setItem(REDIRECT_MARKER_KEY, '1')

    const callback = useKleoraCallback()
    expect(callback.state.value).toBe('working')
    await mount()

    expect(fakes.handleRedirectCallback).toHaveBeenCalledOnce()
    expect(fakes.settle).toHaveBeenCalledOnce()
    expect(navigateTo).toHaveBeenCalledWith('/apps/acme', { replace: true })
    expect(store.getItem(REDIRECT_MARKER_KEY)).toBeNull()
    expect(store.getItem(LOGIN_MARKER_KEY)).not.toBeNull()
    expect(callback.state.value).toBe('working')
    expect(callback.failure.value).toBeNull()
  })

  it('does nothing at all inside a frame, where checkSession() reads the URL itself', async () => {
    const fakes = fakeKleora()
    stubWindow('?code=abc&state=xyz', { framed: true })

    const callback = useKleoraCallback()
    await mount()

    expect(fakes.handleRedirectCallback).not.toHaveBeenCalled()
    expect(fakes.restore).not.toHaveBeenCalled()
    expect(fakes.settle).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
    expect(callback.state.value).toBe('working')
  })

  it('reports an error= response as the failure, and never recovers past it', async () => {
    const refusal = new Error('access_denied')
    const fakes = fakeKleora({ handleRedirectCallback: vi.fn(() => Promise.reject(refusal)) })
    stubWindow('?error=access_denied&state=xyz')

    const callback = useKleoraCallback()
    await mount()

    expect(fakes.restore).not.toHaveBeenCalled()
    expect(fakes.login).not.toHaveBeenCalled()
    expect(fakes.settle).toHaveBeenCalledOnce()
    expect(callback.state.value).toBe('failed')
    expect(callback.failure.value).toBe(refusal)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('starts exactly one bounded login for a code it cannot redeem, and keeps working', async () => {
    const fakes = fakeKleora({
      handleRedirectCallback: vi.fn(() => Promise.reject(new Error('invalid_state'))),
    })
    stubWindow('?code=abc&state=elsewhere')

    const callback = useKleoraCallback()
    await mount()

    expect(fakes.restore).toHaveBeenCalledOnce()
    expect(fakes.login).toHaveBeenCalledOnce()
    expect(fakes.login).toHaveBeenCalledWith({ returnTo: '/' })
    expect(store.getItem(REDIRECT_MARKER_KEY)).not.toBeNull()
    expect(callback.state.value).toBe('working')

    // A second arrival inside the cooldown: the breaker refuses, and the
    // redemption's own error is shown instead of another round trip.
    const again = useKleoraCallback()
    await mount()
    expect(fakes.login).toHaveBeenCalledOnce()
    expect(again.state.value).toBe('failed')
    expect(again.failure.value?.message).toBe('invalid_state')
  })

  it('without sessionStorage there is no breaker, so no login is started', async () => {
    vi.stubGlobal('sessionStorage', undefined)
    const fakes = fakeKleora({
      handleRedirectCallback: vi.fn(() => Promise.reject(new Error('invalid_state'))),
    })
    stubWindow('?code=abc&state=xyz')

    const callback = useKleoraCallback()
    await mount()

    expect(fakes.login).not.toHaveBeenCalled()
    expect(callback.state.value).toBe('failed')
  })

  it('reports a login the breaker started that never navigated', async () => {
    const fakes = fakeKleora({
      handleRedirectCallback: vi.fn(() => Promise.reject(new Error('invalid_state'))),
      login: vi.fn(() => Promise.reject(new Error('the issuer could not be reached'))),
    })
    stubWindow('?code=abc&state=elsewhere')

    const callback = useKleoraCallback()
    await mount()

    expect(fakes.login).toHaveBeenCalledOnce()
    expect(callback.state.value).toBe('failed')
    expect(callback.failure.value?.message).toBe('the issuer could not be reached')
  })

  it('a parameterless arrival with no session is LoginRequired', async () => {
    fakeKleora()
    stubWindow('')

    const callback = useKleoraCallback()
    await mount()

    expect(callback.failure.value).toBeInstanceOf(LoginRequired)
  })

  it('never leaves the page spinning when something throws past the outcome', async () => {
    const fakes = fakeKleora()
    navigateTo.mockImplementationOnce(() => Promise.reject(new Error('navigation aborted')))
    stubWindow('?code=abc&state=xyz')

    const callback = useKleoraCallback()
    await mount()

    // Settled once by the success path and once more by the catch, exactly as
    // the page's inline script did.
    expect(fakes.settle).toHaveBeenCalledTimes(2)
    expect(callback.state.value).toBe('failed')
    expect(callback.failure.value?.message).toBe('navigation aborted')
  })

  it('wraps a thrown non-Error so the page always has a message', async () => {
    fakeKleora({
      // A rejection that is not an `Error` is exactly what this test is about.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      handleRedirectCallback: vi.fn(() => Promise.reject('plain string')),
    })
    stubWindow('?error=server_error')

    const callback = useKleoraCallback()
    await mount()

    expect(callback.failure.value).toBeInstanceOf(Error)
    expect(callback.failure.value?.message).toBe('plain string')
  })

  it('startAgain() is a fresh login from the site root, reported if it cannot begin', async () => {
    const fakes = fakeKleora({
      handleRedirectCallback: vi.fn(() => Promise.reject(new Error('server_error'))),
    })
    stubWindow('?error=server_error')

    const callback = useKleoraCallback()
    await mount()
    expect(callback.state.value).toBe('failed')

    await callback.startAgain()
    expect(fakes.login).toHaveBeenCalledWith({ returnTo: '/' })

    fakes.login.mockImplementationOnce(() => Promise.reject(new Error('blocked')))
    await callback.startAgain()
    expect(callback.failure.value?.message).toBe('blocked')
  })
})
