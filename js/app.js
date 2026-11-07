// Stick App – Steuerung der Oberfläche.
import { readImageFile, imageFromBuffer, gridDims, cropPixels } from './image.js';
import { CropEditor } from './crop.js';
import { PatternView, patternImageData, thumbnail } from './render.js';
import {
  EMPTY, clonePattern, replaceColor, mergeColors, removeColor, clearColor, addColor,
} from './pattern.js';
import { threadByCode, sizeCm } from './threads.js';
import { renderPalette, openColorDialog, h, icon } from './palette-editor.js';
import { storage, requestPersistence } from './storage.js';
import { exportPDF, exportPNG, shareOrDownload, fileName } from './export.js';
import {
  cloudEnabled, initCloud, onCloudChange, cloudState, signIn, changePassword, signOut, syncNow, requestSync, fetchImage,
} from './sync.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const DEFAULTS = { width: 80, ct: 14, colors: 12, dither: false, confetti: true, removeBg: false };
const MODES = [['both', 'Beides'], ['color', 'Farbe'], ['symbol', 'Symbole']];
const UNDO_LIMIT = 60;

const state = {
  view: 'home',
  project: null,   // geöffnetes Projekt
  img: null,       // HTMLImageElement des Fotos
  imgUrl: null,
  draft: null,     // Entwurf der Einstellungen { settings, crop }
  preview: null,   // zuletzt berechnete Vorschau (Einstellungen)
  previewKey: '',
  previewJob: 0,
  stage: 'preview',
  undo: [], redo: [],
  tool: 'pan', mode: 'both', selected: 0, highlight: false,
  stroke: null,
};

// ---------- Hilfen ----------

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function busy(text) {
  $('busy-text').textContent = text || 'Bitte warten…';
  $('busy').hidden = !text;
}

function debounce(fn, ms) {
  let t = 0, pending = false;
  const d = (...a) => { pending = true; clearTimeout(t); t = setTimeout(() => { pending = false; fn(...a); }, ms); };
  /** Führt einen ausstehenden Aufruf sofort aus (falls vorhanden). */
  d.flush = () => { if (!pending) return undefined; pending = false; clearTimeout(t); return fn(); };
  return d;
}

// ---------- Rechen-Worker ----------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let jobSeq = 0;
const jobs = new Map();
worker.onmessage = (e) => {
  const { id, pattern, error } = e.data;
  const j = jobs.get(id);
  if (!j) return;
  jobs.delete(id);
  if (error) j.reject(new Error(error)); else j.resolve(pattern);
};
worker.onerror = (e) => { for (const j of jobs.values()) j.reject(new Error(e.message || 'Berechnung fehlgeschlagen')); jobs.clear(); };

function computePattern(img, crop, settings) {
  const { w, h: hh } = gridDims(img, crop, settings.width);
  const px = cropPixels(img, crop, w, hh);
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker.postMessage({
      id, data: px.data.buffer, sw: px.sw, sh: px.sh,
      opts: { w, h: hh, colors: settings.colors, dither: settings.dither, confetti: settings.confetti, removeBg: settings.removeBg },
    }, [px.data.buffer]);
  });
}

// ---------- Navigation (inkl. Zurück-Taste auf Android) ----------

function show(view) {
  state.view = view;
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'view-' + view;
  window.scrollTo(0, 0);
}

function enterInner() {
  if (!history.state?.inner) history.pushState({ inner: true }, '');
}

window.addEventListener('popstate', () => {
  // Offener Dialog: Zurück-Taste schließt nur den Dialog
  const open = document.querySelector('dialog[open]');
  if (open) { open.close(); history.pushState({ inner: true }, ''); return; }
  handleBack();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="back"]')) history.state?.inner ? history.back() : handleBack();
});

function handleBack() {
  if (state.view === 'setup' && state.project?.pattern) {
    openPattern();
    return;
  }
  goHome();
}

async function goHome() {
  await saveSoon.flush();
  state.project = null;
  state.preview = null;
  state.undo = []; state.redo = [];
  if (history.state?.inner) history.replaceState(null, '');
  show('home');
  renderHome();
}

// ---------- Start ----------

