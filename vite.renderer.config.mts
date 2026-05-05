import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import svgr from 'vite-plugin-svgr';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({ include: ['buffer'], globals: { Buffer: true } }),
    svgr(),
  ],
  resolve: {
    conditions: ['import', 'browser', 'module', 'default'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      axios: path.resolve(__dirname, './node_modules/axios'),
      '@tanstack/react-query': path.resolve(__dirname, './node_modules/@tanstack/react-query/build/modern/index.js'),
      buffer: path.resolve(__dirname, './node_modules/buffer/index.js'),
    },
  },
  optimizeDeps: {
    exclude: ['@flameinthedark/go-dave'],
    include: ['buffer'],
  },
  build: {
    target: 'esnext',
  },
});
