// Garnliste und Dialog zum Ersetzen / Zusammenführen / Entfernen von Farben.
import { THREADS, threadByCode, threadDistance, skeins } from './threads.js';
import { paletteColors } from './render.js';
import { countStitches } from './pattern.js';

const nf = new Intl.NumberFormat('de-DE');

/** Kleiner DOM-Helfer. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

export function swatch(color, symbol, ink, big = false) {
  return h('span', { class: 'swatch' + (big ? ' big' : ''), style: { background: color, color: ink } }, symbol || '');
}

/** Zeichnet die Garnliste. Gibt die Stichzahlen zurück. */
export function renderPalette(listEl, pattern, { ct, selected, onSelect, onEdit }) {
  const counts = countStitches(pattern);
  const cols = paletteColors(pattern);
  listEl.replaceChildren(...pattern.palette.map((p, i) => {
    const t = threadByCode(p.code);
    const sk = skeins(counts[i], ct);
    return h('li', { class: i === selected ? 'selected' : null },
      h('button', { type: 'button', class: 'pick', onclick: () => onSelect(i), 'aria-label': `DMC ${p.code} auswählen` },
        swatch(cols[i].css, p.symbol, cols[i].ink),
        h('span', { class: 'p-text' },
          h('span', { class: 'p-code' }, 'DMC ' + p.code),
          h('span', { class: 'p-name' }, t ? t.name : '')),
        h('span', { class: 'p-count' }, h('b', {}, nf.format(counts[i])), h('br'),
          counts[i] ? `${sk} ${sk === 1 ? 'Strang' : 'Stränge'}` : 'unbenutzt')),
      h('button', { type: 'button', class: 'icon-btn', onclick: () => onEdit(i), 'aria-label': 'Garn bearbeiten' }, icon('dots')));
  }));
  return counts;
}

/**
 * Öffnet den Garn-Dialog.
 * mode 'edit' (index = Palettenfarbe) oder 'add'.
 * Ergebnis: {action:'replace', code} | {action:'merge', into} | {action:'remove'} | {action:'clear'} | {action:'add', code} | null
 */
export function openColorDialog({ pattern, index = -1, mode = 'edit' }) {
  const dlg = document.getElementById('color-dialog');
  const $ = (id) => document.getElementById(id);
  const list = $('cd-list'), search = $('cd-search'), help = $('cd-help');
  const tabs = $('cd-tabs'), foot = $('cd-foot');
  const counts = countStitches(pattern);
  const cols = paletteColors(pattern);
  const current = index >= 0 ? threadByCode(pattern.palette[index].code) : null;
  const inPalette = new Map(pattern.palette.map((p, i) => [p.code, i]));
  let tab = 'replace';

  const sw = $('cd-swatch');
  if (mode === 'edit') {
    sw.hidden = false;
    sw.style.background = cols[index].css;
    sw.style.color = cols[index].ink;
    sw.textContent = pattern.palette[index].symbol;
    $('cd-title').textContent = `DMC ${current.code}`;
    $('cd-sub').textContent = `${current.name} · ${nf.format(counts[index])} Stiche`;
  } else {
    sw.hidden = true;
    $('cd-title').textContent = 'Garn hinzufügen';
    $('cd-sub').textContent = 'Danach kannst du mit dem Stift damit malen';
  }
  tabs.hidden = mode !== 'edit';
  foot.hidden = mode !== 'edit';
  $('cd-remove').disabled = pattern.palette.length <= 1;
  search.value = '';

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(result);
    };
    const onClose = () => finish(null);
    dlg.addEventListener('close', onClose);

    const render = () => {
      for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tab);
      const q = search.value.trim().toLowerCase();
      search.hidden = tab === 'merge';
      if (tab === 'merge') {
        help.textContent = 'Alle Stiche dieser Farbe bekommen das gewählte Garn.';
        const items = pattern.palette.map((p, i) => ({ p, i, t: threadByCode(p.code) }))
          .filter((x) => x.i !== index)
          .sort((a, b) => threadDistance(current, a.t) - threadDistance(current, b.t));
        list.replaceChildren(...items.map(({ p, i, t }) => h('li', {},
          h('button', { type: 'button', onclick: () => finish({ action: 'merge', into: i }) },
            swatch(cols[i].css, p.symbol, cols[i].ink),
            h('span', { class: 'p-text' }, h('span', { class: 'p-code' }, 'DMC ' + p.code), h('span', { class: 'p-name' }, t.name)),
            h('span', { class: 'badge' }, nf.format(counts[i]) + ' Stiche')))));
        if (!items.length) list.replaceChildren(h('li', { class: 'hint' }, 'Keine weiteren Farben vorhanden.'));
        return;
      }
      help.textContent = mode === 'edit'
        ? 'Tippe auf ein Garn, um diese Farbe zu ersetzen. Die ähnlichsten stehen oben.'
        : 'Tippe auf ein Garn, um es zur Palette hinzuzufügen.';
      let items = THREADS;
      if (q) {
        items = THREADS.filter((t) => t.code.toLowerCase().startsWith(q) || t.name.toLowerCase().includes(q));
      } else if (current) {
        items = THREADS.filter((t) => t !== current)
          .map((t) => ({ t, d: threadDistance(current, t) }))
          .sort((a, b) => a.d - b.d).slice(0, 80).map((x) => x.t);
      }
      list.replaceChildren(...items.map((t) => {
        const pi = inPalette.get(t.code);
        const badge = pi !== undefined ? (mode === 'edit' ? 'in Palette – wird zusammengeführt' : 'schon in Palette') : '';
        return h('li', {},
          h('button', { type: 'button', onclick: () => finish(mode === 'edit' ? { action: 'replace', code: t.code } : { action: 'add', code: t.code }) },
            swatch(t.hex, pi !== undefined ? pattern.palette[pi].symbol : '', cols[pi]?.ink || '#000'),
            h('span', { class: 'p-text' }, h('span', { class: 'p-code' }, 'DMC ' + t.code), h('span', { class: 'p-name' }, t.name)),
            badge ? h('span', { class: 'badge' }, badge) : null));
      }));
      if (!items.length) list.replaceChildren(h('li', { class: 'hint' }, 'Kein Garn gefunden.'));
    };

    tabs.onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) { tab = b.dataset.tab; render(); } };
    search.oninput = render;
    $('cd-remove').onclick = () => finish({ action: 'remove' });
    $('cd-clear').onclick = () => finish({ action: 'clear' });

    render();
    dlg.showModal();
    list.scrollTop = 0;
  });
}