async function renderHome() {
  const list = $('project-list');
  const all = (await storage.all()).filter((p) => !p.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
  $('project-empty').hidden = all.length > 0;
  list.replaceChildren(...all.map((p) => {
    const meta = p.pattern ? `${p.pattern.w} × ${p.pattern.h} · ${p.pattern.palette.length} Farben` : 'ohne Muster';
    const card = h('div', { class: 'card' },
      h('button', { type: 'button', class: 'card-open', onclick: () => openProject(p.id), 'aria-label': `${p.name} öffnen` },
        h('div', { class: 'card-thumb' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : null),
        h('div', { class: 'card-body' },
          h('div', { class: 'card-name' }, p.name || 'Muster'),
          h('div', { class: 'card-meta' }, meta),
          h('div', { class: 'card-meta' }, new Date(p.updatedAt).toLocaleDateString('de-DE')))),
      h('button', { type: 'button', class: 'icon-btn card-menu', 'aria-label': `${p.name} löschen`, onclick: () => deleteProject(p) }, icon('trash')));
    return card;
  }));
}

async function deleteProject(p) {
  if (!confirm(`„${p.name}“ wirklich löschen?`)) return;
  const signedIn = cloudEnabled && cloudState().user;
  if (signedIn) {
    // Als gelöscht markieren, damit auch andere Geräte es entfernen
    p.deleted = true; p.dirty = true; p.updatedAt = Date.now();
    await storage.put(p);
    requestSync(200);
  } else {
    await storage.remove(p.id);
  }
  renderHome();
}

$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  busy('Foto wird geladen…');
  try {
    const { buffer, type } = await readImageFile(file);
    const now = Date.now();
    const base = (file.name || '').replace(/\.[^.]+$/, '').replace(/^(IMG|DSC|PXL|image)[-_ ]?/i, '').trim();
    state.project = {
      id: uuid(),
      name: base && !/^\d+[_\d-]*$/.test(base) ? base.slice(0, 60) : `Muster vom ${new Date(now).toLocaleDateString('de-DE')}`,
      createdAt: now, updatedAt: now,
      settings: { ...DEFAULTS }, crop: { x: 0, y: 0, w: 1, h: 1 },
      pattern: null, thumb: null, edited: false,
      image: buffer, imageType: type, imageRemote: false,
      dirty: true, deleted: false,
    };
    await setImage(buffer, type);
    state.undo = []; state.redo = [];
    openSetup();
  } catch (err) {
    toast(err.message || 'Das Foto konnte nicht geladen werden.');
  } finally {
    busy(null);
  }
});

async function setImage(buffer, type) {
  state.preview = null; state.previewKey = ''; // Vorschau gehört zum alten Bild
  if (state.imgUrl) URL.revokeObjectURL(state.imgUrl);
  state.imgUrl = URL.createObjectURL(new Blob([buffer], { type }));
  state.img = await imageFromBuffer(buffer, type);
}

async function openProject(id) {
  const p = await storage.get(id);
  if (!p) { renderHome(); return; }
  state.project = p;
  state.img = null;
  state.undo = []; state.redo = [];
  state.selected = 0;
  if (p.image) await setImage(p.image, p.imageType);
  if (p.pattern) openPattern(); else await openSetup();
}

/** Sorgt dafür, dass das Foto da ist (ggf. aus der Cloud laden). */
async function ensureImage() {
  const p = state.project;
  if (state.img) return true;
  if (!p.image && p.imageRemote) {
    busy('Foto wird aus der Cloud geladen…');
    try {
      const r = await fetchImage(p);
      if (r) { p.image = r.buffer; p.imageType = r.type; await storage.put(p); }
    } catch (e) { toast(e.message); } finally { busy(null); }
  }
  if (p.image) { await setImage(p.image, p.imageType); return true; }
  return false;
}

// ---------- Einstellungen ----------

// Änderungen in den Einstellungen sind ein Entwurf (state.draft) und gelten erst nach "Übernehmen".
const crop = new CropEditor($('crop'), (c) => {
  state.draft.crop = c;
  updateSetupInfo();
  schedulePreview();
});

