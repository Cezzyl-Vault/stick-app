// Kreuzstich-Raster: Erzeugung aus Bilddaten und Bearbeitungsfunktionen.
// Datenmodell: { w, h, cells: Uint8Array (Palettenindex, EMPTY = nicht sticken), palette: [{ code, symbol }] }
import { areaResample, kmeans } from './quantize.js';
import { THREADS, threadByCode, nearestThread, threadDistance } from './threads.js';
import { deltaE2000 } from './color.js';

export const EMPTY = 255;
export const MAX_COLORS = 60;

// Symbole, die sowohl im Browser als auch in PDF-Standardschriften (WinAnsi) darstellbar sind.
export const SYMBOLS = [
  '+', '×', 'O', '#', '%', '@', '&', 'S', 'Z', 'X', '=', '/', '\\', '$', '?', '<', '>', '^', '~', '*',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'L', 'M', 'N', 'P', 'R', 'T', 'U', 'V', 'W', 'Y',
  '2', '3', '4', '5', '6', '7', '8', '9', '§', '¤', '±', '÷', 'Ø', 'ß', 'Æ', '£', '¥', 'µ', '¶', '°', '!',
];

/**
 * Erzeugt ein Muster aus RGBA-Pixeln.
 * opts: { w, h, colors, dither, confetti, removeBg, seed }
 */
export function buildPattern(data, sw, sh, opts) {
  const { w, h } = opts;
  const n = w * h;
  const { lab, alpha } = areaResample(data, sw, sh, w, h);

  // Durchsichtige Bereiche (PNG) werden nicht gestickt
  const solid = new Uint8Array(n);
  let solidCount = 0;
  for (let i = 0; i < n; i++) if (alpha[i] >= 0.5) { solid[i] = 1; solidCount++; }

  const pts = new Float32Array(solidCount * 3);
  for (let i = 0, j = 0; i < n; i++) {
    if (!solid[i]) continue;
    pts[j++] = lab[i * 3]; pts[j++] = lab[i * 3 + 1]; pts[j++] = lab[i * 3 + 2];
  }

  // 1. Farben reduzieren, 2. auf DMC-Garne abbilden (Duplikate fallen weg)
  const k = Math.max(1, Math.min(MAX_COLORS, opts.colors | 0));
  const centers = kmeans(pts, k, { seed: opts.seed ?? 1 });
  const threads = [];
  for (let c = 0; c < centers.length / 3; c++) {
    const t = nearestThread([centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]]);
    if (!threads.includes(t)) threads.push(t);
  }

  // 3. Jeder Zelle das nächste Palettengarn zuweisen
  const cells = new Uint8Array(n).fill(EMPTY);
  if (threads.length) {
    if (opts.dither) ditherAssign(lab, solid, w, h, threads, cells);
    else plainAssign(lab, solid, n, threads, cells);
  }

  if (opts.removeBg) removeBackground(cells, w, h);
  if (opts.confetti) { removeConfetti(cells, w, h); removeConfetti(cells, w, h); }

  const pattern = { w, h, cells, palette: threads.map((t) => ({ code: t.code, symbol: '' })) };
  compact(pattern);
  sortByCount(pattern);
  assignSymbols(pattern);
  return pattern;
}

function plainAssign(lab, solid, n, threads, cells) {
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    if (!solid[i]) continue;
    const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    // Schlüssel aus auf 0,25 gerundetem Lab (je Kanal < 2048 Stufen)
    const key = ((L * 4) | 0) * 4194304 + (((A + 160) * 4) | 0) * 2048 + (((B + 160) * 4) | 0);
    let best = cache.get(key);
    if (best === undefined) {
      best = nearestIndex(L, A, B, threads);
      cache.set(key, best);
    }
    cells[i] = best;
  }
}

function nearestIndex(L, A, B, threads) {
  let best = 0, bestD = Infinity;
  for (let t = 0; t < threads.length; t++) {
    const tl = threads[t].lab;
    const d = deltaE2000(L, A, B, tl[0], tl[1], tl[2]);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** Floyd–Steinberg im Lab-Raum (Schlangenlinie, gedämpfter Fehler). */
function ditherAssign(lab, solid, w, h, threads, cells) {
  const work = Float32Array.from(lab);
  const damp = 0.75;
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let s = 0; s < w; s++) {
      const x = ltr ? s : w - 1 - s;
      const i = y * w + x;
      if (!solid[i]) continue;
      const L = work[i * 3], A = work[i * 3 + 1], B = work[i * 3 + 2];
      const t = nearestIndex(L, A, B, threads);
      cells[i] = t;
      const tl = threads[t].lab;
      const eL = (L - tl[0]) * damp, eA = (A - tl[1]) * damp, eB = (B - tl[2]) * damp;
      const dir = ltr ? 1 : -1;
      spread(x + dir, y, 7 / 16);
      spread(x - dir, y + 1, 3 / 16);
      spread(x, y + 1, 5 / 16);
      spread(x + dir, y + 1, 1 / 16);
      function spread(nx, ny, f) {
        if (nx < 0 || nx >= w || ny >= h) return;
        const j = ny * w + nx;
        if (!solid[j]) return;
        work[j * 3] += eL * f; work[j * 3 + 1] += eA * f; work[j * 3 + 2] += eB * f;
      }
    }
  }
}

