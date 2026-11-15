/**
 * `decideSessionRender`, auto-imported the same way `useKleora()`
 * is — it is a plain function rather than a composable, but living under
 * `runtime/composables/` is what `addImportsDir` in `module.ts` picks up, so
 * a consuming application never has to spell out an explicit import from
 * `@kleora-io/nuxt`.
 *
 * `module.ts`'s own bottom `export type` block is deliberately types-only
 * (nuxt-module-build's `dist/types.d.mts` treats every re-export there as a
 * type, which is correct for every other name in that block but would make
 * this one unimportable as a value); this file is the runtime home instead.
 */
export { decideSessionRender } from '../session-render'
export type { SessionRenderDecision, SessionRenderState } from '../session-render'
