/**
 * `decideSessionRender` — marker + verification state → shell or redirect
 * Every case of the behaviour is one row here.
 */

import { describe, expect, it } from 'vitest'
import { decideSessionRender, type SessionRenderState } from '../src/runtime/session-render'

function state(overrides: Partial<SessionRenderState> = {}): SessionRenderState {
  return { hasMarker: false, isLoading: true, isAuthenticated: false, ...overrides }
}

describe('decideSessionRender', () => {
  it('redirects immediately with no marker at all — nothing is worth waiting for', () => {
    expect(decideSessionRender(state({ hasMarker: false, isLoading: true }))).toBe('redirect')
    expect(decideSessionRender(state({ hasMarker: false, isLoading: false }))).toBe('redirect')
  })

  it('shows the shell while a marker says verification is still worth doing', () => {
    expect(
      decideSessionRender(state({ hasMarker: true, isLoading: true, isAuthenticated: false })),
    ).toBe('shell')
  })

  it('redirects once verification has finished and failed', () => {
    expect(
      decideSessionRender(state({ hasMarker: true, isLoading: false, isAuthenticated: false })),
    ).toBe('redirect')
  })

  it('shows the shell, fully hydrated, once verification succeeds', () => {
    expect(
      decideSessionRender(state({ hasMarker: true, isLoading: false, isAuthenticated: true })),
    ).toBe('shell')
  })

  it('trusts isAuthenticated over the marker either way', () => {
    // An authenticated caller with no marker is not a state `checkSession()`
    // produces on its own, but a decision function should not need that
    // invariant held for it: being signed in is never worse than a hint.
    expect(
      decideSessionRender(state({ hasMarker: false, isLoading: false, isAuthenticated: true })),
    ).toBe('shell')
  })
})
