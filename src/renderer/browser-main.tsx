/**
 * The browser / Capacitor entry point (todo.md §7, the Android item).
 *
 * It differs from `main.tsx` in exactly one way: it installs the browser
 * implementation of `window.api` before mounting the app, because there is no
 * preload script to do it here. Everything after that is the same `App`, which
 * is the whole point of the port — the renderer talks to `window.api` and
 * nothing else.
 *
 * Built by `npm run build:browser` into `dist/browser/`. Nothing serves it.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { createBrowserApi } from './platform/browser-api';
import './styles.css';

// In Electron the preload owns `window.api`; here nobody has set it.
if (!(window as unknown as { api?: unknown }).api) {
  (window as unknown as { api: unknown }).api = createBrowserApi();
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
