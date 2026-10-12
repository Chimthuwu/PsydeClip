# Recordr landing page

A one-page React/Vite/Tailwind site for Recordr. It supersedes the hand-written
static page in `../marketing-website/`, which is still in the repo — nothing
links to either of them yet, so neither is live.

## Run it

From the repo root:

```bash
npm run site:dev        # vite dev server
npm run site:build      # -> marketing-site/dist
npm run site:preview    # serve the build on :4173
npm run site:verify     # render the build in a real browser and assert it (13 checks)
npm run site:shoot <dir># screenshots at 1440px and 390px
```

`site:verify` and `site:shoot` drive Electron from the root `node_modules` as a
headless browser, the same way the app's own `verify:*` scripts do, so there is
no extra dependency. Both need `site:preview` running first.

## What the page claims, and where it comes from

Every fact on the page is read off the source, not from memory:

| Claim | Source |
|---|---|
| Twelve themes, their names and order | `src/shared/types.ts` → `THEMES` |
| Five visualizers | `src/shared/types.ts` → `VISUALIZER_MODES` |
| 15-minute default buffer | `DEFAULT_SETTINGS.bufferSeconds` |
| `Alt+R` hotkey | `DEFAULT_SETTINGS.hotkey` |
| MIT licence | `LICENSE`, `package.json` |
| v3.2.0 | the GitHub release |

If any of those change, the page is wrong — it does not import from the app.

## Still open

- **The theme screenshots are stale.** `public/shots/*.png` were captured before
  the MIDI visualizer landed, so each card shows four chips while the page says
  five. Re-shoot with `scripts/theme-shots.mjs` against a running build; they
  are also captured on an idle app, so the boards are nearly empty — shooting
  while audio is playing would sell it far better.
- **Nothing is deployed.** Vercel will build this directory as-is (framework:
  Vite, root: `marketing-site`). Hosting, domain and price are undecided.
- **The download link 404s for anyone without repo access** while the repo is
  private; the page says so rather than pretending otherwise.
- `../marketing-website/` should probably be deleted once this is live.
