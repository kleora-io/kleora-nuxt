# `@kleora-io/nuxt`

The Nuxt 4 module over `@kleora-io/browser`, which it installs for you:
composables, the `kleora-auth` route middleware, the `/auth/callback` page
and `$kleoraApi`.

## Install

```bash
npm install @kleora-io/nuxt
```

`@kleora-io/browser` comes with it as a dependency. Requires Nuxt 4 and Node 22
or newer.

## Quickstart

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@kleora-io/nuxt'],
  kleora: { issuer: '<issuer>', clientId: '<client_id>' },
})
```

```vue
<!-- pages/dashboard.vue -->
<script setup lang="ts">
definePageMeta({ auth: true })
const user = useKleoraUser()
</script>
<template>
  <p>{{ user?.email }}</p>
</template>
```

## Options

Under the `kleora` key in `nuxt.config`, and every one of them overridable
by an environment variable — the module writes them all into
`runtimeConfig.public.kleora`, because Nuxt reads `NUXT_PUBLIC_*` only for
keys that exist there at build time.

| Option | Environment variable | Default |
| --- | --- | --- |
| `issuer` | `NUXT_PUBLIC_KLEORA_ISSUER` | — (required) |
| `clientId` | `NUXT_PUBLIC_KLEORA_CLIENT_ID` | — (required) |
| `redirectUri` | `NUXT_PUBLIC_KLEORA_REDIRECT_URI` | `callbackPath` on the site's own origin |
| `scope` | `NUXT_PUBLIC_KLEORA_SCOPE` | `openid profile email offline_access` |
| `audience` | `NUXT_PUBLIC_KLEORA_AUDIENCE` | — |
| `tenant` | `NUXT_PUBLIC_KLEORA_TENANT` | — |
| `storage` | `NUXT_PUBLIC_KLEORA_STORAGE` | `memory` |
| `apiBase` | `NUXT_PUBLIC_API_BASE` | — |
| `callbackPath` | build time only | `/auth/callback` |

`apiBase` is shared with the application: an app that already declares
`runtimeConfig.public.apiBase` keeps its own value.

`callbackPath` decides where the module *mounts* its page, which is a build
-time decision, so it is the one option an environment variable must not move
— set `redirectUri` instead if a deployment needs a different URI at the same
path.

## Exports

| Export | Behaviour |
| --- | --- |
| `useKleora()` | `{ client, user, isAuthenticated, isLoading, hasLikelySession, login, logout, getAccessToken, restore, settle }`. `client` is the `@kleora-io/browser` instance. |
| `useKleoraUser()` | `Ref<User \| null>`, kept in sync through `onAuthChange`. |
| `useKleoraApi()` / `$kleoraApi` | A `$fetch` instance with `baseURL` from `apiBase` and the bearer on every request. |
| `decideSessionRender(state)` | Pure function, `{ hasMarker, isLoading, isAuthenticated } → 'shell' \| 'redirect'`. See "Session restore" below. |
| `useKleoraCallback()` | Everything the `/auth/callback` page does, for an application that supplies its own page at `callbackPath`. Call it in the page's `setup`; it returns `{ state: 'working' \| 'failed', failure: Error \| null, startAgain() }` and does the rest on mount. |
| `useAccountPortal({ section?, returnTo? })` | `{ url, open }` for the hosted account portal: `url` is a computed URL for an `<a href>`, `open()` opens a new tab (`noopener`). Nothing is auto-navigated and there is no frame option. `returnTo` may be a path on this site — `'/'` is the site root, the entry `logout()` already needs in `post_logout_redirect_uris`, which is where the portal's "back" link must be registered. **Offered only when the Client lists `self_service` in `allowed_scopes`**; otherwise the portal says managing the account there is not offered. |
| `useKleoraAccount()` | The end-user self-service API (`/account/v1/*`), typed — `@kleora-io/browser`'s `kleora.account` over this app's own token. Needs `self_service` in the Client's `allowed_scopes` **and** in `kleora.scope` (`'openid profile email offline_access self_service'`), which the default does not include. Client-only. |
| middleware `kleora-auth` | Registered globally, acts only on `definePageMeta({ auth: true })`. |
| route `/auth/callback` | Added by the module unless the application defines a page at `callbackPath`. A template over `useKleoraCallback()`: redeems the code and navigates to `appState.returnTo`. |

## SSR

Authentication is client-only. Server rendering produces the unauthenticated
shell — `isLoading: true`, `user: null`, `isAuthenticated: false` — and
`$kleoraApi` throws `LoginRequired` there, because there is no session
outside the browser. A page must therefore never fetch on the server; use
`useAsyncData(..., { server: false })` and wait for `isAuthenticated`.

Route middleware does run in the browser during hydration (Nuxt replays the
initial route through `router.beforeEach` once the app is created), so a
protected page reached by a full page load is guarded there and not only on
subsequent client navigations.

## Session restore: no re-login on reload, shell-and-skeletons while verifying

A reload with `memory` storage loses the refresh token, and so does a new tab
under `session` storage, so first paint has nothing to show until
`checkSession()` answers and — when it resolves `null`, which it does at once
without a refresh token — the redirect through the issuer comes back. Three
pieces of `useKleora()` state turn that into a smooth loading experience
rather than a flash or a blind wait:

- `hasLikelySession` — `@kleora-io/browser`'s `hasLikelySession()`, a
  render hint kept in sync across `restore()`. `true` after a sign-in that has
  not since been followed by a logout or an authoritative "no session"
  answer; never proof of a live session.
- `isLoading` / `isAuthenticated` — as before.
- `decideSessionRender({ hasMarker, isLoading, isAuthenticated })` — the pure
  decision the two combine into: `'shell'` while there is something worth
  waiting for (already authenticated, or a marker says verification is still
  running), `'redirect'` the moment there is not (no marker at all, or
  verification finished without a session).

An application wires it into its own shell:

```vue
<script setup lang="ts">
const { isLoading, isAuthenticated, hasLikelySession } = useKleora()
const decision = computed(() => decideSessionRender({
  hasMarker: hasLikelySession.value, isLoading: isLoading.value, isAuthenticated: isAuthenticated.value,
}))
</script>

<template>
  <AppChrome v-if="decision === 'shell'">
    <AppNav v-if="isAuthenticated" />
    <AppNavSkeleton v-else />
    <p class="sr-only" role="status">{{ isLoading ? 'Verifying your session…' : '' }}</p>
    <slot />
  </AppChrome>
</template>
```

The route middleware itself gets faster, not just quieter: `enforceAuth` skips
`restore()` entirely — no discovery fetch, no refresh attempt — when
`hasLikelySession()` is `false`, and
sends the browser straight to the issuer: a fresh browser certainly is not
signed in, so there is nothing to verify before redirecting to login. A
returning visitor pays the verification cost; a stranger does not.

**`isAuthenticated()` outranks the marker, though.** A document that already
holds a session is never sent to the issuer, whatever `hasLikelySession()`
answers — the same precedence `decideSessionRender()` uses one section above.
Without it the callback page's own navigation to `returnTo` would run this
middleware while the marker still read as it had *before* the redemption that
wrote it, so every first visit in a marker-less browser would authorize
**twice** — and a browser where `localStorage` throws would loop for ever.

## Things worth knowing

**The guard cancels rather than renders.** When the visitor is anonymous the
middleware calls `loginWithRedirect()` — which is a full-document navigation —
and returns `false`. The alternative is rendering a protected page for the
milliseconds until the browser leaves.

**`returnTo` is a path, never a URL.** It travels through the issuer and back
through the address bar, so the callback accepts only a same-site path;
`https://…`, `//host` and `/\host` all fall back to `/`. Otherwise a tampered
login link would choose where the application lands after sign-in.

**The callback page does nothing inside a frame.** `checkSession()` no longer
loads the issuer in a hidden iframe (the issuer refuses to be framed, so it
could only ever time out), but an older `@kleora-io/browser` did, landing a
frame on this same route; and a frame is never a place to redeem a code or to
start a redirect to the issuer, which would load it inside the page rather than
instead of it. The guard stays.

**The 401 path, and why it cannot loop.** A 401 gets exactly one retry — for
every method, because a refused request was never acted on — and that retry
takes `getAccessToken({ force: true })`, so the token actually changes rather
than the same rejected one going out twice. Other statuses keep ofetch's own
rule: one retry for a safe method, none for one that mutates, since re-sending
a `POST` the server may already have processed is the worse failure.

If the forced retry is refused too, the module does **not** navigate blindly to
the issuer. Sending the browser to sign in is the right answer to a session
that ended and the wrong answer to an API that refuses a perfectly good token —
a permission the environment never granted, a clock that disagrees, a gateway
answering 401 by itself. In the second case the login succeeds, the application
returns, the next call is refused again, and the address bar cycles between two
origins forever.

So a redirect is allowed only when nothing says it has already been tried. Two
tab-scoped stamps in `sessionStorage` — `kleora:unauthenticated-redirect` and
`kleora:last-login` — record the last redirect and the last completed login;
a 401 within a minute of either is one that signing in has not fixed, and it is
thrown as an `ApiError` for the page to render. Concurrent 401s collapse into a
single redirect through an in-app latch. `handleRedirectCallback()` retires the
redirect stamp and writes the login stamp, which is what makes the *second*
consecutive failure the one that stops.

## Development

```bash
pnpm install
pnpm test        # unit suite
pnpm lint
pnpm typecheck
pnpm build
```

`dist/` is what a consuming application resolves; `pnpm build` (also run by
the `prepare` script) writes it with `nuxt-module-build`.

### Contract tests

There are none in this package. The unit suite runs every module against
small fakes of Nuxt and a real `@kleora-io/browser` client, so it needs no
live environment and runs in CI as it is. The OAuth and account-API contract
tests live with `@kleora-io/browser`, which this module delegates to.

### Releasing

Bump `version` in `package.json` on `main`, then run the **Release** workflow
(`.github/workflows/release.yml`) by hand. It installs from the lockfile, runs
the tests, builds and publishes to npm by trusted publishing, with provenance;
no token is stored anywhere.

## Licence

[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0) —
the full, unmodified text ships inside this package, so it travels with
whatever you install. Apache-2.0 rather than a shorter permissive licence
because of the explicit patent grant in §3, which is the term a legal review of
a vendor SDK asks about.

**There is no `NOTICE` file**, here or in any other Kleora package, and that
is deliberate. Apache-2.0 §4(d) turns a `NOTICE` into an obligation that
propagates: every downstream redistributor of a work that has one must
reproduce its contents. Kleora is the sole copyright holder of the code in
these packages, so there is nothing to attribute, and a `NOTICE` would place a
requirement on you in exchange for nothing. Third-party dependencies keep their
own licences and their own notices; this package redistributes none of them —
its manifest names them and your installer fetches them.

Apache-2.0 covers what you install and compile into your own product: the
browser, Node, Nuxt and Python SDKs. It does **not** cover the rest of
Kleora — the hosted service, the API servers, the management console and the
hosted authentication pages are proprietary.
