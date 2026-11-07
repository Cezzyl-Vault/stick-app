import { rgbToLab, deltaE2000 } from '../js/color.js';
import { THREADS, threadByCode, nearestThread, skeins } from '../js/threads.js';
import { kmeans } from '../js/quantize.js';
import {
  EMPTY, buildPattern, removeConfetti, removeBackground, countStitches,
  replaceColor, mergeColors, removeColor, clearColor, addColor,
} from '../js/pattern.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push([true, name]); }
  catch (e) { results.push([false, name + ' → ' + e.message]); }
}
function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} erwartet ${b}, erhalten ${a}`); }
function near(a, b, tol, msg = '') { if (Math.abs(a - b) > tol) throw new Error(`${msg} erwartet ${b}±${tol}, erhalten ${a}`); }
function ok(c, msg = 'Bedingung falsch') { if (!c) throw new Error(msg); }

// --- Farbmathematik ---
test('Lab: Weiß, Schwarz, Rot', () => {
  const w = rgbToLab(255, 255, 255); near(w[0], 100, 0.01); near(w[1], 0, 0.01); near(w[2], 0, 0.01);
  const k = rgbToLab(0, 0, 0); near(k[0], 0, 0.01);
  const r = rgbToLab(255, 0, 0); near(r[0], 53.24, 0.05); near(r[1], 80.09, 0.1); near(r[2], 67.2, 0.1);
});

// Referenzpaare aus Sharma, Wu, Dalal (2005)
const SHARMA = [
  [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
  [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
  [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
  [50, 0, 0, 50, -1, 2, 2.3669],
  [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
  [50, 2.5, 0, 73, 25, -18, 27.1492],
  [50, 2.5, 0, 50, 3.1736, 0.5854, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
];
test('CIEDE2000 Referenzwerte (Sharma)', () => {
  for (const [l1, a1, b1, l2, a2, b2, exp] of SHARMA) {
    near(deltaE2000(l1, a1, b1, l2, a2, b2), exp, 1e-4, `(${l1},${a1},${b1})`);
    near(deltaE2000(l2, a2, b2, l1, a1, b1), exp, 1e-4, 'symmetrisch');
  }
});

// --- Garne ---
test('DMC-Liste vollständig', () => {
  eq(THREADS.length, 454, 'Anzahl');
  eq(threadByCode('310').hex, '#000000', '310');
  eq(threadByCode('321').hex, '#C72B3B', '321');
  ok(threadByCode('B5200'), 'B5200 fehlt');
});
test('Nächstes Garn zu Schwarz ist 310', () => {
  eq(nearestThread(rgbToLab(0, 0, 0)).code, '310');
});
test('Strangbedarf', () => {
  eq(skeins(0), 0); eq(skeins(1), 1); eq(skeins(1800, 14), 1); eq(skeins(1801, 14), 2); eq(skeins(3000, 28), 1);
});

// --- k-means ---
test('k-means liefert höchstens k Farben', () => {
  const pts = new Float32Array(300 * 3);
  for (let i = 0; i < 300; i++) { const g = i % 3; pts[i * 3] = g * 40; pts[i * 3 + 1] = g * 10; pts[i * 3 + 2] = 0; }
  const c = kmeans(pts, 8);
  ok(c.length / 3 <= 3, 'nur 3 verschiedene Punkte → max. 3 Zentren, erhalten ' + c.length / 3);
  const c2 = kmeans(pts, 2);
  eq(c2.length / 3, 2);
});

// --- Raster ---
function image(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = fn(x, y); const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  return d;
}

test('Muster: Größe, Farbanzahl, Stichsumme', () => {
  const src = image(80, 60, (x, y) => (x < 40 ? [200, 30, 40] : y < 30 ? [20, 60, 180] : [250, 250, 250]));
  const p = buildPattern(src, 80, 60, { w: 40, h: 30, colors: 5, dither: false, confetti: false, removeBg: false });
  eq(p.w, 40); eq(p.h, 30); eq(p.cells.length, 1200);
  ok(p.palette.length <= 5 && p.palette.length >= 3, 'Farben: ' + p.palette.length);
  const total = countStitches(p).reduce((a, b) => a + b, 0);
  eq(total, 1200, 'Stichsumme');
  ok(new Set(p.palette.map((x) => x.symbol)).size === p.palette.length, 'Symbole eindeutig');
});

test('Muster: transparente Pixel werden nicht gestickt', () => {
  const src = image(20, 20, (x) => (x < 10 ? [0, 0, 0, 0] : [10, 10, 10, 255]));
  const p = buildPattern(src, 20, 20, { w: 10, h: 10, colors: 4 });
  const empty = p.cells.filter((c) => c === EMPTY).length;
  eq(empty, 50);
});

test('Hintergrund entfernen', () => {
  // weißer Rand, schwarzes Quadrat in der Mitte
  const w = 10, h = 10, cells = new Uint8Array(100);
  for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) cells[y * w + x] = 1;
  removeBackground(cells, w, h);
  eq(cells.filter((c) => c === EMPTY).length, 84);
  eq(cells.filter((c) => c === 1).length, 16);
});

test('Konfetti-Filter entfernt Einzelstiche', () => {
  const w = 5, h = 5, cells = new Uint8Array(25);
  cells[12] = 3; // einzelner Stich in der Mitte
  removeConfetti(cells, w, h);
  eq(cells[12], 0);
  const c2 = new Uint8Array(25); c2[12] = 3; c2[13] = 3; // zwei zusammen bleiben
  removeConfetti(c2, w, h);
  eq(c2[12], 3); eq(c2[13], 3);
});

// --- Bearbeitung ---
function sample() {
  return { w: 3, h: 1, cells: Uint8Array.from([0, 1, 2]), palette: [{ code: '310', symbol: '+' }, { code: '321', symbol: '×' }, { code: '3713', symbol: 'O' }] };
}
test('Farbe ersetzen', () => {
  const p = sample(); replaceColor(p, 1, '666'); eq(p.palette[1].code, '666'); eq(p.palette[1].symbol, '×');
});
test('Ersetzen durch vorhandenes Garn führt zusammen', () => {
  const p = sample(); replaceColor(p, 1, '310'); eq(p.palette.length, 2); eq([...p.cells].join(), '0,0,1');
});
test('Zusammenführen', () => {
  const p = sample(); mergeColors(p, 0, 2); eq(p.palette.length, 2); eq([...p.cells].join(), '1,0,1'); eq(p.palette[1].code, '3713');
});
test('Entfernen gibt Stiche an ähnlichste Farbe', () => {
  const p = sample(); removeColor(p, 2); // 3713 (Lachs hell) → 321 (Rot) ist näher als 310 (Schwarz)
  eq(p.palette.length, 2); eq([...p.cells].join(), '0,1,1');
});
test('Nicht sticken', () => {
  const p = sample(); clearColor(p, 0); eq([...p.cells].join(), `${EMPTY},0,1`);
});
test('Farbe hinzufügen', () => {
  const p = sample(); eq(addColor(p, '321'), 1); const i = addColor(p, '666'); eq(i, 3); ok(p.palette[3].symbol, 'Symbol fehlt');
});

// --- Ausgabe ---
const failed = results.filter((r) => !r[0]);
document.getElementById('out').innerHTML = results
  .map(([pass, name]) => `<span class="${pass ? 'ok' : 'fail'}">${pass ? '✓' : '✗'} ${name.replace(/</g, '&lt;')}</span>`)
  .join('\n');
document.getElementById('summary').textContent = failed.length
  ? `${failed.length} von ${results.length} Tests fehlgeschlagen`
  : `Alle ${results.length} Tests bestanden`;
document.title = failed.length ? 'FAIL' : 'PASS';
