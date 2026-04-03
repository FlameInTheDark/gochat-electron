import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
