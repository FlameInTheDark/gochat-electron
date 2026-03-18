import { useEffect, useState } from 'react'
import { Minus, Square, X, Maximize2, Settings } from 'lucide-react'
import ConnectionConfigModal from '@/components/modals/ConnectionConfigModal'

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
      notify: (opts: { title: string; body: string }) => void
      setTrayBadge: (count: number) => void
      onDeepLink: (cb: (url: string) => void) => () => void
      openExternal: (url: string) => void
      secureStore: {
        get: (key: string) => string | null
        set: (key: string, value: string) => void
        delete: (key: string) => void
      }
    }
  }
}

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.isMaximized().then(setIsMaximized)
    const cleanup = window.electronAPI.onMaximizeChange(setIsMaximized)
    return cleanup
  }, [])

  return (
    <>
      <div
        className="flex items-center justify-between h-8 bg-[#1e1f22] select-none shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => setConfigOpen(true)}
            className="w-8 h-full flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white/80 transition-colors"
            title="Connection settings"
          >
            <Settings size={13} />
          </button>
        </div>

        <span className="absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-white/30 tracking-widest uppercase pointer-events-none">
          GoChat
        </span>

        <div
          className="flex h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => window.electronAPI?.minimize()}
            className="w-12 h-full flex items-center justify-center text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => window.electronAPI?.maximize()}
            className="w-12 h-full flex items-center justify-center text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            {isMaximized ? <Maximize2 size={12} /> : <Square size={12} />}
          </button>
          <button
            onClick={() => window.electronAPI?.close()}
            className="w-12 h-full flex items-center justify-center text-white/60 hover:bg-red-500 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <ConnectionConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </>
  )
}