/** Häufigste Randfarbe, die mit dem Rand verbunden ist, wird zu "nicht sticken". */
export function removeBackground(cells, w, h) {
  const counts = new Map();
  const border = [];
  for (let x = 0; x < w; x++) { border.push(x, (h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { border.push(y * w, y * w + w - 1); }
  for (const i of border) {
    const c = cells[i];
    if (c !== EMPTY) counts.set(c, (counts.get(c) || 0) + 1);
  }
  if (!counts.size) return;
  let bg = -1, max = 0;
  for (const [c, v] of counts) if (v > max) { max = v; bg = c; }
  const stack = border.filter((i) => cells[i] === bg);
  while (stack.length) {
    const i = stack.pop();
    if (cells[i] !== bg) continue;
    cells[i] = EMPTY;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
}

/** Einzelne Stiche ohne gleichfarbigen Nachbarn bekommen die häufigste Nachbarfarbe. */
export function removeConfetti(cells, w, h) {
  const src = Uint8Array.from(cells);
  const cnt = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = src[i];
      cnt.clear();
      let same = false, nb = 0;
      for (let dy = -1; dy <= 1 && !same; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= w) continue;
          const v = src[ny * w + nx];
          if (v === c) { same = true; break; }
          cnt.set(v, (cnt.get(v) || 0) + 1);
          nb++;
        }
      }
      if (same || nb === 0) continue;
      let best = c, max = 0;
      for (const [v, k] of cnt) if (k > max) { max = k; best = v; }
      cells[i] = best;
    }
  }
}

/** Anzahl Stiche pro Palettenfarbe. */
export function countStitches(pattern) {
  const counts = new Array(pattern.palette.length).fill(0);
  for (const c of pattern.cells) if (c !== EMPTY) counts[c]++;
  return counts;
}

/** Entfernt ungenutzte Palettenfarben und nummeriert die Zellen neu. */
export function compact(pattern) {
  const counts = countStitches(pattern);
  const map = new Uint8Array(256).fill(EMPTY);
  const palette = [];
  pattern.palette.forEach((p, i) => { if (counts[i] > 0) { map[i] = palette.length; palette.push(p); } });
  for (let i = 0; i < pattern.cells.length; i++) pattern.cells[i] = map[pattern.cells[i]];
  pattern.palette = palette;
}

/** Sortiert die Palette nach Häufigkeit (häufigste zuerst). */
export function sortByCount(pattern) {
  const counts = countStitches(pattern);
  const order = pattern.palette.map((_, i) => i).sort((a, b) => counts[b] - counts[a]);
  const map = new Uint8Array(256).fill(EMPTY);
  order.forEach((old, neu) => { map[old] = neu; });
  for (let i = 0; i < pattern.cells.length; i++) pattern.cells[i] = map[pattern.cells[i]];
  pattern.palette = order.map((i) => pattern.palette[i]);
}

/** Vergibt freie Symbole an Farben ohne Symbol. */
export function assignSymbols(pattern) {
  const used = new Set(pattern.palette.map((p) => p.symbol).filter(Boolean));
  for (const p of pattern.palette) {
    if (p.symbol) continue;
    p.symbol = SYMBOLS.find((s) => !used.has(s)) || '?';
    used.add(p.symbol);
  }
}

// ---------- Bearbeitung ----------

/** Ersetzt Palettenfarbe idx durch ein anderes Garn. Ist das Garn schon in der Palette, wird zusammengeführt. */
export function replaceColor(pattern, idx, code) {
  const existing = pattern.palette.findIndex((p) => p.code === code);
  if (existing === idx) return;
  if (existing >= 0) { mergeColors(pattern, idx, existing); return; }
  pattern.palette[idx] = { ...pattern.palette[idx], code };
}

/** Alle Stiche von `from` bekommen die Farbe `into`; `from` verschwindet aus der Palette. */
export function mergeColors(pattern, from, into) {
  if (from === into) return;
  const cells = pattern.cells;
  for (let i = 0; i < cells.length; i++) if (cells[i] === from) cells[i] = into;
  removeIndex(pattern, from);
}

/** Entfernt eine Farbe; ihre Stiche gehen an die ähnlichste verbleibende Farbe. */
export function removeColor(pattern, idx) {
  if (pattern.palette.length <= 1) return false;
  const me = threadByCode(pattern.palette[idx].code);
  let best = -1, bestD = Infinity;
  pattern.palette.forEach((p, i) => {
    if (i === idx) return;
    const d = threadDistance(me, threadByCode(p.code));
    if (d < bestD) { bestD = d; best = i; }
  });
  mergeColors(pattern, idx, best);
  return true;
}

/** Alle Stiche dieser Farbe werden zu "nicht sticken". */
export function clearColor(pattern, idx) {
  const cells = pattern.cells;
  for (let i = 0; i < cells.length; i++) if (cells[i] === idx) cells[i] = EMPTY;
  removeIndex(pattern, idx);
}

/** Fügt ein Garn zur Palette hinzu (falls nicht vorhanden) und gibt seinen Index zurück. */
export function addColor(pattern, code) {
  const existing = pattern.palette.findIndex((p) => p.code === code);
  if (existing >= 0) return existing;
  if (pattern.palette.length >= MAX_COLORS) return -1;
  pattern.palette.push({ code, symbol: '' });
  assignSymbols(pattern);
  return pattern.palette.length - 1;
}

function removeIndex(pattern, idx) {
  const cells = pattern.cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c !== EMPTY && c > idx) cells[i] = c - 1;
  }
  pattern.palette.splice(idx, 1);
}

export function clonePattern(p) {
  return { w: p.w, h: p.h, cells: Uint8Array.from(p.cells), palette: p.palette.map((x) => ({ ...x })) };
}

export { THREADS };
