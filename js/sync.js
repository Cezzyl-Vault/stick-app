// Cloud-Speicher mit Supabase: Anmeldung per E-Mail-Code und Abgleich mit der lokalen Kopie.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { storage } from './storage.js';

export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);

// Eigene Namen mit Präfix, damit die App in einem bestehenden Supabase-Projekt mitlaufen kann
const TABLE = 'stick_projects';
const BUCKET = 'stick-images';

let client = null;
let user = null;
let status = 'idle'; // idle | syncing | error | offline
let lastError = '';
let lastSyncAt = 0;
let running = null, again = false, timer = 0;
const listeners = new Set();
let hooks = { getOpen: () => null, remoteChanged: () => {} };

export const cloudState = () => ({ enabled: cloudEnabled, user, status, lastError, lastSyncAt });
export function onCloudChange(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(cloudState()); }

/** hooks.getOpen(): gerade geöffnetes Projekt (im Speicher), hooks.remoteChanged(ids) */
export async function initCloud(h) {
  hooks = { ...hooks, ...h };
  if (!cloudEnabled) return;
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'stickapp-auth' },
  });
  try {
    const { data } = await client.auth.getSession();
    user = data.session?.user ?? null;
  } catch { user = null; }
  client.auth.onAuthStateChange((_event, session) => {
    const prev = user?.id;
    user = session?.user ?? null;
    emit();
    if (user && user.id !== prev) requestSync(0);
  });
  window.addEventListener('online', () => requestSync(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(800); });
  emit();
  if (user) requestSync(0);
}

// ---------- Anmeldung ----------

const NOT_ALLOWED = 'Diese E-Mail-Adresse ist für die Stick App nicht freigeschaltet.';

/** Anmeldung mit E-Mail und Passwort (Konten legt der Admin im Supabase-Dashboard an). */
export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(german(error));
  // Zusätzlich muss die Person auf der Gästeliste der Stick App stehen
  const { data: allowed, error: rpcError } = await client.rpc('stick_is_allowed');
  if (rpcError || !allowed) {
    await client.auth.signOut();
    throw new Error(rpcError ? german(rpcError) : NOT_ALLOWED);
  }
}

export async function changePassword(password) {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(german(error));
}

export async function signOut() {
  const id = user?.id;
  await client.auth.signOut();
  user = null;
  await storage.clear();
  if (id) await storage.setMeta('lastPull:' + id, null);
  emit();
}

function german(e) {
  const m = e?.message || String(e);
  if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort ist falsch.';
  if (/email not confirmed/i.test(m)) {
    return 'Das Konto ist noch nicht bestätigt. Im Supabase-Dashboard beim Anlegen „Auto Confirm User“ anhaken '
      + '(oder die Person löschen und neu anlegen).';
  }
  if (/could not find the function|stick_is_allowed|relation .*stick_/i.test(m)) {
    return 'Die Datenbank ist noch nicht eingerichtet (supabase/schema.sql ausführen).';
  }
  if (/should be different/i.test(m)) return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (/password should be at least|weak password|password is too weak/i.test(m)) return 'Das Passwort ist zu kurz oder zu einfach.';
  if (/reauthenticat/i.test(m)) return 'Bitte ab- und wieder anmelden, dann das Passwort ändern.';
  if (/rate limit|too many requests/i.test(m)) return 'Zu viele Versuche. Bitte kurz warten und erneut probieren.';
  if (/failed to fetch|network/i.test(m)) return 'Keine Verbindung zum Server.';
  return m;
}

// ---------- Abgleich ----------

export function requestSync(delay = 1500) {
  if (!client || !user) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay);
}

export function syncNow() {
  if (!client || !user) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    status = 'syncing'; emit();
    try {
      await push();
      await pull();
      status = 'idle'; lastError = ''; lastSyncAt = Date.now();
    } catch (e) {
      status = navigator.onLine ? 'error' : 'offline';
      lastError = german(e);
      console.warn('Abgleich fehlgeschlagen:', e);
    } finally {
      running = null;
      emit();
      if (again) { again = false; requestSync(500); }
    }
  })();
  return running;
}

const imagePath = (id) => `${user.id}/${id}`;
const iso = (ms) => new Date(ms).toISOString();
// Postgres liefert Mikrosekunden; manche Browser (Safari) parsen nur Millisekunden zuverlässig.
const parseTs = (s) => Date.parse(String(s).replace(/(\.\d{3})\d+/, '$1'));

