// One-shot asar content check (2026-10-13 NEON live-notes ship verification).
import { readdirSync } from 'node:fs';
import asar from '@electron/asar';

const name = readdirSync('dist/renderer/assets').filter((n) => /^index-[A-Za-z0-9]+\.js$/.test(n))[0];
const archive = 'release/win-unpacked/resources/app.asar';
const entry = `dist\\renderer\\assets\\${name}`;
const js = asar.extractFile(archive, entry).toString('utf8');

console.log('old ghosted alpha (0.3 + 0.4 * velocity):', js.includes('.3+.4*') || js.includes('0.3 + 0.4') ? 'STILL PRESENT (BAD)' : 'GONE (GOOD)');
console.log('new neon alpha (0.55 + 0.35 * velocity):', js.includes('.55+.35*') || js.includes('0.55 + 0.35') ? 'PRESENT (GOOD)' : 'MISSING (BAD)');
console.log('lightened live mix (0.15 vs old 0.45):', js.includes('.15)') || js.includes('.15,') ? 'PRESENT (as a numeric literal — arithmetic is minified)' : 'CHECK MANUALLY');
