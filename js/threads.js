// DMC-Garne mit vorberechneten Lab-Werten, Suche und Strangbedarf.
import { DMC } from '../data/dmc.js';
import { hexToRgb, rgbToLab, deltaE2000 } from './color.js';

export const THREADS = DMC.map(([code, name, hex], index) => {
  const rgb = hexToRgb(hex);
  return { index, code, name, hex: '#' + hex, rgb, lab: rgbToLab(rgb[0], rgb[1], rgb[2]) };
});

const byCode = new Map(THREADS.map((t) => [t.code, t]));

export function threadByCode(code) {
  return byCode.get(code);
}

/** Nächstes Garn (CIEDE2000) zu einer Lab-Farbe. `candidates` = Liste von Garnen (Standard: alle). */
export function nearestThread(lab, candidates = THREADS) {
  let best = candidates[0], bestD = Infinity;
  for (const t of candidates) {
    const d = deltaE2000(lab[0], lab[1], lab[2], t.lab[0], t.lab[1], t.lab[2]);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** Abstand zwischen zwei Garnen. */
export function threadDistance(a, b) {
  return deltaE2000(a.lab[0], a.lab[1], a.lab[2], b.lab[0], b.lab[1], b.lab[2]);
}

/**
 * Geschätzter Strangbedarf (8 m Strang, 2 Fäden): ca. 1800 Ganzstiche bei 14 ct.
 * Feinerer Stoff = kürzere Stiche = mehr Stiche pro Strang.
 */
export function skeins(stitches, ct = 14) {
  if (stitches <= 0) return 0;
  return Math.max(1, Math.ceil(stitches / (1800 * (ct / 14))));
}

/** Fertige Größe in cm. */
export function sizeCm(stitches, ct) {
  return (stitches / ct) * 2.54;
}
