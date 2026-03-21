import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_API_URL, DEFAULT_WS_URL } from '@/lib/connectionConfig'
import { useConnectionStore } from '@/stores/connectionStore'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'connection' | 'appearance' | 'info'

export default function ConnectionConfigModal({ open, onClose }: Props) {
  const { t } = useTranslation()
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

  // — Info tab state —
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'not-available' | 'error' | 'ready'>('idle')

  useEffect(() => {
    const cleanStatus = window.electronAPI?.onUpdateStatus(setUpdateStatus)
    const cleanReady = window.electronAPI?.onUpdateReady(() => setUpdateStatus('ready'))
    return () => { cleanStatus?.(); cleanReady?.() }
  }, [])

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
          <DialogTitle>{t('appSettings.title')}</DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b border-border -mx-1 mb-2">
          {([
            ['connection', t('appSettings.tabConnection')],
            ['appearance', t('appSettings.tabAppearance')],
            ['info', t('appSettings.tabInfo')],
          ] as [Tab, string][]).map(([tabKey, label]) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={[
                'px-4 py-2 text-sm font-medium transition-colors',
                tab === tabKey
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Connection tab */}
        {tab === 'connection' && (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="api-url">{t('appSettings.apiBaseUrl')}</Label>
                <Input
                  id="api-url"
                  value={api}
                  onChange={(e) => setApi(e.target.value)}
                  placeholder="https://gochat.anticode.dev/api/v1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-url">{t('appSettings.wsUrl')}</Label>
                <Input
                  id="ws-url"
                  value={ws}
                  onChange={(e) => setWs(e.target.value)}
                  placeholder="wss://gochat.anticode.dev/ws"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('appSettings.connectionReloadHint')}
              </p>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={handleReset}>
                {t('appSettings.resetToDefaults')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
                <Button onClick={handleSave}>{t('appSettings.saveAndReload')}</Button>
              </div>
            </div>
          </>
        )}

        {/* Info tab */}
        {tab === 'info' && (() => {
          const v = window.electronAPI?.versionInfo
          const rows: [string, string][] = v
            ? [
                [t('appSettings.appVersion'), v.appVersion],
                [t('appSettings.electronVersion'), v.electron],
                [t('appSettings.chromiumVersion'), v.chrome],
                [t('appSettings.nodeVersion'), v.node],
                [t('appSettings.platform'), v.platform],
              ]
            : []
          const statusLabel: Record<typeof updateStatus, string> = {
            idle: t('appSettings.checkForUpdates'),
            checking: t('appSettings.checking'),
            'not-available': t('appSettings.upToDate'),
            error: t('appSettings.checkFailed'),
            ready: t('appSettings.updateReady'),
          }
          return (
            <div className="space-y-3 py-2">
              <div className="rounded-md border border-border overflow-hidden">
                {rows.map(([label, value], i) => (
                  <div
                    key={label}
                    className={[
                      'flex items-center justify-between px-4 py-2.5 text-sm',
                      i !== rows.length - 1 ? 'border-b border-border' : '',
                    ].join(' ')}
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono text-xs text-foreground">{value}</span>
                  </div>
                ))}
                {!v && (
                  <div className="px-4 py-3 text-sm text-muted-foreground">
                    {t('appSettings.versionInfoUnavailable')}
                  </div>
                )}
              </div>
              {v && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className={[
                    'text-xs',
                    updateStatus === 'not-available' ? 'text-green-500' : '',
                    updateStatus === 'error' ? 'text-destructive' : '',
                    updateStatus === 'ready' ? 'text-green-500' : '',
                    updateStatus === 'idle' || updateStatus === 'checking' ? 'text-muted-foreground' : '',
                  ].join(' ')}>
                    {updateStatus !== 'idle' ? statusLabel[updateStatus] : ''}
                  </span>
                  <div className="flex gap-2">
                    {updateStatus === 'ready'
                      ? <Button size="sm" onClick={() => window.electronAPI?.installUpdate()}>{t('appSettings.restartAndInstall')}</Button>
                      : <Button
                          size="sm"
                          variant="outline"
                          disabled={updateStatus === 'checking'}
                          onClick={() => window.electronAPI?.checkForUpdate()}
                        >
                          {updateStatus === 'checking' ? t('appSettings.checking') : t('appSettings.checkForUpdates')}
                        </Button>
                    }
                    <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
                  </div>
                </div>
              )}
              {!v && (
                <div className="flex justify-end pt-1">
                  <Button onClick={onClose}>{t('common.close')}</Button>
                </div>
              )}
            </div>
          )
        })()}

        {/* Appearance tab */}
        {tab === 'appearance' && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('appSettings.chatBackground')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('appSettings.chatBackgroundDesc')}
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
                {backgroundDataUrl ? t('appSettings.changeImage') : t('appSettings.chooseImage')}
              </Button>
              {backgroundDataUrl && (
                <Button variant="ghost" onClick={handleRemoveBackground}>
                  {t('common.delete')}
                </Button>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={onClose}>{t('common.done')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