async function openSetup() {
  if (!(await ensureImage())) {
    toast('Das Originalfoto ist auf diesem Gerät nicht verfügbar.');
    return;
  }
  state.draft = { settings: { ...DEFAULTS, ...state.project.settings }, crop: { ...state.project.crop } };
  const s = state.draft.settings;
  $('set-width').value = s.width;
  $('set-colors').value = s.colors;
  $('set-ct').value = String(s.ct);
  $('set-removeBg').checked = s.removeBg;
  $('set-confetti').checked = s.confetti;
  $('set-dither').checked = s.dither;
  $('setup-apply').textContent = state.project.pattern ? 'Übernehmen' : 'Vorlage erstellen';
  enterInner();
  show('setup');
  setStage('preview');
  crop.setImage(state.imgUrl, state.draft.crop);
  updateSetupInfo();
  runPreview();
}

function readSettings() {
  const s = state.draft.settings;
  s.width = +$('set-width').value;
  s.colors = +$('set-colors').value;
  s.ct = +$('set-ct').value;
  s.removeBg = $('set-removeBg').checked;
  s.confetti = $('set-confetti').checked;
  s.dither = $('set-dither').checked;
}

function updateSetupInfo() {
  const s = state.draft.settings;
  const { w, h: hh } = gridDims(state.img, state.draft.crop, s.width);
  $('width-out').textContent = `${w} Stiche`;
  $('colors-out').textContent = `${s.colors}`;
  $('setup-info').textContent =
    `${w} × ${hh} Stiche · ca. ${nf1.format(sizeCm(w, s.ct))} × ${nf1.format(sizeCm(hh, s.ct))} cm`;
}

for (const id of ['set-width', 'set-colors', 'set-ct', 'set-removeBg', 'set-confetti', 'set-dither']) {
  const el = $(id);
  el.addEventListener('input', () => {
    readSettings();
    updateSetupInfo();
    if (id !== 'set-ct') { setStage('preview'); schedulePreview(); }
  });
}

document.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => setStage(b.dataset.stage)));
function setStage(stage) {
  state.stage = stage;
  document.querySelectorAll('[data-stage]').forEach((b) => b.classList.toggle('active', b.dataset.stage === stage));
  $('crop').hidden = stage !== 'crop';
  $('crop-hint').hidden = stage !== 'crop';
  $('preview-wrap').hidden = stage !== 'preview';
  if (stage === 'crop') requestAnimationFrame(() => crop.layout());
}
$('crop-reset').addEventListener('click', () => {
  state.draft.crop = { x: 0, y: 0, w: 1, h: 1 };
  crop.setImage(state.imgUrl, state.draft.crop);
  updateSetupInfo();
  schedulePreview();
});

function settingsKey() {
  return JSON.stringify([state.draft.settings, state.draft.crop]);
}

const schedulePreview = debounce(() => runPreview(), 220);

async function runPreview() {
  if (!state.img) return null;
  const key = settingsKey();
  if (state.preview && state.previewKey === key) return state.preview;
  const job = ++state.previewJob;
  $('preview-busy').hidden = false;
  try {
    const pattern = await computePattern(state.img, state.draft.crop, state.draft.settings);
    if (job !== state.previewJob) return null;
    state.preview = pattern;
    state.previewKey = key;
    drawPreview(pattern);
    return pattern;
  } catch (e) {
    toast('Berechnung fehlgeschlagen: ' + e.message);
    return null;
  } finally {
    if (job === state.previewJob) $('preview-busy').hidden = true;
  }
}

function drawPreview(p) {
  const c = $('preview-canvas');
  const scale = Math.max(1, Math.floor(600 / Math.max(p.w, p.h)));
  c.width = p.w * scale; c.height = p.h * scale;
  const ctx = c.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = p.w; tmp.height = p.h;
  tmp.getContext('2d').putImageData(patternImageData(p), 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, c.width, c.height);
  $('setup-info').textContent = $('setup-info').textContent.replace(/ · \d+ Farben$/, '') + ` · ${p.palette.length} Farben`;
}

