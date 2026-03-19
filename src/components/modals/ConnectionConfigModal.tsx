import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_API_URL, DEFAULT_WS_URL } from '@/lib/connectionConfig'
import { useConnectionStore } from '@/stores/connectionStore'
import { useBackgroundStore } from '@/stores/backgroundStore'

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'connection' | 'appearance'

export default function ConnectionConfigModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('connection')

  // — Connection tab state —
  const { apiBaseUrl, wsUrl, setApiBaseUrl, setWsUrl } = useConnectionStore()
  const [api, setApi] = useState(apiBaseUrl)
  const [ws, setWs] = useState(wsUrl)

  function handleSave() {
    setApiBaseUrl(api.trim())
    setWsUrl(ws.trim())
    window.location.reload()
  }

  function handleReset() {
    setApi(DEFAULT_API_URL)
    setWs(DEFAULT_WS_URL)
  }

  // — Appearance tab state —
  const { backgroundDataUrl, setBackground } = useBackgroundStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handlePickFile() {
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setBackground(reader.result as string)
    }
    reader.readAsDataURL(file)
    // reset so same file can be picked again
    e.target.value = ''
  }

  function handleRemoveBackground() {
    setBackground(null)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>App Settings</DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b border-border -mx-1 mb-2">
          {(['connection', 'appearance'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-4 py-2 text-sm font-medium capitalize transition-colors',
                tab === t
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Connection tab */}
        {tab === 'connection' && (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="api-url">API Base URL</Label>
                <Input
                  id="api-url"
                  value={api}
                  onChange={(e) => setApi(e.target.value)}
                  placeholder="http://localhost/api/v1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-url">WebSocket URL</Label>
                <Input
                  id="ws-url"
                  value={ws}
                  onChange={(e) => setWs(e.target.value)}
                  placeholder="ws://localhost/ws/subscribe"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The app will reload after saving to apply the new connection settings.
              </p>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={handleReset}>
                Reset to defaults
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave}>Save & Reload</Button>
              </div>
            </div>
          </>
        )}

        {/* Appearance tab */}
        {tab === 'appearance' && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Chat Background</Label>
              <p className="text-xs text-muted-foreground">
                Choose a local image to use as the chat area background. It will cover the full chat window without stretching.
              </p>
            </div>

            {backgroundDataUrl && (
              <div
                className="w-full h-32 rounded-md border border-border bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: `url(${backgroundDataUrl})` }}
              />
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePickFile}>
                {backgroundDataUrl ? 'Change Image' : 'Choose Image…'}
              </Button>
              {backgroundDataUrl && (
                <Button variant="ghost" onClick={handleRemoveBackground}>
                  Remove
                </Button>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
