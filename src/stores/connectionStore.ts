import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setConnectionConfig } from '@/lib/connectionConfig'

const DEFAULT_API_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost/api/v1'
const DEFAULT_WS_URL = (import.meta.env.VITE_WEBSOCKET_URL as string | undefined) ?? 'ws://localhost/ws/subscribe'

interface ConnectionState {
  apiBaseUrl: string
  wsUrl: string
  setApiBaseUrl: (url: string) => void
  setWsUrl: (url: string) => void
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      apiBaseUrl: DEFAULT_API_URL,
      wsUrl: DEFAULT_WS_URL,
      setApiBaseUrl: (url) => {
        set({ apiBaseUrl: url })
        setConnectionConfig({ apiBaseUrl: url })
      },
      setWsUrl: (url) => {
        set({ wsUrl: url })
        setConnectionConfig({ wsUrl: url })
      },
    }),
    { name: 'gochat-connection' },
  ),
)

// Seed connectionConfig with the persisted values at module-load time so that
// api/client.ts and wsService.ts see the correct URL before React hydrates.
;(function initConnectionConfig() {
  try {
    const stored = localStorage.getItem('gochat-connection')
    if (stored) {
      const parsed = JSON.parse(stored) as { state?: { apiBaseUrl?: string; wsUrl?: string } }
      setConnectionConfig({
        apiBaseUrl: parsed.state?.apiBaseUrl ?? DEFAULT_API_URL,
        wsUrl: parsed.state?.wsUrl ?? DEFAULT_WS_URL,
      })
      return
    }
  } catch {
    // ignore
  }
  setConnectionConfig({ apiBaseUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL })
})()