$('setup-apply').addEventListener('click', async () => {
  readSettings();
  const p = state.project;
  if (p.pattern && p.edited && !confirm('Deine Änderungen am Muster (Farben, Stift) werden durch die neue Berechnung ersetzt. Fortfahren?')) return;
  busy('Muster wird berechnet…');
  let pattern;
  try {
    pattern = (state.previewKey === settingsKey() && state.preview) || (await runPreview());
  } finally { busy(null); }
  if (!pattern) return;
  if (p.pattern) pushUndo();
  p.settings = { ...state.draft.settings };
  p.crop = { ...state.draft.crop };
  p.pattern = clonePattern(pattern);
  p.edited = false;
  state.selected = 0;
  await saveNow();
  openPattern(true);
});

// ---------- Vorlage ----------

const view = new PatternView($('pattern-canvas'), {
  onTap(i) {
    const c = state.project.pattern.cells[i];
    if (c === EMPTY) return;
    selectColor(c);
    const t = threadByCode(state.project.pattern.palette[c].code);
    toast(`DMC ${t.code} – ${t.name}`, 1600);
  },
  onStrokeStart() {
    state.stroke = { snapshot: clonePattern(state.project.pattern), changed: false };
  },
  onPaint(i) {
    const p = state.project.pattern;
    const value = state.tool === 'eraser' ? EMPTY : state.selected;
    if (value !== EMPTY && value >= p.palette.length) return;
    if (p.cells[i] === value) return;
    p.cells[i] = value;
    state.stroke.changed = true;
    view.updateCell(i);
  },
  onStrokeEnd() {
    const s = state.stroke;
    state.stroke = null;
    if (!s || !s.changed) return;
    state.undo.push(s.snapshot);
    if (state.undo.length > UNDO_LIMIT) state.undo.shift();
    state.redo = [];
    state.project.edited = true;
    afterEdit(false);
  },
});

function openPattern(fit = true) {
  const p = state.project;
  enterInner();
  show('pattern');
  $('project-name').value = p.name;
  if (state.selected >= p.pattern.palette.length) state.selected = 0;
  view.highlight = state.highlight ? state.selected : -1;
  view.setPattern(p.pattern, fit);
  view.setMode(state.mode);
  setTool(state.tool);
  renderSheet();
  updateUndoButtons();
}

function renderSheet() {
  const p = state.project;
  const counts = renderPalette($('palette-list'), p.pattern, {
    ct: p.settings.ct,
    selected: state.selected,
    onSelect: (i) => selectColor(i),
    onEdit: (i) => editColor(i),
  });
  const total = counts.reduce((a, b) => a + b, 0);
  $('sheet-summary').textContent = `${p.pattern.palette.length} Garne · ${nf.format(total)} Stiche · ${p.pattern.w} × ${p.pattern.h}`;
  const sel = p.pattern.palette[state.selected];
  $('pen-swatch').style.background = sel ? threadByCode(sel.code).hex : 'transparent';
}

function selectColor(i) {
  state.selected = i;
  if (state.highlight) view.setHighlight(i);
  renderSheet();
}

async function editColor(i) {
  const p = state.project;
  const res = await openColorDialog({ pattern: p.pattern, index: i, mode: 'edit' });
  if (!res) return;
  if (res.action === 'remove' && p.pattern.palette.length <= 1) { toast('Die letzte Farbe kann nicht entfernt werden.'); return; }
  pushUndo();
  if (res.action === 'replace') replaceColor(p.pattern, i, res.code);
  else if (res.action === 'merge') mergeColors(p.pattern, i, res.into);
  else if (res.action === 'remove') removeColor(p.pattern, i);
  else if (res.action === 'clear') clearColor(p.pattern, i);
  p.edited = true;
  if (state.selected >= p.pattern.palette.length) state.selected = Math.max(0, p.pattern.palette.length - 1);
  afterEdit(true);
}

$('btn-add-color').addEventListener('click', async () => {
  const p = state.project;
  const res = await openColorDialog({ pattern: p.pattern, mode: 'add' });
  if (!res) return;
  const exists = p.pattern.palette.findIndex((x) => x.code === res.code);
  if (exists >= 0) { selectColor(exists); setTool('pen'); return; }
  pushUndo();
  const idx = addColor(p.pattern, res.code);
  if (idx < 0) { state.undo.pop(); toast('Maximal 60 Farben möglich.'); return; }
  state.selected = idx;
  p.edited = true;
  afterEdit(true);
  setTool('pen');
  toast('Garn hinzugefügt – male jetzt mit dem Stift.');
});

