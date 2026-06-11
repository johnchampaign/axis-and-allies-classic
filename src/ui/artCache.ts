// VASSAL-module art cache (pattern from Star Wars Rebellion's vmodArtCache).
// The deployed site ships ZERO Milton Bradley art; players supply their own
// copy of the Axis & Allies VASSAL module, downloadable from
// https://vassalengine.org/library/projects/Axis__Allies
// (direct file: https://obj.vassalengine.org/images/7/76/Axis%26allies_2.5.vmod).
// We unzip the .vmod client-side with JSZip, store each image from images/ as
// a Blob in IndexedDB keyed by lowercased basename, and serve blob: URLs.
import JSZip from 'jszip';
import { useEffect, useState } from 'react';
import type { Power, UnitType } from '../engine/types';

export const VMOD_PAGE_URL = 'https://vassalengine.org/library/projects/Axis__Allies';
export const VMOD_FILE_URL = 'https://obj.vassalengine.org/images/7/76/Axis%26allies_2.5.vmod';

const DB_NAME = 'aa-vmod-art';
const STORE = 'images';

// (unit, power) -> candidate basenames in the 2.5 module (names are inconsistent;
// all lookups are lowercased, so case differences don't matter)
const POWER_WORDS: Record<Power, string[]> = {
  russia: ['Russian', 'Russia'],
  germany: ['German', 'german'],
  uk: ['UK'],
  japan: ['Japan', 'japan'],
  usa: ['US'],
};
export function unitArtCandidates(type: UnitType, power: Power): string[] {
  const w = POWER_WORDS[power];
  const per = (stem: string) => w.map((p) => `${stem} ${p}.png.gif`);
  switch (type) {
    case 'infantry': return [...per('soldier scan'), ...w.map((p) => `infantry ${p}.png`)];
    case 'armor': return w.map((p) => `tank scan ${p}.png.gif`).concat(['tank scan.png.gif', 'UK Tank.png.gif']);
    case 'fighter': return w.map((p) => `fighter scan ${p}.png.gif`).concat(['UK Fighter.png.gif']);
    case 'bomber': return per('Bomber scan');
    case 'transport': return per('transport scan');
    case 'submarine': return w.map((p) => `sub scan ${p}.png.gif`).concat(['UK Sub.png.gif']);
    case 'carrier': return per('carrier scan');
    case 'battleship': return per('Battleship scan');
    case 'aaGun': return ['AA-gun1.png.gif', 'aa gun.png'];
    case 'factory': return ['Factory.png.gif'];
  }
}
export const MAP_IMAGE = 'map.png';

// --- IndexedDB plumbing ---
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function dbPut(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function dbGetAll(): Promise<Map<string, Blob>> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const out = new Map<string, Blob>();
    const tx = db.transaction(STORE, 'readonly');
    const cur = tx.objectStore(STORE).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return res(out);
      if (c.value instanceof Blob) out.set(String(c.key), c.value);
      c.continue();
    };
    cur.onerror = () => rej(cur.error);
  });
}
export async function clearArt(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  for (const url of blobUrls.values()) URL.revokeObjectURL(url);
  blobUrls.clear();
  loaded = false;
  notify();
}

// --- in-memory blob-url index (keys lowercased) ---
const blobUrls = new Map<string, string>();
let loaded = false;
let warmupStarted = false;
const listeners = new Set<() => void>();
function notify() { for (const l of listeners) l(); }

async function warmup(): Promise<void> {
  if (warmupStarted) return;
  warmupStarted = true;
  try {
    const all = await dbGetAll();
    for (const [k, blob] of all) blobUrls.set(k.toLowerCase(), URL.createObjectURL(blob));
    loaded = blobUrls.size > 0;
    notify();
  } catch {
    // IndexedDB unavailable (private mode etc.) — stay in fallback rendering
  }
}

export function artUrl(candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = blobUrls.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

export interface LoadProgress { phase: 'reading' | 'unzipping' | 'storing'; done?: number; total?: number }

export async function loadVmodFromFile(
  file: File, onProgress?: (p: LoadProgress) => void,
): Promise<{ fileCount: number }> {
  onProgress?.({ phase: 'reading' });
  const buf = await file.arrayBuffer();
  onProgress?.({ phase: 'unzipping' });
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error('That file is not a .vmod/.zip archive.');
  }
  const entries: JSZip.JSZipObject[] = [];
  zip.forEach((_p, e) => {
    if (!e.dir && /\.(png|gif|jpe?g)$/i.test(e.name)) entries.push(e);
  });
  if (entries.length === 0) throw new Error('No images found inside that archive — is it the Axis & Allies .vmod?');
  // ask the browser not to evict our origin's storage under pressure
  // (Chrome may otherwise clear IndexedDB silently after weeks of disuse)
  try { void navigator.storage?.persist?.(); } catch { /* optional */ }
  let done = 0;
  for (const e of entries) {
    const basename = e.name.split('/').pop()!;
    const blob = await e.async('blob');
    await dbPut(basename, blob);
    blobUrls.set(basename.toLowerCase(), URL.createObjectURL(blob));
    done++;
    onProgress?.({ phase: 'storing', done, total: entries.length });
  }
  loaded = true;
  notify();
  return { fileCount: entries.length };
}

export function useArtLoaded(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    void warmup();
    return () => { listeners.delete(l); };
  }, []);
  return loaded;
}
