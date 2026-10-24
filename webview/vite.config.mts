import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../dist/webview', import.meta.url)),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/main.tsx', import.meta.url)),
      output: { entryFileNames: 'index.js', assetFileNames: 'index[extname]' },
    },
  },
});
