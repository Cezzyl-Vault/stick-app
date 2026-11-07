// Fotos laden, verkleinern, Ausschnitt in Pixel umrechnen.

const MAX_STORE = 2000; // längste Seite des gespeicherten Fotos

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'));
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht gespeichert werden.'))), type, quality));
}

/**
 * Liest eine Bilddatei (Drehung aus EXIF wird vom Browser angewendet),
 * verkleinert sie auf max. 2000 px und gibt { buffer, type } zurück.
 */
export async function readImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const scale = Math.min(1, MAX_STORE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const alpha = /png|webp|gif/.test(file.type) && hasTransparency(ctx, w, h);
    const blob = await canvasToBlob(c, alpha ? 'image/png' : 'image/jpeg', 0.9);
    return { buffer: await blob.arrayBuffer(), type: blob.type };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hasTransparency(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor((w * h) / 40000)) * 4;
  for (let i = 3; i < d.length; i += step) if (d[i] < 250) return true;
  return false;
}

/** Erzeugt ein Bild-Element aus gespeicherten Bytes. */
export async function imageFromBuffer(buffer, type) {
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  try { return await loadImg(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Rastergröße (Stiche) für Ausschnitt und Breite. */
export function gridDims(img, crop, width) {
  const cw = crop.w * img.naturalWidth;
  const ch = crop.h * img.naturalHeight;
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.min(400, Math.round((w * ch) / cw)));
  return { w, h };
}

/**
 * Pixel des Ausschnitts, vorverkleinert auf höchstens 4 Bildpunkte pro Stich.
 * Gibt { data: Uint8ClampedArray, sw, sh } zurück.
 */
export function cropPixels(img, crop, w, h) {
  const sx = crop.x * img.naturalWidth, sy = crop.y * img.naturalHeight;
  const sWidth = crop.w * img.naturalWidth, sHeight = crop.h * img.naturalHeight;
  const sw = Math.max(1, Math.round(Math.min(sWidth, w * 4)));
  const sh = Math.max(1, Math.round(Math.min(sHeight, h * 4)));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sw, sh);
  return { data: ctx.getImageData(0, 0, sw, sh).data, sw, sh };
}
