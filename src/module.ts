/**
 * `@kleora-io/nuxt` — the Nuxt 4 module over `@kleora-io/browser`.
 *
 * What it installs: a plugin that owns the client and the reactive state,
 * `useKleora()` / `useKleoraUser()` / `useKleoraApi()` /
 * `useKleoraCallback()`, the global
 * `kleora-auth` route middleware, the `/auth/callback` page, and
 * `$kleoraApi`.
 *
 * ```ts
 * export default defineNuxtConfig({
 *   modules: ['@kleora-io/nuxt'],
 *   kleora: { issuer: '<issuer>', clientId: '<client_id>' },
 * })
 * ```
 */

import {
  addImportsDir,
  addPlugin,
  addRouteMiddleware,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
  extendPages,
} from '@nuxt/kit'
import type { StorageStrategy } from '@kleora-io/browser'
import type { NuxtModule } from '@nuxt/schema'
import { defu } from 'defu'

export interface ModuleOptions {
  /**
   * The environment's issuer, e.g. `https://acme.kleora.eu`.
   * `NUXT_PUBLIC_KLEORA_ISSUER`.
   */
  issuer: string
  /** The `spa` Client's `client_id`. `NUXT_PUBLIC_KLEORA_CLIENT_ID`. */
  clientId: string
  /**
   * Where the issuer sends the browser back. Defaults to `callbackPath` on
   * the origin the page is served from. `NUXT_PUBLIC_KLEORA_REDIRECT_URI`.
   */
  redirectUri?: string
  /** Default `openid profile email offline_access`. */
  scope?: string
  /** The environment's `api_audience`, when it declares one. */
  audience?: string
  /** Pin every login to one tenant slug. */
  tenant?: string
  /** Where the refresh token lives. Default `memory`; never `localStorage`. */
  storage?: StorageStrategy
  /** Management API base for `$kleoraApi`. `NUXT_PUBLIC_API_BASE`. */
  apiBase?: string
  /** Where the module mounts its callback page. Must match `redirectUri`'s path. */
  callbackPath?: string
}

/** The middleware's name, the callback route's name, and its default path. */
const MIDDLEWARE_NAME = 'kleora-auth'
const CALLBACK_ROUTE_NAME = 'kleora-auth-callback'
const DEFAULT_CALLBACK_PATH = '/auth/callback'

// Annotated rather than inferred: without it the emitted declaration names a
// type from `@nuxt/schema` by its resolved path, which TypeScript refuses to
// write (TS2742).
const kleoraModule: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@kleora-io/nuxt',
    configKey: 'kleora',
    compatibility: { nuxt: '>=4.0.0' },
  },
  // Every key is present and stringy on purpose: Nuxt only reads
  // `NUXT_PUBLIC_*` for keys that exist in the runtime config at build time,
  // so an option omitted here could never be supplied by the environment.
  defaults: {
    issuer: '',
    clientId: '',
    redirectUri: '',
    scope: '',
    audience: '',
    tenant: '',
    storage: 'memory',
    apiBase: '',
    callbackPath: DEFAULT_CALLBACK_PATH,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH

    const runtimeConfig = nuxt.options.runtimeConfig
    runtimeConfig.public = defu(runtimeConfig.public, {
      // `apiBase` is shared with the application, which may well use the
      // same key for its own calls, so defu leaves whatever nuxt.config
      // already set.
      apiBase: options.apiBase ?? '',
      kleora: {
        issuer: options.issuer,
        clientId: options.clientId,
        redirectUri: options.redirectUri ?? '',
        scope: options.scope ?? '',
        audience: options.audience ?? '',
        tenant: options.tenant ?? '',
        storage: options.storage ?? 'memory',
        callbackPath,
      },
    })

    const runtimeDir = resolver.resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)

    addPlugin(resolver.resolve('./runtime/plugin'))
    addImportsDir(resolver.resolve('./runtime/composables'))

    // Global rather than per-page: the guard is keyed on `meta.auth`, so a
    // page opts in with `definePageMeta({ auth: true })` and a page that
    // forgets to list the middleware cannot silently lose its protection.
    addRouteMiddleware({
      name: MIDDLEWARE_NAME,
      path: resolver.resolve('./runtime/middleware/kleora-auth'),
      global: true,
    })

    extendPages((pages) => {
      if (pages.some((page) => page.path === callbackPath)) return
      pages.unshift({
        name: CALLBACK_ROUTE_NAME,
        path: callbackPath,
        file: resolver.resolve('./runtime/pages/callback.vue'),
      })
    })

    addTypeTemplate({
      filename: 'types/kleora-auth.d.ts',
      getContents: () => TYPES,
    })
  },
})

export default kleoraModule

/**
 * What the application's own typecheck needs to know: the two injections, and
 * the page metadata flag the middleware reads.
 *
 * The types are pulled from this package rather than from `ofetch` and
 * `@kleora-io/browser` directly, because under a strict `node_modules`
 * layout an application that installed only `@kleora-io/nuxt` cannot
 * resolve either of them by name.
 */
const TYPES = `import type { KleoraApi, KleoraContext } from '@kleora-io/nuxt'

declare module '#app' {
  interface NuxtApp {
    $kleora: KleoraContext
    $kleoraApi: KleoraApi
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $kleora: KleoraContext
    $kleoraApi: KleoraApi
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    /** Set by \`definePageMeta({ auth: true })\`; read by the \`kleora-auth\` middleware. */
    auth?: boolean
  }
}

export {}
`

export type { KleoraApi, ProblemCarrier, ProblemDetails } from './runtime/api'
export type { KleoraContext, KleoraContextOptions } from './runtime/state'
export type { PublicKleoraConfig } from './runtime/config'
export type { CallbackOutcome } from './runtime/callback'
export type { GuardDeps, GuardRoute } from './runtime/guard'
// `decideSessionRender` itself is a Nuxt auto-import, not a manual one — see
// `runtime/composables/useSessionRender.ts`.
export type { SessionRenderDecision, SessionRenderState } from './runtime/session-render'
