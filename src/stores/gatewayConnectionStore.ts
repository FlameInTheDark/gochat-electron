import { create } from 'zustand'

export type GatewayConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'authenticated'
  | 'ready'
  | 'reconnecting'
  | 'offline'
  | 'disconnected'

interface GatewayConnectionState {
  status: GatewayConnectionStatus
  ready: boolean
  attempt: number
  lastReadyAt: number | null
  setStatus: (status: GatewayConnectionStatus) => void
  markReady: () => void
  reset: () => void
}

export const useGatewayConnectionStore = create<GatewayConnectionState>((set) => ({
  status: 'idle',
  ready: false,
  attempt: 0,
  lastReadyAt: null,

  setStatus: (status) => set((state) => ({
    status,
    ready: status === 'ready',
    attempt: status === 'connecting' || status === 'reconnecting'
      ? state.attempt + 1
      : state.attempt,
  })),

  markReady: () => set({
    status: 'ready',
    ready: true,
    lastReadyAt: Date.now(),
  }),

  reset: () => set({
    status: 'idle',
    ready: false,
    attempt: 0,
    lastReadyAt: null,
  }),
}))