function pushUndo() {
  state.undo.push(clonePattern(state.project.pattern));
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  state.redo = [];
}

function afterEdit(paletteChanged) {
  if (paletteChanged) {
    view.highlight = state.highlight ? state.selected : -1;
    view.rebuild();
  }
  renderSheet();
  updateUndoButtons();
  saveSoon();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(clonePattern(state.project.pattern));
  state.project.pattern = state.undo.pop();
  restoreAfterHistory();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(clonePattern(state.project.pattern));
  state.project.pattern = state.redo.pop();
  restoreAfterHistory();
}
function restoreAfterHistory() {
  const p = state.project.pattern;
  if (state.selected >= p.palette.length) state.selected = 0;
  state.project.edited = true;
  view.highlight = state.highlight ? state.selected : -1;
  view.setPattern(p, false);
  renderSheet();
  updateUndoButtons();
  saveSoon();
}
function updateUndoButtons() {
  $('btn-undo').disabled = !state.undo.length;
  $('btn-redo').disabled = !state.redo.length;
}

$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if (state.view !== 'pattern' || e.target.matches('input, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
});

document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setTool(t) {
  state.tool = t;
  view.setTool(t);
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}

$('btn-mode').addEventListener('click', () => {
  const i = MODES.findIndex(([m]) => m === state.mode);
  const [m, label] = MODES[(i + 1) % MODES.length];
  state.mode = m;
  $('mode-label').textContent = label;
  view.setMode(m);
  if (m !== 'color' && view.scale < 9) toast('Zum Anzeigen der Symbole hineinzoomen');
});
$('btn-highlight').addEventListener('click', () => {
  state.highlight = !state.highlight;
  $('btn-highlight').classList.toggle('active', state.highlight);
  view.setHighlight(state.highlight ? state.selected : -1);
});
$('btn-fit').addEventListener('click', () => view.fit());
$('btn-settings').addEventListener('click', () => openSetup());
$('sheet-toggle').addEventListener('click', () => {
  const sheet = $('sheet');
  sheet.classList.toggle('collapsed');
  $('sheet-toggle').setAttribute('aria-expanded', String(!sheet.classList.contains('collapsed')));
});
$('project-name').addEventListener('input', (e) => {
  state.project.name = e.target.value.trim() || 'Muster';
  saveSoon();
});

// ---------- Speichern ----------

const saveSoon = debounce(() => saveNow(), 700);

async function saveNow() {
  const p = state.project;
  if (!p || !p.pattern) return;
  p.updatedAt = Date.now();
  p.dirty = true;
  p.thumb = thumbnail(p.pattern);
  await storage.put(p);
  requestSync();
}
// Beim Verlassen der Seite ausstehende Änderungen sichern
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSoon.flush(); });

// ---------- Export ----------

$('btn-export').addEventListener('click', () => $('export-dialog').showModal());
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', async () => {
  $('export-dialog').close();
  const p = state.project;
  const kind = b.dataset.export;
  try {
    let blob, name;
    if (kind === 'png') {
      busy('Bild wird erstellt…');
      blob = await exportPNG(p, state.mode);
      name = fileName(p.name, 'png');
    } else {
      busy('PDF wird erstellt…');
      blob = await exportPDF(p, {
        color: kind === 'pdf-color',
        onProgress: (f) => busy(`PDF wird erstellt… ${Math.round(f * 100)} %`),
      });
      name = fileName(p.name, 'pdf');
    }
    busy(null);
    const r = await shareOrDownload(blob, name);
    if (r === 'downloaded') toast(`${name} wurde gespeichert`);
  } catch (e) {
    busy(null);
    toast('Export fehlgeschlagen: ' + e.message, 4000);
  }
}));

// ---------- Konto / Cloud ----------

