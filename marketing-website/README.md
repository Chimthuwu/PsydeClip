# Recordr marketing site

A static landing page for Recordr — one HTML file, one stylesheet, no build
step, no dependencies, no tracking. Open `index.html` in a browser to see it.

```
marketing-website/
├── index.html        # the whole page
├── styles.css        # one stylesheet, palette copied from the app's default theme
└── assets/themes/    # main-<theme>.png — written by scripts/theme-shots.mjs (not committed yet)
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

`assets/themes/main-<theme>.png` does not exist yet. Until it does, each theme
card falls back to a canvas of that theme's own accent colour (the `--sw` custom
property on each card, taken from the app's theme list), so the page never shows
a broken image. The `<img>` tags remove themselves when the file is missing
(`onerror`), and the hero has a labelled placeholder.

To fill them in, with the app running in dev mode:

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

1. **Screenshots** — the capture above has not been run (it needs a live build
   and someone to look at the frames). Nothing in `assets/` is committed.
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
6. **Copy** — the features list is written from the code and the README, so it
   should be checked by whoever owns the product voice. The README itself is
   stale in places (it still says two themes / three visualizers, and the old
   `Shift+Alt+R` hotkey); the site uses the current values from
   `src/shared/types.ts` instead.
