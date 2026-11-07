// Herunterrechnen auf das Stichraster und Farbreduktion (k-means++ im Lab-Raum).
import { srgbToLinear, linearToLab, dist2 } from './color.js';

/**
 * Flächenmittelung (Box-Filter) von RGBA-Pixeln auf dw×dh Zellen.
 * Mittelt in linearem Licht, Farbe mit Alpha gewichtet.
 * Ergebnis: { lab: Float32Array(dw*dh*3), alpha: Float32Array(dw*dh) }
 */
export function areaResample(data, sw, sh, dw, dh) {
  const xs = spans(sw, dw);
  const ys = spans(sh, dh);
  // Erst horizontal: sh Zeilen × dw Spalten, Kanäle r,g,b (premultipliziert), a
  const tmp = new Float32Array(sh * dw * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sx, w] of xs[x]) {
        const i = row + sx * 4;
        const al = (data[i + 3] / 255) * w;
        r += srgbToLinear(data[i]) * al;
        g += srgbToLinear(data[i + 1]) * al;
        b += srgbToLinear(data[i + 2]) * al;
        a += al;
      }
      const o = (y * dw + x) * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  // Dann vertikal
  const lab = new Float32Array(dw * dh * 3);
  const alpha = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sy, w] of ys[y]) {
        const i = (sy * dw + x) * 4;
        r += tmp[i] * w; g += tmp[i + 1] * w; b += tmp[i + 2] * w; a += tmp[i + 3] * w;
      }
      const c = y * dw + x;
      alpha[c] = a;
      const L = a > 1e-6 ? linearToLab(r / a, g / a, b / a) : [100, 0, 0];
      lab[c * 3] = L[0]; lab[c * 3 + 1] = L[1]; lab[c * 3 + 2] = L[2];
    }
  }
  return { lab, alpha };
}

/** Für jede Zielzelle: Liste [Quellindex, Gewicht] mit Gewichtssumme 1. */
function spans(src, dst) {
  const scale = src / dst;
  const out = [];
  for (let i = 0; i < dst; i++) {
    const s0 = i * scale, s1 = (i + 1) * scale;
    const list = [];
    for (let s = Math.floor(s0); s < Math.min(src, Math.ceil(s1)); s++) {
      const overlap = Math.min(s1, s + 1) - Math.max(s0, s);
      if (overlap > 1e-9) list.push([s, overlap / scale]);
    }
    out.push(list);
  }
  return out;
}

/** Deterministischer Zufallsgenerator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * k-means++ auf Lab-Punkten.
 * points: Float32Array(n*3). Gibt Float32Array(k'*3) zurück (k' <= k, ohne leere Cluster).
 */
export function kmeans(points, k, { iterations = 16, seed = 1 } = {}) {
  const n = points.length / 3;
  if (n === 0) return new Float32Array(0);
  k = Math.min(k, n);
  const rand = rng(seed);
  const centers = new Float32Array(k * 3);
  const d = new Float32Array(n).fill(Infinity);

  // Initialisierung k-means++
  let idx = Math.floor(rand() * n);
  for (let c = 0; c < k; c++) {
    centers[c * 3] = points[idx * 3];
    centers[c * 3 + 1] = points[idx * 3 + 1];
    centers[c * 3 + 2] = points[idx * 3 + 2];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dd = dist2(points[i * 3], points[i * 3 + 1], points[i * 3 + 2], centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]);
      if (dd < d[i]) d[i] = dd;
      sum += d[i];
    }
    if (sum === 0) { k = c + 1; break; } // weniger verschiedene Farben als k
    let r = rand() * sum;
    idx = n - 1;
    for (let i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { idx = i; break; } }
  }

  // Lloyd-Iterationen
  const assign = new Int32Array(n);
  const sums = new Float64Array(k * 3);
  const counts = new Int32Array(k);
  for (let it = 0; it < iterations; it++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const L = points[i * 3], A = points[i * 3 + 1], B = points[i * 3 + 2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dd = dist2(L, A, B, centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]);
        if (dd < bestD) { bestD = dd; best = c; }
      }
      if (assign[i] !== best || it === 0) { assign[i] = best; changed++; }
    }
    sums.fill(0); counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      sums[c * 3] += points[i * 3]; sums[c * 3 + 1] += points[i * 3 + 1]; sums[c * 3 + 2] += points[i * 3 + 2];
      counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c * 3] = sums[c * 3] / counts[c];
        centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
        centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
      }
    }
    if (it > 0 && changed === 0) break;
  }

  const out = [];
  for (let c = 0; c < k; c++) if (counts[c] > 0) out.push(centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]);
  return Float32Array.from(out);
}
