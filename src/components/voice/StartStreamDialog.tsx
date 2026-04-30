import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Layers3, Loader2, Monitor, RefreshCw, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getSupportedStreamAudioModes } from '@/services/streamService'
import {
  DEFAULT_STREAM_QUALITY,
  STREAM_FRAME_RATE_OPTIONS,
  STREAM_RESOLUTION_OPTIONS,
  type StreamAudioMode,
  type StreamFrameRate,
  type StreamQualitySettings,
  type StreamResolution,
  type StreamSourceType,
} from '@/services/streamApi'

interface StartStreamDialogProps {
  open: boolean
  isStarting: boolean
  onOpenChange: (open: boolean) => void
  onStart: (
    sourceType: StreamSourceType,
    audioMode: StreamAudioMode,
    quality: StreamQualitySettings,
    sourceId?: string,
  ) => Promise<void> | void
}

const RESOLUTION_LABEL_KEYS: Record<StreamResolution, string> = {
  '720p': 'streams.resolution720p',
  '1080p': 'streams.resolution1080p',
  '1440p': 'streams.resolution1440p',
  '2160p': 'streams.resolution2160p',
}

function hasElectronCaptureApi(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.getDesktopCaptureSources
}

export default function StartStreamDialog({
  open,
  isStarting,
  onOpenChange,
  onStart,
}: StartStreamDialogProps) {
  const { t } = useTranslation()
  const [sourceType, setSourceType] = useState<StreamSourceType>('screen')
  const [audioMode, setAudioMode] = useState<StreamAudioMode>('desktop')
  const [resolution, setResolution] = useState<StreamResolution>(DEFAULT_STREAM_QUALITY.resolution)
  const [frameRate, setFrameRate] = useState<StreamFrameRate>(DEFAULT_STREAM_QUALITY.frameRate)
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [captureSources, setCaptureSources] = useState<DesktopCaptureSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [isLoadingSources, setIsLoadingSources] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSourcePickerOpen(false)
      return
    }
    setSourceType('screen')
    setAudioMode('desktop')
    setResolution(DEFAULT_STREAM_QUALITY.resolution)
    setFrameRate(DEFAULT_STREAM_QUALITY.frameRate)
    setCaptureSources([])
    setSelectedSourceId(null)
    setSourceError(null)
  }, [open])

  const audioModes = useMemo(() => getSupportedStreamAudioModes(sourceType), [sourceType])
  const shareAudio = audioMode !== 'none'
  const preferredAudioMode = (audioModes.find((mode) => mode !== 'none') ?? 'none') as StreamAudioMode
  const isElectronCapture = hasElectronCaptureApi()
  const electronPlatform = typeof window !== 'undefined' ? window.electronAPI?.versionInfo?.platform : null
  const useSystemAudioLabel = isElectronCapture
    && sourceType === 'application'
    && preferredAudioMode === 'application'
    && electronPlatform !== 'win32'
  const audioLabelKey = useSystemAudioLabel || preferredAudioMode === 'desktop'
    ? 'streams.audioDesktop'
    : 'streams.audioApplication'
  const quality = useMemo(() => ({ resolution, frameRate }), [resolution, frameRate])

  useEffect(() => {
    if (!audioModes.includes(audioMode)) {
      setAudioMode(audioModes[0] ?? 'none')
    }
  }, [audioMode, audioModes])

  useEffect(() => {
    if (!open || !sourcePickerOpen || !isElectronCapture) return

    let cancelled = false
    setSelectedSourceId(null)
    setCaptureSources([])
    setSourceError(null)
    setIsLoadingSources(true)

    window.electronAPI!.getDesktopCaptureSources(sourceType)
      .then((sources) => {
        if (cancelled) return
        setCaptureSources(sources)
        setSelectedSourceId(sources[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setSourceError(t('streams.sourceLoadFailed'))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSources(false)
      })

    return () => {
      cancelled = true
    }
  }, [isElectronCapture, open, sourcePickerOpen, sourceType, t])

  function handleAudioToggle(nextEnabled: boolean) {
    setAudioMode(nextEnabled ? preferredAudioMode : 'none')
  }

  async function refreshSources() {
    const api = window.electronAPI
    if (!api?.getDesktopCaptureSources) return

    setIsLoadingSources(true)
    setSourceError(null)
    try {
      const sources = await api.getDesktopCaptureSources(sourceType)
      setCaptureSources(sources)
      setSelectedSourceId((current) => (
        current && sources.some((source) => source.id === current)
          ? current
          : sources[0]?.id ?? null
      ))
    } catch {
      setSourceError(t('streams.sourceLoadFailed'))
    } finally {
      setIsLoadingSources(false)
    }
  }

  async function handleContinue() {
    if (isElectronCapture) {
      setSourcePickerOpen(true)
      return
    }
    await onStart(sourceType, audioMode, quality)
  }

  async function handleStartSelectedSource() {
    await onStart(sourceType, audioMode, quality, selectedSourceId ?? undefined)
  }

  return (
    <>
      <Dialog open={open && !sourcePickerOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg overflow-hidden border-border/70 bg-background p-0">
          <div className="border-b border-border/70 bg-background px-6 py-5">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle>{t('streams.dialogTitle')}</DialogTitle>
              <DialogDescription>{t('streams.dialogDescription')}</DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 px-6 py-5">
            <section className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t('streams.sourceLabel')}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <StreamChoiceButton
                  title={t('streams.sourceScreen')}
                  description={t('streams.sourceScreenHint')}
                  icon={<Monitor className="w-4 h-4" />}
                  selected={sourceType === 'screen'}
                  onClick={() => setSourceType('screen')}
                />
                <StreamChoiceButton
                  title={t('streams.sourceApplication')}
                  description={t('streams.sourceApplicationHint')}
                  icon={<Layers3 className="w-4 h-4" />}
                  selected={sourceType === 'application'}
                  onClick={() => setSourceType('application')}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-muted/35 px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t('streams.shareAudio')}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {shareAudio
                      ? t(audioLabelKey)
                      : t('streams.audioNone')}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={shareAudio}
                  onClick={() => handleAudioToggle(!shareAudio)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
                    shareAudio
                      ? 'border-primary/60 bg-primary/20'
                      : 'border-border/70 bg-background',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition-transform',
                      shareAudio ? 'translate-x-5' : 'translate-x-0.5',
                    )}
                  >
                    <Volume2 className="h-3 w-3" />
                  </span>
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {t('streams.resolutionLabel')}
                  </Label>
                  <Select value={resolution} onValueChange={(value) => setResolution(value as StreamResolution)}>
                    <SelectTrigger className="w-full justify-between rounded-xl bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STREAM_RESOLUTION_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t(RESOLUTION_LABEL_KEYS[option])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {t('streams.frameRateLabel')}
                  </Label>
                  <Select value={String(frameRate)} onValueChange={(value) => setFrameRate(Number(value) as StreamFrameRate)}>
                    <SelectTrigger className="w-full justify-between rounded-xl bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STREAM_FRAME_RATE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {t(
                            option === 15
                              ? 'streams.frameRate15'
                              : option === 30
                                ? 'streams.frameRate30'
                                : 'streams.frameRate60',
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {!isElectronCapture && (
              <p className="text-xs text-muted-foreground">
                {t('streams.browserCaptureHint')}
              </p>
            )}
          </div>

          <DialogFooter className="border-t border-border/70 px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isStarting}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleContinue()} disabled={isStarting}>
              {isElectronCapture ? t('streams.chooseSource') : isStarting ? t('streams.starting') : t('streams.start')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open && sourcePickerOpen} onOpenChange={(nextOpen) => {
        if (!nextOpen) setSourcePickerOpen(false)
      }}>
        <DialogContent className="flex max-h-[calc(100dvh-48px)] max-w-4xl flex-col overflow-hidden border-border/70 bg-background p-0">
          <div className="shrink-0 border-b border-border/70 bg-background px-6 py-5">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle>{t('streams.sourcePickerTitle')}</DialogTitle>
              <DialogDescription>
                {t(sourceType === 'screen' ? 'streams.sourceScreenDescription' : 'streams.sourceApplicationDescription')}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t(sourceType === 'screen' ? 'streams.sourceScreen' : 'streams.sourceApplication')}
              </p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => void refreshSources()}
                disabled={isLoadingSources || isStarting}
                title={t('streams.refreshSources')}
              >
                {isLoadingSources
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>

            {sourceError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {sourceError}
              </p>
            )}

            {!sourceError && captureSources.length === 0 && (
              <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/20 text-xs text-muted-foreground">
                {isLoadingSources ? t('streams.loadingSources') : t('streams.noSources')}
              </div>
            )}

            {captureSources.length > 0 && (
              <div className="max-h-[min(52vh,520px)] overflow-y-auto pr-1">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {captureSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedSourceId(source.id)}
                    onDoubleClick={() => {
                      setSelectedSourceId(source.id)
                      void onStart(sourceType, audioMode, quality, source.id)
                    }}
                    className={cn(
                      'overflow-hidden rounded-lg border bg-card text-left transition-colors',
                      selectedSourceId === source.id
                        ? 'border-primary/80 ring-1 ring-primary/50'
                        : 'border-border/70 hover:border-primary/50',
                    )}
                  >
                    <div className="aspect-video bg-muted">
                      {source.thumbnail ? (
                        <img
                          src={source.thumbnail}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          {sourceType === 'screen'
                            ? <Monitor className="h-8 w-8" />
                            : <Layers3 className="h-8 w-8" />}
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
                      {source.appIcon
                        ? <img src={source.appIcon} alt="" className="h-4 w-4 shrink-0" draggable={false} />
                        : sourceType === 'screen'
                          ? <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
                          : <Layers3 className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className="truncate text-xs font-medium text-foreground">
                        {source.name || t('common.unknown')}
                      </span>
                    </div>
                  </button>
                ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t border-border/70 bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setSourcePickerOpen(false)} disabled={isStarting}>
              {t('common.back')}
            </Button>
            <Button
              onClick={() => void handleStartSelectedSource()}
              disabled={isStarting || !selectedSourceId}
            >
              {isStarting ? t('streams.starting') : t('streams.start')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StreamChoiceButton({
  title,
  description,
  icon,
  selected,
  onClick,
}: {
  title: string
  description: string
  icon: ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-2xl border px-4 py-3 text-left transition-all',
        selected
          ? 'border-primary/70 bg-primary/8 shadow-[0_0_0_1px_rgba(99,102,241,0.12)]'
          : 'border-border/70 bg-card/60 hover:border-primary/40 hover:bg-card',
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full',
          selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}>
          {icon}
        </span>
        {title}
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </button>
  )
}
