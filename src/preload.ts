import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizeChange: (cb: (maximized: boolean) => void) => {
    const onMax = () => cb(true);
    const onUnmax = () => cb(false);
    ipcRenderer.on('window:maximized', onMax);
    ipcRenderer.on('window:unmaximized', onUnmax);
    return () => {
      ipcRenderer.removeListener('window:maximized', onMax);
      ipcRenderer.removeListener('window:unmaximized', onUnmax);
    };
  },

  // Native notifications
  notify: (opts: { title: string; body: string }) =>
    ipcRenderer.send('notify', opts),

  // Tray / dock badge
  setTrayBadge: (count: number) => ipcRenderer.send('tray:badge', count),

  // Deep link navigation
  onDeepLink: (cb: (url: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, url: string) => cb(url);
    ipcRenderer.on('deep-link', handler);
    return () => ipcRenderer.removeListener('deep-link', handler);
  },

  // Open URLs in system browser
  openExternal: (url: string) => ipcRenderer.send('shell:open-external', url),

  // Secure token storage (OS-encrypted via safeStorage in main process).
  // Synchronous so authStore can read tokens at module-init time.
  secureStore: {
    get: (key: string): string | null => ipcRenderer.sendSync('secure-store:get', key),
    set: (key: string, value: string): void => { ipcRenderer.sendSync('secure-store:set', key, value); },
    delete: (key: string): void => { ipcRenderer.sendSync('secure-store:delete', key); },
  },
});
