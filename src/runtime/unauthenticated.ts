/**
 * The circuit breaker around "a 401 means sign in again".
 *
 * Sending the browser to the issuer is the right answer to a session that has
 * genuinely ended, and the wrong answer to an API that refuses a perfectly
 * good token — a permission the environment never granted, a clock that
 * disagrees, a gateway answering 401 of its own accord. In the second case
 * the login succeeds, the application comes back, the next call is refused again,
 * and the person watches the address bar cycle between two origins forever.
 *
 * So a redirect is allowed only when nothing suggests it has already been
 * tried. Two stamps in `sessionStorage` — tab-scoped, so one tab's diagnosis
 * never silences another's, and gone when the tab closes:
 *
 * - the last redirect this breaker started, and
 * - the last login that actually completed.
 *
 * A 401 within the cooldown of *either* is a 401 that signing in has not
 * fixed, and it is surfaced as an `ApiError` instead. That is what bounds the
 * loop at one round trip.
 *
 * With no usable storage there is nothing to stamp — Safari in private
 * browsing, a full quota, an embedding that blocks it — and a breaker with no
 * memory is not a breaker: it would allow a redirect on every page load. So it
 * refuses to redirect at all, and the 401 surfaces as an `ApiError` the first
 * time. The write is read back to find out, because a store that throws and a
 * store that silently forgets are both this case.
 */

/** When the breaker last sent the browser to the issuer. */
export const REDIRECT_MARKER_KEY = 'kleora:unauthenticated-redirect'

/** When a redirect callback last produced a session. */
export const LOGIN_MARKER_KEY = 'kleora:last-login'

/** How long either stamp suppresses a further redirect. */
export const REDIRECT_COOLDOWN_MS = 60_000

/**
 * `sessionStorage`, or `null`.
 *
 * Safari in private browsing and any embedding that blocks storage throw on
 * access rather than answering `undefined`, so the probe is a `try`.
 */
export function browserStore(): Storage | null {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null
  } catch {
    return null
  }
}

export function readStamp(store: Storage | null, key: string): number | null {
  if (store === null) return null
  let raw: string | null
  try {
    raw = store.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  const at = Number(raw)
  return Number.isFinite(at) ? at : null
}

export function writeStamp(store: Storage | null, key: string, at: number): void {
  if (store === null) return
  try {
    store.setItem(key, String(at))
  } catch {
    // A full or blocked store costs the breaker its memory across page loads;
    // the in-flight flag below still holds within this one.
  }
}

export function clearStamp(store: Storage | null, key: string): void {
  if (store === null) return
  try {
    store.removeItem(key)
  } catch {
    // As above.
  }
}

/**
 * Record that a login completed: the redirect stamp has served its purpose
 * and is cleared, and the login itself is stamped so that a 401 arriving
 * immediately afterwards is recognised as one signing in did not fix.
 */
export function markLoginComplete(
  store: Storage | null = browserStore(),
  now: number = Date.now(),
): void {
  clearStamp(store, REDIRECT_MARKER_KEY)
  writeStamp(store, LOGIN_MARKER_KEY, now)
}

export interface UnauthenticatedRedirectDeps {
  store: Storage | null
  now: () => number
  /** Where the browser should come back to. */
  returnTo: () => string
  login: (options: { returnTo: string }) => Promise<void>
  cooldownMs?: number
  /**
   * The navigation to the issuer never happened. `attempt()` has already said
   * `true` by the time this can be known, so a caller that is showing "signing
   * you in" needs to be told; the API's own use of the breaker has an
   * `ApiError` to fall back on and passes nothing.
   */
  onLoginFailed?: (error: unknown) => void
}

export interface UnauthenticatedRedirect {
  /**
   * Send the browser to the issuer, unless signing in has already been tried.
   * `true` when this call started a redirect, `false` when the caller should
   * surface the `ApiError` instead.
   */
  attempt: () => boolean
}

export function createUnauthenticatedRedirect(
  deps: UnauthenticatedRedirectDeps,
): UnauthenticatedRedirect {
  const cooldown = deps.cooldownMs ?? REDIRECT_COOLDOWN_MS
  let inFlight = false

  function recent(key: string, now: number): boolean {
    const at = readStamp(deps.store, key)
    return at !== null && now - at >= 0 && now - at < cooldown
  }

  return {
    attempt(): boolean {
      // A page firing five calls at once gets five 401s and needs one
      // redirect. The later ones still throw their own `ApiError`; they just
      // do not navigate again.
      if (inFlight) return false

      const now = deps.now()
      if (recent(REDIRECT_MARKER_KEY, now) || recent(LOGIN_MARKER_KEY, now)) return false

      writeStamp(deps.store, REDIRECT_MARKER_KEY, now)
      // Written, then read back. A store that silently drops what it is given
      // — Safari in private browsing, an embedding that blocks storage, a full
      // quota — leaves this with no memory across page loads, and a breaker
      // with no memory is not a breaker: the redirect it starts comes back,
      // fails the same way, and starts another. The `inFlight` latch above
      // bounds a burst inside one page load and nothing beyond it. So a stamp
      // that did not persist refuses the redirect, and the caller surfaces the
      // failure it already had. A `null` store takes the same path.
      if (readStamp(deps.store, REDIRECT_MARKER_KEY) !== now) return false

      inFlight = true
      deps.login({ returnTo: deps.returnTo() }).catch((error: unknown) => {
        // The navigation never happened, so the breaker must not stay latched
        // — the next 401 is entitled to try again once the cooldown is up.
        inFlight = false
        deps.onLoginFailed?.(error)
      })
      return true
    },
  }
}
