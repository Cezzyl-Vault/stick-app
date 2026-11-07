// Darstellung des Musters auf Canvas: Zoom, Verschieben, Stift.
import { EMPTY } from './pattern.js';
import { threadByCode } from './threads.js';
import { luminance } from './color.js';

const RULER = 24;
const FABRIC = '#ffffff';
const MIN_SCALE = 0.5, MAX_SCALE = 64;

export function paletteColors(pattern) {
  return pattern.palette.map((p) => {
    const t = threadByCode(p.code);
    const [r, g, b] = t ? t.rgb : [255, 0, 255];
    return { r, g, b, css: t ? t.hex : '#ff00ff', ink: luminance(r, g, b) > 0.33 ? '#000000' : '#ffffff' };
  });
}

const dim = (v) => Math.round(v * 0.22 + 255 * 0.78);

/** ImageData mit einem Pixel pro Stich. Leere Stiche sind durchsichtig. */
export function patternImageData(pattern, { highlight = -1 } = {}) {
  const { w, h, cells } = pattern;
  const cols = paletteColors(pattern);
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c === EMPTY) continue;
    const o = i * 4;
    const col = cols[c];
    const off = highlight >= 0 && c !== highlight;
    d[o] = off ? dim(col.r) : col.r;
    d[o + 1] = off ? dim(col.g) : col.g;
    d[o + 2] = off ? dim(col.b) : col.b;
    d[o + 3] = 255;
  }
  return img;
}

export function patternCanvas(pattern, opts) {
  const c = document.createElement('canvas');
  c.width = pattern.w; c.height = pattern.h;
  c.getContext('2d').putImageData(patternImageData(pattern, opts), 0, 0);
  return c;
}

