// The dark around the house as a small image: one value every few dp, stretched (and smoothed)
// by the renderer. One image is far cheaper to draw than dozens of ever-wider strokes, and it
// has no steps, so the fade shows no bands. Pure: shared by the app and the widget.

import type { RGB } from './sky';

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

/** A grid of 0..255 values over `area`, `cell` dp per value. */
export type Field = { area: Box; cell: number; cols: number; rows: number; data: Uint8Array };

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Distance from `p` to a convex polygon (0 inside). */
export function distToConvex(p: Pt, poly: Pt[]) {
  let inside = poly.length >= 3;
  let sign = 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (c !== 0) {
      const s = Math.sign(c);
      if (sign && s !== sign) inside = false;
      sign = sign || s;
    }
    best = Math.min(best, segDist(p, a, b));
  }
  return inside ? 0 : best;
}

/**
 * How dark each cell is (0 clear, 255 dark): `darkAt` of its distance to the convex `shape`.
 * Cells are sampled at their centers; the renderer interpolates between them.
 */
export function darkField(shape: Pt[], area: Box, cell: number, darkAt: (d: number) => number): Field {
  const cols = Math.max(2, Math.ceil(area.w / cell) + 1);
  const rows = Math.max(2, Math.ceil(area.h / cell) + 1);
  const data = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = distToConvex({ x: area.x + i * cell, y: area.y + j * cell }, shape);
      data[j * cols + i] = Math.round(255 * Math.min(1, Math.max(0, darkAt(d))));
    }
  }
  return { area, cell, cols, rows, data };
}

// --- PNG (palette, uncompressed deflate): small enough, and nothing to install. ---

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let k = 0; k < 256; k++) {
    let c = k;
    for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[k] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(v: number) {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

/** zlib stream of stored (uncompressed) deflate blocks. */
function zlibStored(raw: Uint8Array) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  let a = 1;
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    s = (s + a) % 65521;
  }
  out.set(u32(((s << 16) | a) >>> 0), o);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < bytes.length ? B64[c & 63] : '=');
  }
  return out;
}

/** The field's pixels as PNG image data (filter byte 0 before each row), cached: the field doesn't change. */
const idatCache = new WeakMap<Field, Uint8Array>();
function idat(f: Field) {
  let z = idatCache.get(f);
  if (!z) {
    const raw = new Uint8Array(f.rows * (f.cols + 1));
    for (let j = 0; j < f.rows; j++) raw.set(f.data.subarray(j * f.cols, (j + 1) * f.cols), j * (f.cols + 1) + 1);
    z = zlibStored(raw);
    idatCache.set(f, z);
  }
  return z;
}

/**
 * The field as a PNG data URI: each value `v` becomes `color` at opacity v/255 (`as: 'alpha'`),
 * or grey v (`as: 'grey'`, for masks; `invert` flips it).
 */
export function fieldPng(f: Field, opts: { as: 'alpha'; color: RGB } | { as: 'grey'; invert?: boolean }) {
  const plte = new Uint8Array(256 * 3);
  const trns = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const g = opts.as === 'grey' ? (opts.invert ? 255 - v : v) : 0;
    const [r, gg, b] = opts.as === 'alpha' ? opts.color.map((c) => Math.round(Math.min(255, Math.max(0, c)))) : [g, g, g];
    plte.set([r, gg, b], v * 3);
    trns[v] = opts.as === 'alpha' ? v : 255;
  }
  const head = new Uint8Array([...u32(f.cols), ...u32(f.rows), 8, 3, 0, 0, 0]);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('PLTE', plte), ...(opts.as === 'alpha' ? [chunk('tRNS', trns)] : []), chunk('IDAT', idat(f)), chunk('IEND', new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return `data:image/png;base64,${base64(all)}`;
}

/**
 * The field drawn over its area. Sample points sit on the cells' corners, so the image spans one
 * cell more than the grid's steps; half a cell is added on each side so the samples land exactly
 * on their points once the renderer stretches the image.
 */
export function fieldImage(f: Field, href: string) {
  const n = (v: number) => (Math.round(v * 10) / 10).toString();
  const x = f.area.x - f.cell / 2;
  const y = f.area.y - f.cell / 2;
  return `<image x="${n(x)}" y="${n(y)}" width="${n(f.cols * f.cell)}" height="${n(f.rows * f.cell)}" preserveAspectRatio="none" xlink:href="${href}"/>`;
}