/** Lokales Projekt ändern – bevorzugt das gerade geöffnete Objekt im Speicher. */
async function patchLocal(id, fn) {
  const open = hooks.getOpen();
  const p = open && open.id === id ? open : await storage.get(id);
  if (!p) return;
  fn(p);
  await storage.put(p);
}

async function push() {
  const all = await storage.all();
  for (const p of all) {
    if (!p.dirty) continue;
    const stamp = p.updatedAt;
    if (p.deleted) {
      const { error } = await client.from(TABLE).upsert({
        id: p.id, name: p.name || '', data: {}, thumb: null, image_path: null, deleted: true, updated_at: iso(stamp),
      });
      if (error) throw error;
      if (p.imageRemote) await client.storage.from(BUCKET).remove([imagePath(p.id)]).catch(() => {});
      await storage.remove(p.id);
      continue;
    }
    let imageRemote = !!p.imageRemote;
    if (p.image && !imageRemote) {
      const { error } = await client.storage.from(BUCKET)
        .upload(imagePath(p.id), new Blob([p.image], { type: p.imageType }), { upsert: true, contentType: p.imageType });
      if (error) throw error;
      imageRemote = true;
    }
    const { error } = await client.from(TABLE).upsert(toRow(p, imageRemote));
    if (error) throw error;
    await patchLocal(p.id, (cur) => {
      cur.imageRemote = imageRemote;
      if (cur.updatedAt === stamp) cur.dirty = false; // nur wenn inzwischen nichts Neues dazukam
    });
  }
}

async function pull() {
  const key = 'lastPull:' + user.id;
  let since = (await storage.getMeta(key)) || '1970-01-01T00:00:00Z';
  // 10 s Überlappung gegen gleichzeitige Schreibvorgänge; doppelte Verarbeitung ist harmlos
  const from = new Date(parseTs(since) - 10000).toISOString();
  const { data, error } = await client.from(TABLE).select('*')
    .gt('synced_at', from).order('synced_at', { ascending: true }).limit(1000);
  if (error) throw error;
  const changed = [];
  const open = hooks.getOpen();
  for (const row of data) {
    const local = open && open.id === row.id ? open : await storage.get(row.id);
    const remoteTs = parseTs(row.updated_at);
    if (row.deleted) {
      if (local && !local.dirty) { await storage.remove(row.id); changed.push(row.id); }
    } else if (!local || (!local.dirty && remoteTs > local.updatedAt)) {
      await storage.put(fromRow(row, local));
      changed.push(row.id);
    }
    if (parseTs(row.synced_at) > parseTs(since)) since = row.synced_at;
  }
  await storage.setMeta(key, since);
  if (changed.length) hooks.remoteChanged(changed);
}

/** Lädt das Originalfoto eines Projekts aus der Cloud. */
export async function fetchImage(p) {
  if (!client || !user || !p.imageRemote) return null;
  const { data, error } = await client.storage.from(BUCKET).download(imagePath(p.id));
  if (error) throw new Error(german(error));
  return { buffer: await data.arrayBuffer(), type: data.type || p.imageType || 'image/jpeg' };
}

function toRow(p, imageRemote) {
  return {
    id: p.id,
    name: p.name || '',
    deleted: false,
    updated_at: iso(p.updatedAt),
    thumb: p.thumb || null,
    image_path: imageRemote ? imagePath(p.id) : null,
    data: {
      v: 1,
      createdAt: p.createdAt,
      settings: p.settings,
      crop: p.crop,
      edited: !!p.edited,
      imageType: p.imageType,
      pattern: p.pattern ? { w: p.pattern.w, h: p.pattern.h, palette: p.pattern.palette, cells: b64(p.pattern.cells) } : null,
    },
  };
}

function fromRow(row, local) {
  const d = row.data || {};
  return {
    id: row.id,
    name: row.name,
    createdAt: d.createdAt ?? parseTs(row.created_at),
    updatedAt: parseTs(row.updated_at),
    settings: d.settings,
    crop: d.crop || { x: 0, y: 0, w: 1, h: 1 },
    edited: !!d.edited,
    pattern: d.pattern ? { w: d.pattern.w, h: d.pattern.h, palette: d.pattern.palette, cells: unb64(d.pattern.cells) } : null,
    thumb: row.thumb,
    image: local?.image ?? null,
    imageType: d.imageType || local?.imageType || 'image/jpeg',
    imageRemote: !!row.image_path,
    dirty: false,
    deleted: false,
  };
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
