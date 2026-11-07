// Hintergrund-Thread: berechnet das Muster, ohne die Oberfläche zu blockieren.
import { buildPattern } from './pattern.js';

self.onmessage = (e) => {
  const { id, data, sw, sh, opts } = e.data;
  try {
    const pattern = buildPattern(new Uint8ClampedArray(data), sw, sh, opts);
    self.postMessage({ id, pattern }, [pattern.cells.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
