/**
 * `shouldRestoreOnBoot` — the plugin's "start `restore()` now?" decision,
 * extracted so it is testable on its own.
 */

import { describe, expect, it } from 'vitest'
import { shouldRestoreOnBoot, type RestoreOnBootState } from '../src/runtime/restore-on-boot'

const CALLBACK_PATH = '/auth/callback'

function state(overrides: Partial<RestoreOnBootState> = {}): RestoreOnBootState {
  return { browser: true, inFrame: false, pathname: '/', callbackPath: CALLBACK_PATH, ...overrides }
}

describe('shouldRestoreOnBoot', () => {
  // The case a marker-gated exclusion would break: a browser with no session
  // marker, on an unguarded page (no `definePageMeta({ auth: true })`, so
  // nothing else will ever call `restore()` for it). Nothing about a marker
  // appears anywhere in this test file, deliberately — that is the point.
  // A `hasLikelySession` (or similarly named) gate added back to
  // `shouldRestoreOnBoot` would either fail to compile against this file's
  // `RestoreOnBootState` (no such field) or, if defaulted, fail this
  // assertion outright.
  it('restores unconditionally on an ordinary page — no marker required', () => {
    expect(shouldRestoreOnBoot(state())).toBe(true)
  })

  it('never restores during server rendering — there is no session to recover', () => {
    expect(shouldRestoreOnBoot(state({ browser: false }))).toBe(false)
    // Not in a browser is refused before anything else is even asked.
    expect(shouldRestoreOnBoot(state({ browser: false, inFrame: true }))).toBe(false)
  })

  it('never restores inside the silent-reauthentication iframe', () => {
    // The iframe would race the parent for the same single-use `state` in
    // `sessionStorage`; whichever won, the other would report no session.
    expect(shouldRestoreOnBoot(state({ inFrame: true }))).toBe(false)
  })

  it('never restores on the callback route — it completes the login itself', () => {
    expect(shouldRestoreOnBoot(state({ pathname: CALLBACK_PATH }))).toBe(false)
  })

  it('restores on every other page, browser, outside a frame', () => {
    expect(shouldRestoreOnBoot(state({ pathname: '/dashboard' }))).toBe(true)
    expect(shouldRestoreOnBoot(state({ pathname: '/' }))).toBe(true)
  })
})