function renderAccount(s = cloudState()) {
  const btn = $('account-btn');
  btn.hidden = !cloudEnabled;
  if (!cloudEnabled) return;
  const label = !s.user ? 'Anmelden'
    : s.status === 'syncing' ? 'Gleicht ab…'
    : s.status === 'error' ? 'Fehler'
    : s.status === 'offline' ? 'Offline'
    : 'Gesichert';
  $('account-label').textContent = label;
  btn.classList.toggle('on', !!s.user && s.status === 'idle');
  $('acc-signed-out').hidden = !!s.user;
  $('acc-signed-in').hidden = !s.user;
  if (s.user) {
    $('acc-user').textContent = s.user.email || '';
    $('acc-status').textContent = s.status === 'syncing' ? 'Abgleich läuft…'
      : s.status === 'error' ? 'Abgleich fehlgeschlagen: ' + s.lastError
      : s.status === 'offline' ? 'Keine Internetverbindung. Änderungen werden später hochgeladen.'
      : s.lastSyncAt ? `Zuletzt abgeglichen um ${new Date(s.lastSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : '';
  }
}

function accError(msg) {
  $('acc-error').textContent = msg || '';
  $('acc-error').hidden = !msg;
}

$('account-btn').addEventListener('click', () => {
  accError('');
  renderAccount();
  $('account-dialog').showModal();
});
async function doLogin() {
  const email = $('acc-email').value.trim();
  const password = $('acc-password').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) { accError('Bitte eine gültige E-Mail-Adresse eingeben.'); return; }
  if (!password) { accError('Bitte das Passwort eingeben.'); return; }
  accError('');
  $('acc-login').disabled = true;
  try {
    await signIn(email, password);
    $('acc-password').value = '';
    $('account-dialog').close();
    toast('Angemeldet – deine Muster werden abgeglichen.');
  } catch (e) { accError(e.message); }
  finally { $('acc-login').disabled = false; }
}
$('acc-login').addEventListener('click', doLogin);
$('acc-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });

$('acc-change-pw').addEventListener('click', async () => {
  const a = $('acc-new-password').value, b = $('acc-new-password2').value;
  if (a.length < 8) { accError('Das neue Passwort muss mindestens 8 Zeichen haben.'); return; }
  if (a !== b) { accError('Die beiden Passwörter stimmen nicht überein.'); return; }
  accError('');
  $('acc-change-pw').disabled = true;
  try {
    await changePassword(a);
    $('acc-new-password').value = ''; $('acc-new-password2').value = '';
    $('account-dialog').querySelector('.pw-change').open = false;
    toast('Passwort wurde geändert.');
  } catch (e) { accError(e.message); }
  finally { $('acc-change-pw').disabled = false; }
});
$('acc-sync').addEventListener('click', () => syncNow());
$('acc-logout').addEventListener('click', async () => {
  const pending = (await storage.all()).some((p) => p.dirty);
  const msg = pending
    ? 'Einige Änderungen sind noch nicht in der Cloud gespeichert und gehen beim Abmelden verloren. Trotzdem abmelden?'
    : 'Abmelden? Die Muster werden von diesem Gerät entfernt, bleiben aber in der Cloud gespeichert.';
  if (!confirm(msg)) return;
  await signOut();
  $('account-dialog').close();
  if (state.view !== 'home') await goHome(); else renderHome();
});

onCloudChange((s) => {
  renderAccount(s);
  if (state.view === 'home' && s.status === 'idle') renderHome();
});

// ---------- Start ----------

async function start() {
  requestPersistence();
  show('home');
  history.replaceState(null, '');
  await renderHome();
  renderAccount();
  await initCloud({
    getOpen: () => state.project,
    remoteChanged: async (ids) => {
      if (state.view === 'home') renderHome();
      else if (state.project && ids.includes(state.project.id) && state.view === 'pattern') {
        const fresh = await storage.get(state.project.id);
        if (fresh?.pattern) {
          state.project = fresh;
          state.undo = []; state.redo = [];
          openPattern(false);
          toast('Muster wurde auf einem anderen Gerät geändert und aktualisiert.');
        }
      }
    },
  });
  if ('serviceWorker' in navigator && !/[?&]nosw\b/.test(location.search)) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker:', e));
  }
}

start();
