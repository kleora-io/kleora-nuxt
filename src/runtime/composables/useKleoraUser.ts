/**
 * `useKleoraUser()` — the ID-token claims, kept in sync through
 * `onAuthChange`. `null` while signed out and throughout server rendering.
 */

import type { User } from '@kleora-io/browser'
import type { Ref } from 'vue'
import { useKleora } from './useKleora'

export function useKleoraUser(): Ref<User | null> {
  return useKleora().user
}
