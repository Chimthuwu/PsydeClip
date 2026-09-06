// Generates Recordr's oscilloscope-wave icon with zero dependencies (pure
// Node): procedural RGBA drawing → PNG encoder (node:zlib + hand-rolled CRC32)
// → ICO container. Run after changing the artwork:
//
//   node scripts/make-icon.js
//
// Writes:
//   build/icon.ico          multi-size icon for the exe / installer / taskbar (electron-builder picks this up)
//   build/icon.png          512px, spare square icon
//   src/main/icon-assets.ts embedded base64 PNGs used at runtime (window + tray)
//
// The drawing is supersampled (scale S) and box-downsampled, so edges and the
// trace get real anti-aliasing without any rasterizer dependency.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TAU = Math.PI * 2;

// ----- waveform (oscilloscope "burst": a chirp with a decaying envelope and a
// small echo) ---------------------------------------------------------------
function waveY(x) {
  // x in 0..1 → y in -1..1
  const env = 0.34 * Math.exp(-6.0 * x) + 0.25 * Math.exp(-1.05 * x);
  const echo = x > 0.40 ? 0.16 * Math.exp(-1.9 * (x - 0.40)) : 0;
  const f = 0.6 + 3.8 * x; // rising frequency
  return (env + echo) * (0.74 * Math.sin(TAU * f * x) + 0.26 * Math.sin(TAU * f * 2.07 * x + 0.6));
}

// ----- PNG encoding ----------------------------------------------------------
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(images) {
  // images: [{ size, data }] — PNG-compressed entries (Vista+)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach((img, i) => {
    const e = entries.slice(i * 16, i * 16 + 16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0; // palette
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, entries, ...images.map((i) => i.data)]);
}

// ----- drawing ---------------------------------------------------------------
function roundedRectCoverage(x, y, half, r) {
  const qx = Math.abs(x) - (half - r);
  const qy = Math.abs(y) - (half - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const outside = Math.sqrt(ox * ox + oy * oy);
  const inside = Math.min(Math.max(qx, qy), 0);
  const dist = outside + inside - r;
  return Math.max(0, Math.min(1, 0.5 - dist));
}

/** Render one final size (supersampled by S, box-downsampled). */
function render(size, S) {
  const W = size * S;
  const steps = W * W;
  const acc = {
    r: new Float32Array(steps),
    g: new Float32Array(steps),
    b: new Float32Array(steps),
    a: new Float32Array(steps),
  };
  const idx = (x, y) => y * W + x;

  // ----- background: rounded square, vertical gradient
  // Kept clearly *navy*, not near-black: the premultiplied-alpha recovery in
  // the downsample rounds small straight values to 0, and with a 10/255
  // background that meant every pixel rounded to pure black (the "completely
  // black" icon). Bigger numbers survive the round-trip.
  const half = W / 2;
  const radius = 0.22 * W;
  const bgTop = [18, 28, 62];
  const bgBottom = [36, 54, 116];
  for (let y = 0; y < W; y++) {
    const ty = y / W;
    const t = Math.min(1, Math.max(0, (ty - 0.04) / 0.92));
    const br = bgTop[0] + (bgBottom[0] - bgTop[0]) * t;
    const bg = bgTop[1] + (bgBottom[1] - bgTop[1]) * t;
    const bb = bgTop[2] + (bgBottom[2] - bgTop[2]) * t;
    for (let x = 0; x < W; x++) {
      const cov = roundedRectCoverage(x - half + 0.5, y - half + 0.5, half, radius);
      if (cov <= 0) continue;
      const i = idx(x, y);
      acc.r[i] = br * cov;
      acc.g[i] = bg * cov;
      acc.b[i] = bb * cov;
      acc.a[i] = 255 * cov;
    }
  }

  // ----- grid (skip below 32 final px — it reads as noise at tray size)
  const gridColor = [64, 160, 255];
  if (size >= 32) {
    const cellsX = 8;
    const cellsY = 6;
    const gx = W / cellsX;
    const gy = W / cellsY;
    const halfG = Math.max(1, S * 0.45);
    const axisAlpha = S > 1 ? 26 : 30;
    for (let y = 0; y < W; y++) {
      const row = y / gy;
      const nearRow = Math.abs(row - Math.round(row));
      const axisRow = Math.abs(row - cellsY / 2);
      for (let x = 0; x < W; x++) {
        // 45°-rotated Chebyshev-style check: nearest vertical line
        const col = x / gx;
        const nearCol = Math.abs(col - Math.round(col));
        if (nearCol > halfG / gx && nearRow > halfG / gy) continue;
        const cov = roundedRectCoverage(x - half + 0.5, y - half + 0.5, half, radius);
        if (cov <= 0) continue;
        const isAxis = axisRow * gy < halfG;
        const a = isAxis ? axisAlpha : 15;
        if (a <= 0) continue;
        const i = idx(x, y);
        acc.r[i] += gridColor[0] * (a / 255) * cov;
        acc.g[i] += gridColor[1] * (a / 255) * cov;
        acc.b[i] += gridColor[2] * (a / 255) * cov;
      }
    }
  }

  // ----- waveform trace: glow passes then a bright core
  const plot = (x0, x1, y0, y1, radiusPx, alpha, rgb) => {
    const xMin = Math.max(0, Math.floor(Math.min(x0, x1) - radiusPx));
    const xMax = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + radiusPx));
    const yMin = Math.max(0, Math.floor(Math.min(y0, y1) - radiusPx));
    const yMax = Math.min(W - 1, Math.ceil(Math.max(y0, y1) + radiusPx));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    for (let py = yMin; py <= yMax; py++) {
      for (let px = xMin; px <= xMax; px++) {
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        const d = Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
        if (d > radiusPx) continue;
        const w = alpha * (1 - d / radiusPx);
        const cov = roundedRectCoverage(px - half + 0.5, py - half + 0.5, half, radius);
        const i = idx(px, py);
        acc.r[i] += rgb[0] * (w / 255) * cov;
        acc.g[i] += rgb[1] * (w / 255) * cov;
        acc.b[i] += rgb[2] * (w / 255) * cov;
        acc.a[i] += w * cov;
      }
    }
  };

  const trace = [0, 232, 255];   // neon cyan
  const core = [214, 250, 255];  // near-white cyan hot core
  const margin = 0.06 * W;
  const span = W - 2 * margin;
  const amp = 0.36 * W;
  const cy = W / 2;
  const samples = [];
  const step = Math.max(0.5, S * 0.4);
  for (let px = margin; px <= W - margin; px += step) {
    const x = (px - margin) / span;
    samples.push([px, cy + waveY(x) * amp]);
  }
  // glow passes (largest radius first), then the bright core
  const passes = [
    { r: 6 * S, a: 14, c: trace },
    { r: 4 * S, a: 36, c: trace },
    { r: 2.6 * S, a: 92, c: trace },
    { r: 1.3 * S, a: 235, c: trace },
    { r: 0.9 * S, a: 255, c: core },
  ];
  for (const p of passes) {
    for (let i = 0; i < samples.length - 1; i++) {
      plot(samples[i][0], samples[i + 1][0], samples[i][1], samples[i + 1][1], p.r, p.a, p.c);
    }
  }

  // ----- box downsample S×S → final pixels
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const i = idx(x * S + sx, y * S + sy);
          r += acc.r[i];
          g += acc.g[i];
          b += acc.b[i];
          a += acc.a[i];
        }
      }
      const n = S * S;
      const avgA = a / n;
      const o = (y * size + x) * 4;
      if (avgA > 0) {
        // Premultiplied → straight: average(premult) / average(alpha) * 255.
        // The earlier /255 after the *255 cancelled out and rounded every dark
        // pixel to 0 — that was the black icon. Check the sanity stats below
        // (average RGB of opaque pixels) if this line ever gets "simplified".
        out[o + 0] = Math.min(255, Math.round(((r / n) / avgA) * 255));
        out[o + 1] = Math.min(255, Math.round(((g / n) / avgA) * 255));
        out[o + 2] = Math.min(255, Math.round(((b / n) / avgA) * 255));
      }
      out[o + 3] = Math.min(255, Math.round(avgA));
    }
  }
  return out;
}

