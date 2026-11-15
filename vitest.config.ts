import { defineConfig } from 'vitest/config'

// The `node` environment: every unit here tests a
// framework-free function — the guard, the callback outcome, the option
// resolver, the `$kleoraApi` hooks — against small fakes, so no DOM
// implementation is needed and nothing pulls a Nuxt application into the run.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
