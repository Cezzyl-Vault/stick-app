// Farbmathematik: sRGB <-> CIELAB (D65) und Farbabstand CIEDE2000.

const lin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const E = 216 / 24389, K = 24389 / 27;
const f = (t) => (t > E ? Math.cbrt(t) : (K * t + 16) / 116);

/** Lineares RGB (0..1, Float) -> Lab. */
export function linearToLab(r, g, b) {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / YN;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** sRGB 0..255 -> Lab. */
export function rgbToLab(r, g, b) {
  return linearToLab(lin[r | 0], lin[g | 0], lin[b | 0]);
}

/** sRGB 0..255 -> linear 0..1 (Lookup). */
export function srgbToLinear(v) {
  return lin[Math.max(0, Math.min(255, v | 0))];
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative Helligkeit 0..1 (für Text-Kontrast). */
export function luminance(r, g, b) {
  return 0.2126 * lin[r] + 0.7152 * lin[g] + 0.0722 * lin[b];
}

const RAD = Math.PI / 180;
const POW25_7 = Math.pow(25, 7);

/** CIEDE2000-Farbabstand zwischen zwei Lab-Farben. */
export function deltaE2000(L1, a1, b1, L2, a2, b2) {
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cm = (C1 + C2) / 2;
  const Cm7 = Math.pow(Cm, 7);
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + POW25_7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  let h1p = C1p === 0 ? 0 : Math.atan2(b1, a1p) / RAD;
  let h2p = C2p === 0 ? 0 : Math.atan2(b2, a2p) / RAD;
  if (h1p < 0) h1p += 360;
  if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  const Lmp = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hmp = hmp < 360 ? hmp + 360 : hmp - 360;
    hmp /= 2;
  }

  const T = 1
    - 0.17 * Math.cos((hmp - 30) * RAD)
    + 0.24 * Math.cos(2 * hmp * RAD)
    + 0.32 * Math.cos((3 * hmp + 6) * RAD)
    - 0.20 * Math.cos((4 * hmp - 63) * RAD);
  const dTheta = 30 * Math.exp(-Math.pow((hmp - 275) / 25, 2));
  const Cmp7 = Math.pow(Cmp, 7);
  const Rc = 2 * Math.sqrt(Cmp7 / (Cmp7 + POW25_7));
  const Lm50 = (Lmp - 50) * (Lmp - 50);
  const Sl = 1 + (0.015 * Lm50) / Math.sqrt(20 + Lm50);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc;

  const l = dLp / Sl, c = dCp / Sc, h = dHp / Sh;
  return Math.sqrt(l * l + c * c + h * h + Rt * c * h);
}

/** Schneller euklidischer Lab-Abstand im Quadrat (CIE76), für k-means. */
export function dist2(L1, a1, b1, L2, a2, b2) {
  const dl = L1 - L2, da = a1 - a2, db = b1 - b2;
  return dl * dl + da * da + db * db;
}
