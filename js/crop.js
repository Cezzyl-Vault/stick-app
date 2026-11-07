// Ausschnitt-Werkzeug: Rechteck mit Eckgriffen über dem Foto.

const MIN = 0.05;

export class CropEditor {
  constructor(root, onChange) {
    this.root = root;
    this.img = root.querySelector('img');
    this.box = root.querySelector('.crop-box');
    this.onChange = onChange;
    this.crop = { x: 0, y: 0, w: 1, h: 1 };
    this.drag = null;
    this.box.addEventListener('pointerdown', (e) => this.start(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', () => this.end());
    window.addEventListener('pointercancel', () => this.end());
    new ResizeObserver(() => this.layout()).observe(this.root);
    this.img.addEventListener('load', () => this.layout());
  }

  setImage(src, crop) {
    this.crop = { ...crop };
    if (this.img.src !== src) this.img.src = src;
    this.layout();
  }

  layout() {
    const { img, box, crop } = this;
    if (!img.clientWidth) return;
    box.style.left = img.offsetLeft + crop.x * img.clientWidth + 'px';
    box.style.top = img.offsetTop + crop.y * img.clientHeight + 'px';
    box.style.width = crop.w * img.clientWidth + 'px';
    box.style.height = crop.h * img.clientHeight + 'px';
  }

  start(e) {
    e.preventDefault();
    const handle = e.target.classList.contains('h') ? [...e.target.classList].find((c) => c !== 'h') : 'move';
    this.drag = { handle, x: e.clientX, y: e.clientY, start: { ...this.crop } };
    this.box.setPointerCapture?.(e.pointerId);
  }

  move(e) {
    if (!this.drag) return;
    const { handle, start } = this.drag;
    const dx = (e.clientX - this.drag.x) / this.img.clientWidth;
    const dy = (e.clientY - this.drag.y) / this.img.clientHeight;
    let { x, y, w, h } = start;
    if (handle === 'move') {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      let x2 = x + w, y2 = y + h;
      if (handle.includes('w')) x = clamp(x + dx, 0, x2 - MIN);
      if (handle.includes('e')) x2 = clamp(x2 + dx, x + MIN, 1);
      if (handle.includes('n')) y = clamp(y + dy, 0, y2 - MIN);
      if (handle.includes('s')) y2 = clamp(y2 + dy, y + MIN, 1);
      w = x2 - x; h = y2 - y;
    }
    this.crop = { x, y, w, h };
    this.layout();
  }

  end() {
    if (!this.drag) return;
    this.drag = null;
    this.onChange({ ...this.crop });
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
