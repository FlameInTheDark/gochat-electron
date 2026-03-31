import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import type { Plugin } from 'vite';

// Copied from gochat-react vite.config.ts, with an Electron-specific vendor fallback.
// @snazzah/davey-wasm32-wasi has "cpu":["wasm32"] so npm on Windows/x64 skips
// installing it. This plugin resolves it from node_modules when present, falls
// back to a vendored copy committed with the Electron app, and only then uses a
// minimal stub so the build still succeeds.
function daveyResolvePlugin(): Plugin {
  const pkgDirs = [
    path.resolve(__dirname, './node_modules/@snazzah/davey-wasm32-wasi'),
    path.resolve(__dirname, './vendor/@snazzah/davey-wasm32-wasi'),
  ]
  const pkgDir = pkgDirs.find((dir) => fs.existsSync(path.join(dir, 'davey.wasi-browser.js')))
  const browserEntry = pkgDir ? path.join(pkgDir, 'davey.wasi-browser.js') : null
  const installed = !!browserEntry

  return {
    name: 'vite-plugin-davey-resolve',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@snazzah/davey-wasm32-wasi') {
        return browserEntry ?? '\0davey-wasm32-wasi-stub'
      }
      // Sub-path imports from within davey.wasi-browser.js (e.g. worker URL)
      if (installed && pkgDir && id.startsWith('@snazzah/davey-wasm32-wasi/')) {
        return path.join(pkgDir, id.slice('@snazzah/davey-wasm32-wasi/'.length))
      }
      return undefined
    },
    load(id) {
      if (id === '\0davey-wasm32-wasi-stub') {
        // Minimal stub — E2EE voice won't function but the build succeeds.
        return `
          export class DAVESession {
            constructor() {}
            setPassthroughMode() {}
            reset() {}
            get status() { return 0 }
            setExternalSender() {}
            getSerializedKeyPackage() { return new Uint8Array(0) }
            processProposals() { return { commit: null, welcome: null } }
            processCommit() {}
            processWelcome() {}
            encrypt(_mt, _codec, frame) { return frame }
            decrypt(_uid, _mt, frame) { return frame }
            canPassthrough() { return true }
          }
          export const Codec = Object.freeze({})
          export const MediaType = Object.freeze({})
          export const ProposalsOperationType = Object.freeze({})
          export const SessionStatus = Object.freeze({ PENDING: 0 })
          export default {}
        `
      }
    },
  }
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    daveyResolvePlugin(),
    react(),
    tailwindcss(),
    // nodePolyfills provides globalThis.Buffer; with contextIsolation:false +
    // nodeIntegration, globalThis.Buffer is already the real Node.js Buffer so
    // the polyfill won't override it — emnapi then works correctly.
    nodePolyfills({ include: ['buffer'], globals: { Buffer: true } }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      buffer: path.resolve(__dirname, './node_modules/buffer/index.js'),
    },
  },
  optimizeDeps: {
    exclude: ['@snazzah/davey', '@snazzah/davey-wasm32-wasi', '@napi-rs/wasm-runtime'],
    include: ['buffer'],
  },
  build: {
    target: 'esnext',
  },
});
