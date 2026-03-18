/**
 * Electron bridge — runs only in the renderer process when inside Electron.
 * Watches Zustand stores and wires them to native desktop APIs exposed via
 * window.electronAPI (preload). No web-source files are modified.
 */
import { useMentionStore } from '@/stores/mentionStore'
import { useUnreadStore } from '@/stores/unreadStore'

function totalMentions(
  mentions: Record<string, { messageIds: string[] }>,
): number {
  return Object.values(mentions).reduce((n, e) => n + e.messageIds.length, 0)
}

export function setupElectronBridge() {
  if (typeof window === 'undefined' || !('electronAPI' in window)) return

  const api = window.electronAPI

  // ── Tray badge + dock badge ─────────────────────────────────────────────
  // Badge = total mention count (unread channels alone are too noisy).
  let prevMentionCount = totalMentions(useMentionStore.getState().mentions)
  api.setTrayBadge(prevMentionCount)

  useMentionStore.subscribe((state) => {
    const count = totalMentions(state.mentions)
    api.setTrayBadge(count)

    // New mention arrived → native notification
    if (count > prevMentionCount) {
      api.notify({
        title: 'GoChat',
        body: 'You have new mentions',
      })
    }

    prevMentionCount = count
  })

  // Keep badge in sync when mentions are cleared (channel read, etc.)
  useUnreadStore.subscribe(() => {
    const count = totalMentions(useMentionStore.getState().mentions)
    api.setTrayBadge(count)
  })

  // ── Deep links ──────────────────────────────────────────────────────────
  // main.ts sends 'deep-link' via IPC; bridge re-dispatches as a DOM event
  // so a React hook can call navigate() from inside the router context.
  api.onDeepLink((url: string) => {
    window.dispatchEvent(new CustomEvent('electron:deep-link', { detail: url }))
  })
}
