import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ClipWindowApp } from './ClipWindowApp';
import './styles.css';

// One bundle, several roots — selected by the URL hash so there's nothing extra
// to build or ship. `#clip` → the always-on-top clip-recording indicator (src/main/clip-window.ts).
const route = window.location.hash.replace('#', '');

// The clip window is a transparent OS window — the page's default opaque
// background (html/body/#root) has to get out of the way so only the pill shows.
if (route === 'clip') document.documentElement.classList.add('clip-route');

const rootEl = document.getElementById('root');
if (rootEl) {
  const view =
    route === 'clip' ? <ClipWindowApp /> : <App />;
  createRoot(rootEl).render(<React.StrictMode>{view}</React.StrictMode>);
}
