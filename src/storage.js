// Leitura/gravação dos arquivos de dados (branch "data" do repositório).
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch { return fallback; }
}

function writeJSON(file, obj, pretty = true) {
  const full = path.join(DATA_DIR, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj, null, pretty ? 1 : 0) + '\n');
}

export function loadProducts() {
  const p = readJSON('products.json', []);
  return Array.isArray(p) ? p : (p.products || []);
}

export function loadState() {
  const s = readJSON('state.json', null);
  return s && s.version ? s : { version: 1, products: {}, coupons: {}, storeHealth: {}, lastRun: null };
}

export function saveState(state) {
  writeJSON('state.json', state, false);
}

export function loadHistory(id) {
  return readJSON(`history/${id}.json`, { offers: {} });
}

export function saveHistory(id, h) {
  writeJSON(`history/${id}.json`, h, false);
}

export function removeHistory(id) {
  try { fs.unlinkSync(path.join(DATA_DIR, `history/${id}.json`)); } catch {}
}

/** Registra ponto no histórico se o preço mudou ou se passou 1h desde o último. */
export function appendHistory(h, key, price, ts = Date.now()) {
  if (price == null) return false;
  const arr = (h.offers[key] ||= []);
  const last = arr[arr.length - 1];
  const t = Math.round(ts / 60000); // minutos desde epoch (compacto)
  if (last && last[1] === price && t - last[0] < 60) return false;
  arr.push([t, price]);
  if (arr.length > 3000) arr.splice(0, arr.length - 3000);
  return true;
}
