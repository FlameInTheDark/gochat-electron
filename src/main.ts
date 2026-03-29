import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, Notification, safeStorage, autoUpdater } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

const USER_DATA_DIR = path.join(app.getPath('appData'), 'gochat-electron');
const SESSION_DATA_DIR = path.join(USER_DATA_DIR, 'session-data');
const SESSION_DATA_MIGRATION_MARKER = path.join(SESSION_DATA_DIR, '.migrated-from-user-data');
const SESSION_DATA_MIGRATION_ENTRIES = [
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Network',
  'Preferences',
] as const;

// Keep app-owned files in the stable userData root and move Chromium storage
// into a dedicated sessionData folder so updates do not fight over the old cache.
app.setName('GoChat');
// Windows: set the AppUserModelId so notifications show "GoChat" instead of "Electron".
// Packaged (Squirrel): use the id Squirrel registers: com.squirrel.{ProductName}.{ProductName}
// Dev: use the exe path, which Windows automatically accepts as a valid notification sender.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.squirrel.GoChat.GoChat' : app.getPath('exe'));
}
app.setPath('userData', USER_DATA_DIR);
app.setPath('sessionData', SESSION_DATA_DIR);
migrateSessionData(USER_DATA_DIR, SESSION_DATA_DIR);

if (started) app.quit();

function migrateSessionData(userDataDir: string, sessionDataDir: string) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(sessionDataDir, { recursive: true });
  if (fs.existsSync(SESSION_DATA_MIGRATION_MARKER)) return;

  let hadFailure = false;

  for (const entry of SESSION_DATA_MIGRATION_ENTRIES) {
    const sourcePath = path.join(userDataDir, entry);
    if (!fs.existsSync(sourcePath)) continue;

    const destinationPath = path.join(sessionDataDir, entry);

    try {
      fs.cpSync(sourcePath, destinationPath, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    } catch {
      hadFailure = true;
      // Best-effort migration only: Electron will recreate fresh browser data
      // if a file is locked or the destination already contains newer state.
    }
  }

  if (hadFailure) return;

  try {
    fs.writeFileSync(SESSION_DATA_MIGRATION_MARKER, '');
  } catch {
    // Ignore marker failures; the copy above is still best-effort.
  }
}

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

