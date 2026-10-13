// One-shot asar content check (2026-10-13: history gradient, note outline,
// export chip — ship verification). File names resolved from dist/.
import { readdirSync } from 'node:fs';
import asar from '@electron/asar';

const archive = 'release/win-unpacked/resources/app.asar';
const jsName = readdirSync('dist/renderer/assets').filter((n) => /^index-[A-Za-z0-9]+\.js$/.test(n))[0];
const cssName = readdirSync('dist/renderer/assets').filter((n) => /^index-[A-Za-z0-9]+\.css$/.test(n))[0];

const js = asar.extractFile(archive, `dist\\renderer\\assets\\${jsName}`).toString('utf8');
const css = asar.extractFile(archive, `dist\\renderer\\assets\\${cssName}`).toString('utf8');

console.log('history gradient stops (#7fe7dc / #ff8df0):', js.includes('#7fe7dc') && js.includes('#ff8df0') ? 'PRESENT' : 'MISSING');
console.log('old black note stroke gone:', !js.includes('rgba(0,0,0,0.55)') ? 'GONE' : 'STILL THERE (BAD)');
console.log('export chip kawaii rule:', css.includes('theme-kawaii .viz-pane-export') ? 'PRESENT' : 'MISSING');
console.log('export anchor top (not bottom):', /\.viz-pane-export\s*\{[^}]*top:\s*6px/.test(css) && !/\.viz-pane-export\s*\{[^}]*bottom/.test(css) ? 'OK' : 'WRONG');
