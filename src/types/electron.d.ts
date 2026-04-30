/**
 * Optional Electron desktop API — exposed by preload.ts via contextBridge.
 * All properties are optional: this object only exists when running inside Electron.
 * Web code should always use optional chaining: window.electronAPI?.notify(...)
 */
interface ElectronAPI {
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
  notify: (opts: { title: string; body: string }) => void
  setTrayBadge: (count: number) => void
  onDeepLink: (cb: (url: string) => void) => () => void
  openExternal: (url: string) => void
  getDesktopCaptureSources: (sourceType: 'screen' | 'application') => Promise<DesktopCaptureSource[]>
  setDesktopCaptureSource: (selection: { sourceId: string; sourceType: 'screen' | 'application'; audioMode: 'desktop' | 'application' | 'none' } | null) => Promise<void>
  startApplicationAudioCapture: (sourceId: string) => Promise<ApplicationAudioCaptureSession>
  stopApplicationAudioCapture: (captureId: string) => Promise<void>
  onApplicationAudioData: (cb: (captureId: string, chunk: Uint8Array) => void) => () => void
  onApplicationAudioStopped: (cb: (captureId: string) => void) => () => void
  onUpdateReady: (cb: () => void) => () => void
  installUpdate: () => void
  checkForUpdate: () => void
  onUpdateStatus: (cb: (status: 'checking' | 'not-available' | 'error') => void) => () => void
  versionInfo: {
    appVersion: string
    electron: string
    chrome: string
    node: string
    platform: string
  }
  secureStore: {
    get: (key: string) => string | null
    set: (key: string, value: string) => void
    delete: (key: string) => void
  }
}

interface DesktopCaptureSource {
  id: string
  name: string
  displayId: string
  thumbnail: string
  appIcon: string | null
}

interface ApplicationAudioCaptureSession {
  id: string
  sampleRate: number
  channels: number
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