// ── Splash window ─────────────────────────────────────────────────────────────
let splashWindow: BrowserWindow | null = null;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 200,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#1e1f22',
    skipTaskbar: true,
    webPreferences: { contextIsolation: true },
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1e1f22;color:#fff;font-family:system-ui,sans-serif;
display:flex;flex-direction:column;align-items:center;justify-content:center;
height:100vh;gap:14px;-webkit-user-select:none;cursor:default}
h1{font-size:20px;font-weight:700;letter-spacing:5px;text-transform:uppercase;color:rgba(255,255,255,.85)}
.ring{width:22px;height:22px;border:2px solid rgba(255,255,255,.12);
border-top-color:#5865f2;border-radius:50%;animation:s .8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
#pb-wrap{width:200px;height:3px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;display:none}
#pb{height:100%;width:0%;background:#5865f2;border-radius:2px;transition:width .3s ease}
#pb.ind{width:40%;animation:ind 1.4s ease-in-out infinite;transition:none}
@keyframes ind{0%{margin-left:-40%}100%{margin-left:100%}}
p{font-size:11px;color:rgba(255,255,255,.38);letter-spacing:.5px}
</style></head><body>
<h1>GoChat</h1><div class="ring"></div>
<div id="pb-wrap"><div id="pb"></div></div>
<p id="s">Checking for updates\u2026</p>
</body></html>`;

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splashWindow.once('ready-to-show', () => splashWindow?.show());
}

function setSplashStatus(text: string) {
  splashWindow?.webContents
    .executeJavaScript(`document.getElementById('s').textContent=${JSON.stringify(text)}`)
    .catch(() => {});
}

function setSplashProgress(percent: number) {
  splashWindow?.webContents.executeJavaScript(
    `var w=document.getElementById('pb-wrap');var b=document.getElementById('pb');` +
    `if(w)w.style.display='block';if(b){b.classList.remove('ind');b.style.width='${Math.round(percent)}%';}`
  ).catch(() => {});
}

function setSplashIndeterminate() {
  splashWindow?.webContents.executeJavaScript(
    `var w=document.getElementById('pb-wrap');var b=document.getElementById('pb');` +
    `if(w)w.style.display='block';if(b){b.style.width='';b.classList.add('ind');}`
  ).catch(() => {});
}

function closeSplashAndShowMain() {
  splashWindow?.close();
  splashWindow = null;
  mainWindow?.show();
  // Maximize only after show() — calling maximize() on a hidden window on
  // Windows implicitly reveals it, which would race with the splash screen.
  if (loadWindowState().maximized) mainWindow?.maximize();
}

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
    title: 'GoChat',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    backgroundColor: '#1e1f22',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

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

// ── Auto-updater ──────────────────────────────────────────────────────────────
// Runs only in packaged builds on Windows/macOS (Squirrel not available on Linux).
// Startup phase: splash visible → auto-install any downloaded update silently.
// Runtime phase: notify renderer (green title-bar button) for user-triggered install.
let updaterStartupPhase = true;

function setupAutoUpdater() {
  const feedURL = `https://update.electronjs.org/FlameInTheDark/gochat-electron/${process.platform}/${app.getVersion()}`;
  const userAgent = `gochat-electron/${app.getVersion()} (${process.platform}: ${process.arch})`;

  // Safety net: show main window if the updater produces no events at all.
  // 60 s covers slow networks / large initial RELEASES fetch while still
  // preventing an infinite splash if the updater is completely broken.
  // Extended to 10 min once a download starts (see update-available handler).
  let splashTimeout = setTimeout(() => {
    if (updaterStartupPhase) {
      updaterStartupPhase = false;
      closeSplashAndShowMain();
    }
  }, 60_000);

  function finishStartup() {
    clearTimeout(splashTimeout);
    if (updaterStartupPhase) {
      updaterStartupPhase = false;
      closeSplashAndShowMain();
    }
  }

  try {
    autoUpdater.setFeedURL({ url: feedURL, headers: { 'User-Agent': userAgent } });
  } catch {
    finishStartup();
    return;
  }

  let downloadStarted = false;

  autoUpdater.on('update-available', () => {
    downloadStarted = true;
    if (updaterStartupPhase) {
      // Cancel the 60 s safety-net timeout — the download may take much longer.
      // Set a generous new timeout in case the download hangs completely.
      clearTimeout(splashTimeout);
      splashTimeout = setTimeout(() => {
        if (updaterStartupPhase) {
          updaterStartupPhase = false;
          closeSplashAndShowMain();
        }
      }, 10 * 60 * 1000);
      setSplashStatus('Downloading update\u2026');
      // Native autoUpdater (Squirrel) has no download-progress events,
      // so show an indeterminate animated bar instead.
      setSplashIndeterminate();
    }
  });

  // Note: native autoUpdater (Squirrel) does not emit download-progress.
  // This handler is kept for compatibility if electron-updater is ever used.
  autoUpdater.on('download-progress', (info: { percent: number }) => {
    if (updaterStartupPhase) {
      setSplashStatus(`Downloading update\u2026 ${Math.round(info.percent)}%`);
      setSplashProgress(info.percent); // also removes .ind class
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (updaterStartupPhase) {
      finishStartup();
    } else {
      mainWindow?.webContents.send('update:status', 'not-available');
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (updaterStartupPhase) {
      clearTimeout(splashTimeout);
      updaterStartupPhase = false;
      setSplashProgress(100);
      setSplashStatus('Installing update\u2026');
      setTimeout(() => {
        app.isQuitting = true;
        autoUpdater.quitAndInstall(true, true);
      }, 1500);
    } else {
      // Mid-session update ready — show green button in title bar.
      mainWindow?.webContents.send('update:ready');
    }
  });

  autoUpdater.on('error', () => {
    if (updaterStartupPhase) {
      if (downloadStarted) {
        // Error occurred mid-download — briefly tell the user before opening.
        setSplashStatus('Update failed. Starting\u2026');
        clearTimeout(splashTimeout);
        setTimeout(finishStartup, 2000);
      } else {
        finishStartup();
      }
    } else {
      mainWindow?.webContents.send('update:status', 'error');
    }
  });

  try {
    autoUpdater.checkForUpdates();
  } catch {
    finishStartup();
    return;
  }

  // Re-check every hour during the session.
  setInterval(() => {
    if (!updaterStartupPhase) autoUpdater.checkForUpdates();
  }, 60 * 60 * 1000);
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.on('ready', () => {
  createWindow();
  createTray();

  if (app.isPackaged && process.platform !== 'linux') {
    createSplashWindow();
    setupAutoUpdater();
  } else {
    // Dev / Linux: show main window immediately when rendered.
    mainWindow?.once('ready-to-show', () => {
      mainWindow?.show();
      if (loadWindowState().maximized) mainWindow?.maximize();
    });
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

ipcMain.on('update:check', () => {
  if (!app.isPackaged || process.platform === 'linux') return;
  mainWindow?.webContents.send('update:status', 'checking');
  try { autoUpdater.checkForUpdates(); } catch {
    mainWindow?.webContents.send('update:status', 'error');
  }
});

ipcMain.on('app:version-info', (e) => {
  e.returnValue = {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  };
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
