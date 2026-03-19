import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, Notification, safeStorage, autoUpdater } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

if (started) app.quit();

// ── Deep link protocol ────────────────────────────────────────────────────────
app.setAsDefaultProtocolClient('gochat');

// Enforce single instance so deep links on Windows focus the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── Secure token storage (safeStorage — OS-level encryption) ─────────────────
// Tokens are encrypted with DPAPI (Windows), Keychain (macOS), or
// libsecret/kwallet (Linux) and stored as base64 in secure-store.json.
// IPC is synchronous so the renderer authStore can load tokens at module init.
const SECURE_STORE_FILE = path.join(app.getPath('userData'), 'secure-store.json');

function readSecureStoreFile(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(SECURE_STORE_FILE, 'utf-8')); }
  catch { return {}; }
}
function writeSecureStoreFile(data: Record<string, string>) {
  fs.writeFileSync(SECURE_STORE_FILE, JSON.stringify(data), { mode: 0o600 });
}

// secure-store:get  → decrypted string | null
ipcMain.on('secure-store:get', (e, key: string) => {
  if (!safeStorage.isEncryptionAvailable()) { e.returnValue = null; return; }
  const encrypted = readSecureStoreFile()[key];
  if (!encrypted) { e.returnValue = null; return; }
  try { e.returnValue = safeStorage.decryptString(Buffer.from(encrypted, 'base64')); }
  catch { e.returnValue = null; }
});

// secure-store:set  → void (encrypts and writes to file)
ipcMain.on('secure-store:set', (e, key: string, value: string) => {
  if (!safeStorage.isEncryptionAvailable()) { e.returnValue = false; return; }
  const store = readSecureStoreFile();
  store[key] = safeStorage.encryptString(value).toString('base64');
  writeSecureStoreFile(store);
  e.returnValue = true;
});

// secure-store:delete  → void
ipcMain.on('secure-store:delete', (e, key: string) => {
  const store = readSecureStoreFile();
  delete store[key];
  writeSecureStoreFile(store);
  e.returnValue = true;
});

// ── Window state persistence ──────────────────────────────────────────────────
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

interface WindowState {
  x?: number; y?: number;
  width: number; height: number;
  maximized: boolean;
}

function loadWindowState(): WindowState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as WindowState;
  } catch {
    return { width: 1280, height: 800, maximized: false };
  }
}

function saveWindowState(win: BrowserWindow) {
  const maximized = win.isMaximized();
  const bounds = maximized ? undefined : win.getBounds();
  const prev = loadWindowState();
  const next: WindowState = {
    x: bounds?.x ?? prev.x,
    y: bounds?.y ?? prev.y,
    width: bounds?.width ?? prev.width,
    height: bounds?.height ?? prev.height,
    maximized,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next));
}

// ── Globals ───────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  // Replace with a proper 16x16 (Windows) / 22x22 (Linux) icon file.
  // On macOS use a Template image (white/transparent) named icon@2x.png.
  const iconPath = path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    'assets',
    'tray.png',
  );
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('GoChat');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open GoChat',
      click: () => { mainWindow?.show(); mainWindow?.focus(); },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ── Window ────────────────────────────────────────────────────────────────────
const createWindow = () => {
  const state = loadWindowState();

  const iconPath = path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    'build', 'icons', 'png', '512x512.png',
  );

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    backgroundColor: '#1e1f22',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (state.maximized) mainWindow.maximize();

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.once('ready-to-show', () => { mainWindow?.show(); });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized');
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:unmaximized');
  });

  // Save state before closing; hide to tray instead of quitting.
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      if (mainWindow) saveWindowState(mainWindow);
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
};

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.on('ready', () => {
  createWindow();
  createTray();

  // Auto-updater — only runs in packaged builds.
  // Reads repository.url from package.json and checks GitHub releases.
  if (app.isPackaged) {
    import('update-electron-app').then(({ updateElectronApp }) => {
      updateElectronApp({ updateInterval: '1 hour' });
      autoUpdater.on('update-downloaded', () => {
        mainWindow?.webContents.send('update:ready');
      });
    }).catch(() => { /* no-op if package not installed */ });
  }
});

app.on('window-all-closed', () => {
  // Keep app alive in system tray on all platforms.
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});

// Prevent a second instance; focus existing window and handle deep link.
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  const url = argv.find((a) => a.startsWith('gochat://'));
  if (url) mainWindow?.webContents.send('deep-link', url);
});

// macOS deep link
app.on('open-url', (_event, url) => {
  mainWindow?.webContents.send('deep-link', url);
});

// Mark as quitting so the close handler lets the window actually close.
app.on('before-quit', () => { app.isQuitting = true; });

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.on('window:minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});

ipcMain.on('window:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.isMaximized() ? win.unmaximize() : win?.maximize();
});

ipcMain.on('window:close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

ipcMain.handle('window:is-maximized', (e) => {
  return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false;
});

ipcMain.on('notify', (_e, { title, body }: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.on('tray:badge', (_e, count: number) => {
  // macOS dock badge
  if (process.platform === 'darwin') app.setBadgeCount(count);

  // Windows taskbar overlay icon
  if (process.platform === 'win32' && mainWindow) {
    if (count > 0) {
      const badge = nativeImage.createFromDataURL(makeBadgeDataUrl(count));
      mainWindow.setOverlayIcon(badge, `${count} unread`);
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  }

  // Update tray tooltip
  tray?.setToolTip(count > 0 ? `GoChat (${count} unread)` : 'GoChat');
});

ipcMain.on('shell:open-external', (_e, url: string) => {
  shell.openExternal(url);
});

ipcMain.on('update:install', () => {
  app.isQuitting = true;
  autoUpdater.quitAndInstall();
});

// ── Badge canvas helper ───────────────────────────────────────────────────────
function makeBadgeDataUrl(count: number): string {
  // Minimal 20x20 red circle with white number — no canvas needed.
  const label = count > 99 ? '99+' : String(count);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
    <circle cx="10" cy="10" r="10" fill="#ed4245"/>
    <text x="10" y="14" text-anchor="middle" font-size="${label.length > 2 ? 7 : 10}"
      font-family="Arial" fill="white" font-weight="bold">${label}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// TypeScript: extend app type for isQuitting flag
declare module 'electron' {
  interface App { isQuitting: boolean; }
}
app.isQuitting = false;
