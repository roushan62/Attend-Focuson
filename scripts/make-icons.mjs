/**
 * ============================================================================
 *  scripts/make-icons.mjs — generates the PWA icons (no npm dependencies).
 *  Draws the SiteTrack mark (a geofence pin with a verified check) pixel by
 *  pixel and encodes a valid PNG with node:zlib.
 *
 *  Run:  node scripts/make-icons.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'frontend', 'assets', 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ PNG */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixelFn) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------------------------------------------- drawing */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

/** Signed-distance rounded box. */
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

/** Distance from a point to a line segment. */
function sdSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy || 1));
  return dist(px, py, x1 + t * vx, y1 + t * vy);
}

function mix(c1, c2, t) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
}

/**
 * SiteTrack mark: amber rounded tile → white geofence pin → amber check.
 * `maskable` keeps the artwork inside the safe zone (80% of the canvas).
 */
function paintIcon(maskable) {
  return function (x, y, S) {
    const scale = maskable ? 0.82 : 1;       // keep maskable art in the safe zone
    const cx = S / 2, cy = S / 2;

    // Normalise so the artwork maths stays constant for every icon size.
    const nx = (x - cx) / scale + cx;
    const ny = (y - cy) / scale + cy;

    // --- background tile -------------------------------------------------
    const tile = sdRoundBox(nx, ny, cx, cy, S / 2, S / 2, maskable ? 0 : S * 0.22);
    if (tile > 0) return [0, 0, 0, 0];
    const aa = clamp(0.5 - tile / 1.5, 0, 1);
    const grad = clamp((ny - 40) / (S - 80));
    const bg = mix([251, 191, 36], [180, 83, 9], grad);

    let out = bg;
    let alpha = aa;

    // subtle top-left highlight
    const glow = clamp(1 - dist(nx, ny, S * 0.28, S * 0.22) / (S * 0.75));
    out = mix(out, [255, 236, 179], glow * 0.35);

    // --- geofence ring (dashed circle) -----------------------------------
    const ringR = S * 0.335;
    const ringD = Math.abs(dist(nx, ny, cx, cy * 0.985) - ringR);
    const ang = Math.atan2(ny - cy * 0.985, nx - cx);
    const dashed = (Math.sin(ang * 12) + 1) / 2;
    if (ringD < S * 0.018 && dashed > 0.28) {
      const t = clamp((S * 0.018 - ringD) / (S * 0.018));
      out = mix(out, [255, 255, 255], t * 0.55);
    }

    // --- pin body (circle + point) ---------------------------------------
    const pcx = cx, pcy = cy * 0.93;
    const pr = S * 0.185;
    const dCircle = dist(nx, ny, pcx, pcy) - pr;
    // triangle tip
    const tipY = pcy + S * 0.245;
    const tipWidth = clamp(1 - (ny - pcy) / (tipY - pcy)) * pr;
    const inTip = ny > pcy && ny < tipY && Math.abs(nx - pcx) < tipWidth;
    const dTip = inTip ? -1 : 999;
    const dPin = Math.min(dCircle, inTip ? -1 : dTip);
    const pinAA = clamp(0.5 - dPin / 1.6);
    if (pinAA > 0) out = mix(out, [255, 255, 255], pinAA);

    // --- check inside the pin --------------------------------------------
    const s = S / 512;
    const d1 = sdSegment(nx, ny, pcx - 62 * s, pcy + 2 * s, pcx - 16 * s, pcy + 46 * s);
    const d2 = sdSegment(nx, ny, pcx - 16 * s, pcy + 46 * s, pcx + 70 * s, pcy - 52 * s);
    const dCheck = Math.min(d1, d2) - 17 * s;
    const checkAA = clamp(0.5 - dCheck / (1.6 * s + 1));
    if (checkAA > 0) out = mix(out, [180, 83, 9], checkAA);

    return [clamp(out[0], 0, 255) | 0, clamp(out[1], 0, 255) | 0, clamp(out[2], 0, 255) | 0, Math.round(alpha * 255)];
  };
}

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false }
];

for (const t of targets) {
  const png = encodePng(t.size, paintIcon(t.maskable));
  fs.writeFileSync(path.join(OUT, t.file), png);
  console.log(`  ✓ ${t.file.padEnd(24)} ${String(t.size).padStart(4)}×${t.size}  ${(png.length / 1024).toFixed(1)} KB`);
}

/* A crisp SVG version for the web UI (scales perfectly in the browser). */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="SiteTrack">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="62" height="62" rx="15" fill="url(#g)"/>
  <circle cx="32" cy="31" r="21.5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.6" stroke-dasharray="6 5"/>
  <path d="M32 12.5c-6.6 0-12 5.4-12 12 0 8.4 12 21 12 21s12-12.6 12-21c0-6.6-5.4-12-12-12z" fill="#fff"/>
  <path d="M25.4 25.6l4.9 5 8.4-9.3" fill="none" stroke="#b45309" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
fs.writeFileSync(path.join(OUT, 'logo.svg'), svg);
fs.writeFileSync(path.resolve(OUT, '..', '..', 'favicon.svg'), svg);
console.log('  ✓ logo.svg + favicon.svg');
console.log('Icons written to', path.relative(process.cwd(), OUT));
