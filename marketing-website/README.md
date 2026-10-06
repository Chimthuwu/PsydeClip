# Recordr marketing site

A static landing page for Recordr — one HTML file, one stylesheet, no build
step, no dependencies, no tracking. Open `index.html` in a browser to see it.

```
marketing-website/
├── index.html        # the whole page
├── styles.css        # one stylesheet, palette copied from the app's default theme
└── assets/themes/    # committed: main-<theme>.png ×12 + popout-<theme>.png ×12 (scripts/theme-shots.mjs)
```

## What's on the page

* Hero — what Recordr is, the "save the last 15 minutes" hook, download + source
  buttons, and a pre-alpha warning (the repo is still WIP, so the page says so).
* **What it does** — device-level capture, the rolling buffer, save-after-the-fact.
* **For producers** — drag a slice of the past into a DAW as a WAV, per-device
  loopback, optional MIDI transcription, the docked always-on-top strip.
* **Features** — the real feature set, not aspirational copy: four visualizers,
  12 themes, WebM/WAV/MP3, clip recorder, two capture backends, filename
  templates, tray, always-on-top.
* **Themes** — one card per theme, in the same order as `THEMES` in
  `src/shared/types.ts`.
* **Download** — installer size, build-from-source, requirements.
* **Licence & price** — see the open items below.
* Footer.

## Screenshots

All 24 frames are committed: `main-<theme>.png` ×12 for the hero and the gallery,
plus `popout-<theme>.png` ×12 (the pop-out is slated for removal, so the page
doesn't use those). Each card also carries its theme's accent colour as the `--sw`
custom property, so if an image ever goes missing the card falls back to a canvas
of that colour and the `<img>` removes itself (`onerror`).

To re-shoot them, with the app running in dev mode:

```bash
# terminal 1
npm run dev:renderer
# terminal 2
NODE_ENV=development npx electron . --remote-debugging-port=9223
# terminal 3
node scripts/theme-shots.mjs
```

That writes `main-<theme>.png` for all 12 themes into `assets/themes/` and then
tries the pop-out shots (non-fatal if the pop-out doesn't open). It refuses to
shoot unless the page it finds is Recordr. Note that it drives the live app:
it switches the theme 12 times, so don't run it while you're using it.

## Open items before this can go live

1. **Screenshots** — captured and committed (24 PNGs via
   `scripts/theme-shots.mjs`). Still open: a human *pick the frames* pass. Three
   were spot-checked (modern, kawaii, black-ice) and the shots include the live
   recording state, because the app was capturing during the shoot. A re-shoot
   after picking is cheap — the script is deterministic.
2. **Hosting and a domain** — undecided. The cheapest option that fits a static
   page is GitHub Pages, but Pages on a private repo needs a paid plan, so it
   also needs a decision about making the repo public (or hosting the file
   elsewhere).
3. **Price** — not decided, so the price card is a deliberate placeholder in
   `index.html` (there's an `OWNER TODO` comment on it). Nothing is published.
4. **Licence** — the README says MIT, but there is **no `LICENSE` file in the
   repo**, and `package.json` has no `license` field. The page deliberately does
   not state a licence. Add the file (and the field) before advertising terms.
5. **Download links** point at
   `github.com/Chimthuwu/recordr/releases/latest`. There is no tagged release
   yet, and the repo is private, so those links only work for someone with
   access.
6. **Copy** — the features list is written from the code, so it should still be
   checked by whoever owns the product voice. (The main README's own staleness
   was corrected on 2026-10-06 — repo owner, hotkey behaviour, file map, formats,
   fixed Known-issues entries — so the two now agree.)
