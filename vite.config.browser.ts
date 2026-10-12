import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * The browser / Capacitor build target (todo.md §7, the Android item).
 *
 * Same app, same styles, same `window.api` contract — only the entry differs
 * (`browser-main.tsx` installs the browser implementation of that object
 * instead of relying on the Electron preload). Output goes to `dist/browser/`,
 * which nothing serves: this is a build target for the Android shell, not a
 * web release (the browser version was ruled out).
 */
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/browser'),
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/browser.html'),
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
