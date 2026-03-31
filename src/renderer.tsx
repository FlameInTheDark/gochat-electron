import { Buffer } from 'buffer';
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { setupElectronBridge } from './electron/bridge';

// @napi-rs/wasm-runtime (used by @snazzah/davey-wasm32-wasi) passes a SharedArrayBuffer
// to Buffer.from. The npm `buffer` polyfill only handles ArrayBuffer, not SharedArrayBuffer.
// Intercept and copy to a regular ArrayBuffer-backed Uint8Array first.
{
  const _from = Buffer.from.bind(Buffer);
  (Buffer as unknown as { from: typeof Buffer.from }).from = function patchedBufferFrom(
    value: unknown,
    ...args: unknown[]
  ) {
    if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
      // Buffer.from(sab, byteOffset?, length?) — honour the offset/length args,
      // then copy the slice into a regular ArrayBuffer so the polyfill can handle it.
      const view = args.length >= 2
        ? new Uint8Array(value, args[0] as number, args[1] as number)
        : args.length === 1
          ? new Uint8Array(value, args[0] as number)
          : new Uint8Array(value);
      return _from(new Uint8Array(view)); // Copies into a fresh ArrayBuffer.
    }
    return _from(value, ...args);
  } as typeof Buffer.from;
}

// Start the Electron ↔ Zustand bridge (no-op in browser).
setupElectronBridge();

// Expose debug helpers on window for DevTools console access.
// Usage: window.__gochatDebug.notify('Title', 'Body')
//        window.__gochatDebug.setTrayBadge(5)
(window as Window & { __gochatDebug?: unknown }).__gochatDebug = {
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
