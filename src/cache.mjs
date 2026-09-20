// JSON cache: every ELS response is stored keyed by its query parameters.
// List queries: all form fields (device type, license, building name, city, district, address).
// Detail pages: by 設備統一編碼. A cache hit never needs a captcha.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../cache/', import.meta.url).pathname;
const LIST_DIR = join(ROOT, 'list');
const DETAIL_DIR = join(ROOT, 'detail');
for (const d of [LIST_DIR, DETAIL_DIR]) mkdirSync(d, { recursive: true });

export const LIST_FIELDS = ['type', 'lic', 'name', 'city', 'dist', 'addr'];

/** Canonical list-query params: every field present, empty string when unused. */
export function listParams(p = {}) {
  const out = {};
  for (const f of LIST_FIELDS) out[f] = (p[f] ?? '').toString().trim();
  return out;
}
export function listKey(p) {
  const canon = listParams(p);
  return createHash('sha1').update(JSON.stringify(canon)).digest('hex');
}

export function getList(p) {
  const f = join(LIST_DIR, listKey(p) + '.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}
export function putList(p, rows, extra = {}) {
  const entry = { params: listParams(p), rows, fetchedAt: new Date().toISOString(), ...extra };
  writeFileSync(join(LIST_DIR, listKey(p) + '.json'), JSON.stringify(entry, null, 1));
  return entry;
}
export function getDetail(id) {
  const f = join(DETAIL_DIR, id + '.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}
export function putDetail(id, detail, extra = {}) {
  const entry = { id, detail, fetchedAt: new Date().toISOString(), ...extra };
  writeFileSync(join(DETAIL_DIR, id + '.json'), JSON.stringify(entry, null, 1));
  return entry;
}
export function allLists() {
  return readdirSync(LIST_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(LIST_DIR, f), 'utf8')));
}

const RECENT = join(ROOT, 'recent.json');
export function getRecent() {
  return existsSync(RECENT) ? JSON.parse(readFileSync(RECENT, 'utf8')) : [];
}
/** Add a new address to the chips; existing chips keep their order and floor (stable click targets). */
export function pushRecent(item) {
  const list = getRecent();
  if (list.some((r) => r.address === item.address)) return;
  list.push({ ...item, at: new Date().toISOString() });
  writeFileSync(RECENT, JSON.stringify(list.slice(0, 8), null, 1));
}
export function setRecent(list) {
  writeFileSync(RECENT, JSON.stringify(list, null, 1));
}
