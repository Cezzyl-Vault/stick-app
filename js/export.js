// Export als PDF (A4, Deckblatt, Garnliste, Musterseiten) und PNG; Teilen oder Herunterladen.
import { EMPTY, countStitches } from './pattern.js';
import { threadByCode, skeins, sizeCm } from './threads.js';
import { paletteColors, patternCanvas } from './render.js';

const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const tick = () => new Promise((r) => setTimeout(r, 0));

let jspdfPromise = null;
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  jspdfPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf);
    s.onerror = () => { jspdfPromise = null; reject(new Error('Die PDF-Funktion konnte nicht geladen werden.')); };
    document.head.append(s);
  });
  return jspdfPromise;
}

export function fileName(name, ext) {
  const base = (name || 'Muster').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'Muster';
  return `${base}.${ext}`;
}

/** Teilen (Handy) oder Herunterladen (PC). */
export async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  return 'downloaded';
}

// ---------- PNG ----------

export async function exportPNG(project, mode = 'both') {
  const p = project.pattern;
  const cell = Math.max(4, Math.min(20, Math.floor(4000 / Math.max(p.w, p.h))));
  const R = cell >= 8 ? 30 : 0;
  const c = document.createElement('canvas');
  c.width = p.w * cell + R + 2; c.height = p.h * cell + R + 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  const cols = paletteColors(p);
  const symbols = cell >= 10 && mode !== 'color';
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const v = p.cells[y * p.w + x];
    if (v === EMPTY || (mode === 'symbol' && symbols)) continue;
    ctx.fillStyle = cols[v].css;
    ctx.fillRect(R + x * cell, R + y * cell, cell, cell);
  }
  if (symbols) {
    ctx.font = `600 ${Math.round(cell * 0.66)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const v = p.cells[y * p.w + x];
      if (v === EMPTY) continue;
      ctx.fillStyle = mode === 'symbol' ? '#111' : cols[v].ink;
      ctx.fillText(p.palette[v].symbol, R + (x + 0.5) * cell, R + (y + 0.54) * cell);
    }
  }
  if (cell >= 5) {
    ctx.beginPath();
    for (let x = 0; x <= p.w; x++) if (x % 10) { ctx.moveTo(R + x * cell + 0.5, R); ctx.lineTo(R + x * cell + 0.5, R + p.h * cell); }
    for (let y = 0; y <= p.h; y++) if (y % 10) { ctx.moveTo(R, R + y * cell + 0.5); ctx.lineTo(R + p.w * cell, R + y * cell + 0.5); }
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.beginPath();
  for (let x = 0; x <= p.w; x += 10) { ctx.moveTo(R + x * cell + 0.5, R); ctx.lineTo(R + x * cell + 0.5, R + p.h * cell); }
  for (let y = 0; y <= p.h; y += 10) { ctx.moveTo(R, R + y * cell + 0.5); ctx.lineTo(R + p.w * cell, R + y * cell + 0.5); }
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeRect(R + 0.5, R + 0.5, p.w * cell, p.h * cell);
  if (R) {
    ctx.fillStyle = '#555'; ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let x = 10; x <= p.w; x += 10) ctx.fillText(String(x), R + x * cell, R / 2);
    ctx.textAlign = 'right';
    for (let y = 10; y <= p.h; y += 10) ctx.fillText(String(y), R - 4, R + y * cell);
  }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG fehlgeschlagen'))), 'image/png'));
}

// ---------- PDF ----------

const PW = 210, PH = 297, M = 12;
const CELL = 3, TC = 60, TR = 80;   // 3 mm pro Stich, 60 × 80 Stiche pro Seite
const RH = 7;                        // Zeilenhöhe Garnliste

export async function exportPDF(project, { color = true, onProgress = () => {} } = {}) {
  const { jsPDF } = await loadJsPDF();
  const p = project.pattern;
  const ct = project.settings?.ct || 14;
  const name = project.name || 'Muster';
  const cols = paletteColors(p);
  const counts = countStitches(p);
  const used = p.palette.map((_, i) => i).filter((i) => counts[i] > 0);
  const total = used.reduce((a, i) => a + counts[i], 0);
  const tilesX = Math.ceil(p.w / TC), tilesY = Math.ceil(p.h / TR);
  const tiles = tilesX * tilesY;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: name, creator: 'Stick App' });

  // --- Deckblatt ---
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(30);
  doc.text(name, M, M + 8, { maxWidth: PW - 2 * M });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110);
  doc.text('Kreuzstich-Vorlage · erstellt mit der Stick App', M, M + 14);

  const boxW = PW - 2 * M, boxH = 115;
  const k = Math.min(boxW / p.w, boxH / p.h);
  const iw = p.w * k, ih = p.h * k, ix = M + (boxW - iw) / 2, iy = M + 20;
  doc.addImage(previewDataURL(p), 'PNG', ix, iy, iw, ih);
  doc.setDrawColor(60); doc.setLineWidth(0.3); doc.rect(ix, iy, iw, ih);

  // Garnliste: Seitenzahl vorab berechnen, damit die Kachelübersicht die richtigen Seitennummern zeigt
  const infoY = iy + ih + 9;
  const tableY = infoY + 30;
  const firstCap = Math.max(0, Math.floor((PH - M - tableY - RH) / RH));
  const nextCap = Math.floor((PH - 2 * M - 12) / RH);
  const legendPages = 1 + Math.max(0, Math.ceil((used.length - firstCap) / nextCap));
  const totalPages = legendPages + tiles;

  if (tiles > 1) {
    doc.setDrawColor(156, 47, 74); doc.setLineWidth(0.5);
    doc.setTextColor(156, 47, 74); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    let n = 0;
    for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
      const x = ix + tx * TC * k, y = iy + ty * TR * k;
      const w = Math.min(TC, p.w - tx * TC) * k, h = Math.min(TR, p.h - ty * TR) * k;
      doc.rect(x, y, w, h);
      doc.text(`S. ${legendPages + 1 + n++}`, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
    }
  }

  const cmW = sizeCm(p.w, ct), cmH = sizeCm(p.h, ct);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(30);
  [
    `Größe: ${p.w} × ${p.h} Stiche`,
    `Stoff: Aida ${ct} ct – fertig ca. ${nf1.format(cmW)} × ${nf1.format(cmH)} cm (plus Rand zum Einspannen, z. B. 5 cm je Seite)`,
    `Garne: ${used.length} Farben · ${nf.format(total)} Stiche`,
    'Garnmengen sind geschätzt (2 Fäden, ganze Kreuzstiche). Plane etwas Reserve ein.',
  ].forEach((line, i) => doc.text(line, M, infoY + i * 5.5, { maxWidth: PW - 2 * M }));

  // --- Garnliste ---
  let y = tableY;
  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(90);
    doc.text('Symbol', M, y); doc.text('DMC', M + 18, y); doc.text('Name', M + 38, y);
    doc.text('Stiche', PW - M - 26, y, { align: 'right' }); doc.text('Stränge', PW - M, y, { align: 'right' });
    doc.setDrawColor(180); doc.setLineWidth(0.2); doc.line(M, y + 2, PW - M, y + 2);
    y += RH;
  };
  header();
  for (const i of used) {
    if (y > PH - M - 2) {
      doc.addPage(); y = M + 6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30);
      doc.text('Garnliste (Fortsetzung)', M, y); y += 8;
      header();
    }
    const t = threadByCode(p.palette[i].code);
    const [r, g, b] = t.rgb;
    const bx = M + 2, by = y - 4.6, bs = 6;
    if (color) { doc.setFillColor(r, g, b); doc.setDrawColor(120); doc.setLineWidth(0.15); doc.rect(bx, by, bs, bs, 'FD'); }
    else { doc.setDrawColor(120); doc.setLineWidth(0.15); doc.rect(bx, by, bs, bs); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    setInk(doc, color ? cols[i].ink : '#000000');
    doc.text(p.palette[i].symbol, bx + bs / 2, by + bs / 2, { align: 'center', baseline: 'middle' });
    doc.setTextColor(30); doc.setFont('helvetica', 'normal');
    doc.text(t.code, M + 18, y); doc.text(t.name, M + 38, y, { maxWidth: PW - 2 * M - 38 - 45 });
    doc.text(nf.format(counts[i]), PW - M - 26, y, { align: 'right' });
    doc.text(String(skeins(counts[i], ct)), PW - M, y, { align: 'right' });
    y += RH;
  }

  // --- Musterseiten ---
  let n = 0;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      doc.addPage();
      drawTile(doc, p, cols, tx * TC, ty * TR, Math.min(p.w, (tx + 1) * TC), Math.min(p.h, (ty + 1) * TR), color,
        `${name} – Seite ${legendPages + 1 + n} von ${totalPages}`);
      n++;
      onProgress(n / tiles);
      await tick();
    }
  }
  return doc.output('blob');
}

function setInk(doc, hex) {
  if (hex === '#ffffff') doc.setTextColor(255, 255, 255); else doc.setTextColor(0, 0, 0);
}

function previewDataURL(p) {
  const src = patternCanvas(p);
  const s = Math.max(1, Math.floor(1400 / Math.max(p.w, p.h)));
  const c = document.createElement('canvas');
  c.width = p.w * s; c.height = p.h * s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

function drawTile(doc, p, cols, x0, y0, x1, y1, color, title) {
  const gx = M + 8, gy = M + 16;
  const cw = (x1 - x0) * CELL, chh = (y1 - y0) * CELL;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30);
  doc.text(title, M, M + 4);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100);
  doc.text(`Spalten ${x0 + 1}–${x1} · Zeilen ${y0 + 1}–${y1}`, PW - M, M + 4, { align: 'right' });

  // Farbflächen (zusammenhängende Läufe pro Zeile als ein Rechteck)
  if (color) {
    for (let y = y0; y < y1; y++) {
      let x = x0;
      while (x < x1) {
        const v = p.cells[y * p.w + x];
        let e = x + 1;
        while (e < x1 && p.cells[y * p.w + e] === v) e++;
        if (v !== EMPTY) {
          const { r, g, b } = cols[v];
          doc.setFillColor(r, g, b);
          doc.rect(gx + (x - x0) * CELL, gy + (y - y0) * CELL, (e - x) * CELL, CELL, 'F');
        }
        x = e;
      }
    }
  }

  // Symbole, nach Schriftfarbe gruppiert
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
  for (const ink of color ? ['#000000', '#ffffff'] : ['#000000']) {
    setInk(doc, ink);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = p.cells[y * p.w + x];
      if (v === EMPTY || (color && cols[v].ink !== ink)) continue;
      doc.text(p.palette[v].symbol, gx + (x - x0 + 0.5) * CELL, gy + (y - y0 + 0.5) * CELL, { align: 'center', baseline: 'middle' });
    }
  }

  // Gitter
  doc.setDrawColor(165); doc.setLineWidth(0.08);
  for (let x = x0 + 1; x < x1; x++) if (x % 10) doc.line(gx + (x - x0) * CELL, gy, gx + (x - x0) * CELL, gy + chh);
  for (let y = y0 + 1; y < y1; y++) if (y % 10) doc.line(gx, gy + (y - y0) * CELL, gx + cw, gy + (y - y0) * CELL);
  doc.setDrawColor(0); doc.setLineWidth(0.35);
  for (let x = x0; x <= x1; x++) if (x % 10 === 0 || x === x0 || x === x1) doc.line(gx + (x - x0) * CELL, gy, gx + (x - x0) * CELL, gy + chh);
  for (let y = y0; y <= y1; y++) if (y % 10 === 0 || y === y0 || y === y1) doc.line(gx, gy + (y - y0) * CELL, gx + cw, gy + (y - y0) * CELL);

  // Koordinaten
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(90);
  for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) if (x > 0) doc.text(String(x), gx + (x - x0) * CELL, gy - 1.6, { align: 'center' });
  for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) if (y > 0) doc.text(String(y), gx - 1.4, gy + (y - y0) * CELL, { align: 'right', baseline: 'middle' });

  // Mittelpfeile
  doc.setFillColor(156, 47, 74);
  const mx = p.w / 2, my = p.h / 2;
  if (mx >= x0 && mx <= x1) { const X = gx + (mx - x0) * CELL; doc.triangle(X - 1.4, gy - 7, X + 1.4, gy - 7, X, gy - 4.6, 'F'); }
  if (my >= y0 && my <= y1) { const Y = gy + (my - y0) * CELL; doc.triangle(gx - 8, Y - 1.4, gx - 8, Y + 1.4, gx - 5.6, Y, 'F'); }
}