// ----- main ------------------------------------------------------------------
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => {
  const S = size <= 128 ? 4 : 2;
  return { size, data: encodePng(size, size, render(size, S)) };
});
const png512 = encodePng(512, 512, render(512, 2));

const buildDir = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.ico'), encodeIco(pngs));
fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
console.log('wrote build/icon.ico (' + sizes.join(',') + 'px) and build/icon.png (512px)');

// Runtime assets: 16 + 32 (tray, with @2x representation) and 256 (window).
function dataUrl(size) {
  const p = pngs.find((x) => x.size === size);
  return 'data:image/png;base64,' + p.data.toString('base64');
}
const assets = [
  '// Generated by scripts/make-icon.js — do not edit by hand. Re-run the script to regenerate.',
  'export const ICON_16_DATA_URL = ' + JSON.stringify(dataUrl(16)) + ';',
  'export const ICON_32_DATA_URL = ' + JSON.stringify(dataUrl(32)) + ';',
  'export const ICON_256_DATA_URL = ' + JSON.stringify(dataUrl(256)) + ';',
  '',
].join('\n');
fs.writeFileSync(path.resolve(__dirname, '..', 'src', 'main', 'icon-assets.ts'), assets);
console.log('wrote src/main/icon-assets.ts');

// ----- sanity check: decode IHDR, coverage, and the average colour ----------
// The average-RGB line is load-bearing: it catches the premultiplied-alpha
// rounding bug that once rendered the whole icon black (dark background values
// rounded to 0). Opaque 256px pixels should average somewhere bright-navy, and
// there must be pixels that are clearly cyan (blue ~= green >> red).
for (const p of pngs) {
  const w = p.data.readUInt32BE(16);
  const h = p.data.readUInt32BE(20);
  let opaque = 0;
  let sr = 0, sg = 0, sb = 0;
  let cyanPx = 0;
  // Chunk layout: [len(4)][type(4)][data][crc(4)] — data spans type+4 .. crc.
  const idat = p.data.indexOf(Buffer.from([0x49, 0x44, 0x41, 0x54]));
  const iend = p.data.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44]));
  const raw = zlib.inflateSync(p.data.slice(idat + 4, iend - 4));
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1) + 1;
    for (let x = 0; x < w; x++) {
      const a = raw[row + x * 4 + 3];
      if (a <= 64) continue;
      opaque++;
      sr += raw[row + x * 4];
      sg += raw[row + x * 4 + 1];
      sb += raw[row + x * 4 + 2];
      if (sb > 150 && sg > 150 && raw[row + x * 4] < sb - 60) cyanPx++;
    }
  }
  const n = w * h;
  const avg = `rgb(${Math.round(sr / n)},${Math.round(sg / n)},${Math.round(sb / n)})`;
  console.log(
    `  ${p.size}px: ${((opaque / n) * 100).toFixed(0)}% opaque, avg ${avg}, ${cyanPx} cyan px`,
  );
}