/** Kleines Vorschaubild als Data-URL. */
export function thumbnail(pattern, max = 180) {
  const src = patternCanvas(pattern);
  const scale = max / Math.max(pattern.w, pattern.h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(pattern.w * scale));
  c.height = Math.max(1, Math.round(pattern.h * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

export class PatternView {
  /** handlers: { onTap(i), onStrokeStart(), onPaint(i), onStrokeEnd() } */
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.h = handlers;
    this.pattern = null;
    this.scale = 10; this.ox = RULER; this.oy = RULER;
    this.mode = 'both';
    this.tool = 'pan';
    this.highlight = -1;
    this.pointers = new Map();
    this.gesture = null;
    this.tap = null;
    this.cw = 0; this.ch = 0; this.dpr = 1;
    this.needFit = true;
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.readTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { this.readTheme(); this.requestDraw(); });

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = this.pos(e);
      this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  readTheme() {
    const s = getComputedStyle(document.documentElement);
    this.theme = {
      bg: s.getPropertyValue('--canvas-bg').trim() || '#ece4db',
      surface: s.getPropertyValue('--surface').trim() || '#fff',
      muted: s.getPropertyValue('--muted').trim() || '#777',
      primary: s.getPropertyValue('--primary').trim() || '#9c2f4a',
    };
  }

  setPattern(p, fit = true) {
    this.pattern = p;
    this.rebuild();
    if (fit) { this.needFit = true; this.fit(); }
  }

  /** Nach Palettenänderungen: komplette Farbebene neu aufbauen. */
  rebuild() {
    const p = this.pattern;
    if (!p) return;
    this.cols = paletteColors(p);
    this.off.width = p.w; this.off.height = p.h;
    this.offCtx.putImageData(patternImageData(p, { highlight: this.highlight }), 0, 0);
    this.requestDraw();
  }

  /** Nach dem Ändern eines einzelnen Stichs. */
  updateCell(i) {
    const p = this.pattern;
    const c = p.cells[i];
    const x = i % p.w, y = (i / p.w) | 0;
    if (c === EMPTY) this.offCtx.clearRect(x, y, 1, 1);
    else {
      const col = this.cols[c];
      const off = this.highlight >= 0 && c !== this.highlight;
      this.offCtx.fillStyle = off ? `rgb(${dim(col.r)},${dim(col.g)},${dim(col.b)})` : col.css;
      this.offCtx.fillRect(x, y, 1, 1);
    }
    this.requestDraw();
  }

  setMode(m) { this.mode = m; this.requestDraw(); }
  setTool(t) { this.tool = t; }
  setHighlight(i) { this.highlight = i; this.rebuild(); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.cw = r.width; this.ch = r.height;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (this.needFit) this.fit();
    // Größenänderung leert das Canvas – sofort neu zeichnen, damit nichts aufblitzt
    this.draw();
  }

  fit() {
    const p = this.pattern;
    if (!p || !this.cw) return;
    this.needFit = false;
    const bottomSpace = 70; // Platz für die Werkzeugleiste
    const availW = this.cw - RULER - 16;
    const availH = this.ch - RULER - bottomSpace - 8;
    this.scale = clamp(Math.min(availW / p.w, availH / p.h), MIN_SCALE, MAX_SCALE);
    this.ox = RULER + (this.cw - RULER - p.w * this.scale) / 2;
    this.oy = RULER + 8 + Math.max(0, (availH - p.h * this.scale) / 2);
    this.requestDraw();
  }

  zoomAt(x, y, factor) {
    const ns = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    const r = ns / this.scale;
    this.ox = x - (x - this.ox) * r;
    this.oy = y - (y - this.oy) * r;
    this.scale = ns;
    this.requestDraw();
  }

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const { ctx, pattern: p, cw, ch } = this;
    if (!p || !cw) return;
    const s = this.scale, ox = this.ox, oy = this.oy;
    const W = p.w * s, H = p.h * s;
    const T = this.theme;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, cw, ch);

    ctx.fillStyle = FABRIC;
    ctx.fillRect(ox, oy, W, H);
    const showSymbols = s >= 9 && this.mode !== 'color';
    if (this.mode !== 'symbol' || !showSymbols) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.off, ox, oy, W, H);
    }

    const x0 = Math.max(0, Math.floor((RULER - ox) / s));
    const x1 = Math.min(p.w, Math.ceil((cw - ox) / s));
    const y0 = Math.max(0, Math.floor((RULER - oy) / s));
    const y1 = Math.min(p.h, Math.ceil((ch - oy) / s));

    if (showSymbols && x1 > x0 && y1 > y0) {
      ctx.font = `600 ${Math.round(s * 0.66)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hl = this.highlight;
      let last = '';
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const c = p.cells[y * p.w + x];
          if (c === EMPTY) continue;
          const off = hl >= 0 && c !== hl;
          const color = this.mode === 'symbol' ? (off ? '#c9c9c9' : '#111111') : (off ? '#a0a0a0' : this.cols[c].ink);
          if (color !== last) { ctx.fillStyle = color; last = color; }
          ctx.fillText(p.palette[c].symbol, ox + (x + 0.5) * s, oy + (y + 0.54) * s);
        }
      }
    }

    // Gitter
    if (x1 > x0 && y1 > y0) {
      const lx0 = Math.max(ox, RULER), lx1 = Math.min(ox + W, cw);
      const ly0 = Math.max(oy, RULER), ly1 = Math.min(oy + H, ch);
      if (s >= 4) {
        ctx.beginPath();
        for (let x = x0; x <= x1; x++) if (x % 10) { const X = snap(ox + x * s, this.dpr); ctx.moveTo(X, ly0); ctx.lineTo(X, ly1); }
        for (let y = y0; y <= y1; y++) if (y % 10) { const Y = snap(oy + y * s, this.dpr); ctx.moveTo(lx0, Y); ctx.lineTo(lx1, Y); }
        ctx.lineWidth = 1 / this.dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.stroke();
      }
      if (s >= 1.5) {
        ctx.beginPath();
        for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) { const X = snap(ox + x * s, this.dpr); ctx.moveTo(X, ly0); ctx.lineTo(X, ly1); }
        for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) { const Y = snap(oy + y * s, this.dpr); ctx.moveTo(lx0, Y); ctx.lineTo(lx1, Y); }
        ctx.lineWidth = Math.max(1, 1.5 / this.dpr * Math.min(2, this.dpr));
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeRect(ox, oy, W, H);
    }

    // Lineale
    ctx.fillStyle = T.surface;
    ctx.fillRect(0, 0, cw, RULER);
    ctx.fillRect(0, 0, RULER, ch);
    ctx.fillStyle = T.muted;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const step = [10, 20, 50, 100, 200].find((st) => st * s >= 30) || 500;
    for (let x = step; x <= p.w; x += step) {
      const X = ox + x * s;
      if (X > RULER + 8 && X < cw - 8) { ctx.fillText(String(x), X, RULER / 2); }
    }
    ctx.save();
    for (let y = step; y <= p.h; y += step) {
      const Y = oy + y * s;
      if (Y > RULER + 8 && Y < ch - 8) {
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.translate(RULER / 2, Y);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(y), 0, 0);
      }
    }
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Mittelmarkierungen
    ctx.fillStyle = T.primary;
    const mx = ox + (p.w / 2) * s, my = oy + (p.h / 2) * s;
    if (mx > RULER && mx < cw) { ctx.beginPath(); ctx.moveTo(mx - 5, RULER - 8); ctx.lineTo(mx + 5, RULER - 8); ctx.lineTo(mx, RULER - 1); ctx.fill(); }
    if (my > RULER && my < ch) { ctx.beginPath(); ctx.moveTo(RULER - 8, my - 5); ctx.lineTo(RULER - 8, my + 5); ctx.lineTo(RULER - 1, my); ctx.fill(); }
    ctx.fillStyle = T.surface;
    ctx.fillRect(0, 0, RULER, RULER);
  }

  // ---------- Eingabe ----------
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cellAt(x, y) {
    const p = this.pattern;
    if (!p) return null;
    const cx = Math.floor((x - this.ox) / this.scale);
    const cy = Math.floor((y - this.oy) / this.scale);
    if (cx < 0 || cy < 0 || cx >= p.w || cy >= p.h || x < RULER || y < RULER) return null;
    return { cx, cy };
  }

  down(e) {
    if (!this.pattern) return;
    this.canvas.setPointerCapture(e.pointerId);
    const pt = this.pos(e);
    this.pointers.set(e.pointerId, pt);
    if (this.pointers.size === 1) {
      this.tap = { ...pt, t: performance.now(), moved: false };
      if (this.tool === 'pan' || e.button === 1) {
        this.gesture = { type: 'pan', x: pt.x, y: pt.y };
      } else {
        this.gesture = { type: 'paint', last: null };
        this.h.onStrokeStart();
        this.paintAt(pt.x, pt.y);
      }
    } else if (this.pointers.size === 2) {
      if (this.gesture?.type === 'paint') this.h.onStrokeEnd();
      this.tap = null;
      const [a, b] = [...this.pointers.values()];
      this.gesture = { type: 'pinch', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    }
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const pt = this.pos(e);
    this.pointers.set(e.pointerId, pt);
    if (this.tap && Math.hypot(pt.x - this.tap.x, pt.y - this.tap.y) > 6) this.tap.moved = true;
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pan') {
      this.ox += pt.x - g.x; this.oy += pt.y - g.y;
      g.x = pt.x; g.y = pt.y;
      this.requestDraw();
    } else if (g.type === 'paint') {
      this.paintAt(pt.x, pt.y);
    } else if (g.type === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ns = clamp(this.scale * (d / g.d), MIN_SCALE, MAX_SCALE);
      const r = ns / this.scale;
      this.ox = cx - (g.cx - this.ox) * r;
      this.oy = cy - (g.cy - this.oy) * r;
      this.scale = ns;
      g.cx = cx; g.cy = cy; g.d = d;
      this.requestDraw();
    }
  }

  up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    const pt = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g?.type === 'paint' && this.pointers.size === 0) this.h.onStrokeEnd();
    if (!cancelled && this.tap && !this.tap.moved && this.pointers.size === 0 && g?.type === 'pan'
        && performance.now() - this.tap.t < 450) {
      const c = this.cellAt(pt.x, pt.y);
      if (c) this.h.onTap(c.cy * this.pattern.w + c.cx);
    }
    this.tap = null;
    if (this.pointers.size === 0) this.gesture = null;
    else if (this.pointers.size === 1) {
      const rest = [...this.pointers.values()][0];
      this.gesture = { type: 'pan', x: rest.x, y: rest.y };
    }
  }

  paintAt(x, y) {
    const c = this.cellAt(x, y);
    const g = this.gesture;
    if (!c) { g.last = null; return; }
    const from = g.last || c;
    // Linie zwischen den Punkten, damit schnelle Striche keine Lücken haben
    let x0 = from.cx, y0 = from.cy;
    const x1 = c.cx, y1 = c.cy;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.h.onPaint(y0 * this.pattern.w + x0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    g.last = c;
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snap = (v, dpr) => (Math.round(v * dpr) + 0.5) / dpr;
