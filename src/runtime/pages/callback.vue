<script setup lang="ts">
/**
 * `/auth/callback` — the redirect target the module mounts.
 *
 * Deliberately plain: it exists for the two seconds between the issuer and
 * the page the person actually asked for, and it cannot assume the host
 * application's stylesheet.
 *
 * Everything it *does* is `useKleoraCallback()`, so an application that
 * supplies its own page here runs exactly this logic under its own template.
 */
import { computed } from 'vue'
import { useKleoraCallback } from '../composables/useKleoraCallback.js'

const callback = useKleoraCallback()

/** What the page shows for whatever went wrong: the message, as it always was. */
const failure = computed(() => callback.failure.value?.message ?? null)
</script>

<template>
  <main class="kleora-callback">
    <p v-if="failure === null">
      Signing you in…
    </p>
    <template v-else>
      <p>Sign-in could not be completed.</p>
      <p>{{ failure }}</p>
      <p>
        <a href="/">Start again</a>
      </p>
    </template>
  </main>
</template>
