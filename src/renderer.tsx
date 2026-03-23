import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { setupElectronBridge } from './electron/bridge';

// Start the Electron ↔ Zustand bridge (no-op in browser).
setupElectronBridge();

// Expose debug helpers on window for DevTools console access.
// Usage: window.__gochatDebug.notify('Title', 'Body')
//        window.__gochatDebug.setTrayBadge(5)
;(window as Window & { __gochatDebug?: unknown }).__gochatDebug = {
  notify: (title = 'GoChat', body = 'Test notification') => window.electronAPI?.notify({ title, body }),
  setTrayBadge: (count = 1) => window.electronAPI?.setTrayBadge(count),
}

// Wraps App and removes the static #splash element after the first real paint.
// useEffect runs after React commits to the DOM, which is the earliest safe point.
function Root() {
  useEffect(() => {
    (window as Window & { removeSplash?: () => void }).removeSplash?.();
  }, []);
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
