// Seed the JSON cache from the raw HTML fixtures captured on 2026-09-18 and 2026-09-20, storing
// each response under the same key the live path would use. After this every demo address is a
// cache hit from the first run — no captcha, no live request.
import { readFileSync, existsSync } from 'node:fs';
import { parseList, parseDetail } from '../src/parse.mjs';
import { putList, putDetail, setRecent } from '../src/cache.mjs';
import { romanizeAddress } from '../src/address.mjs';

const HOME = process.env.HOME;
const FX = `${HOME}/work/elevator-research/fixtures/`;
const FX2 = `${HOME}/work/elevator-research/fixtures-20260920/`;
const read = (p) => readFileSync(p, 'utf8');
let lists = 0, details = 0;

function seedList(params, file, capturedAt) {
  const { rows } = parseList(read(file));
  putList(params, rows, { source: file.replace(HOME, '~'), capturedAt });
  lists++;
  return rows;
}
function seedDetail(dir, id, capturedAt) {
  const f = `${dir}detail-${id}.html`;
  if (!existsSync(f)) return false;
  const d = parseDetail(read(f));
  putDetail(id, d, { source: f.replace(HOME, '~'), capturedAt });
  details++;
  return true;
}

// 2026-09-18: 松仁路123號 (all device types), 16 rows + 16 details
const meta1 = JSON.parse(read(FX + 'meta.json'));
const songren = seedList({ type: '', lic: '', name: '', city: '63000', dist: '63000020', addr: '松仁路123號' }, FX + 'list-songren123-p200.html', meta1.capturedAt);
for (const r of songren) seedDetail(FX, r.id, meta1.capturedAt);

// 2026-09-20: every P2 query (both numeral forms, both license spellings, both street segments)
const meta2 = JSON.parse(read(FX2 + 'meta.json'));
for (const [key, q] of Object.entries(meta2.queries)) {
  if (key === 'details') continue;
  const rows = seedList({ type: '', lic: q.lic, name: '', city: q.addr ? '63000' : '', dist: q.dist, addr: q.addr }, `${FX2}list-${key}-p200.html`, meta2.capturedAt);
  if (rows.length !== q.n) console.warn(`WARN ${key}: parsed ${rows.length} rows, meta says ${q.n}`);
  for (const r of rows) seedDetail(FX2, r.id, meta2.capturedAt);
}

setRecent([
  { address: '臺北市信義區松仁路123號', floor: 12 },
  { address: '臺北市大安區忠孝東路三段54號', floor: 4 },
  { address: '臺北市北投區振華街', floor: 3 },
  { address: '臺北市大同區承德路二段217號', floor: 7 },
].map((r) => ({ ...r, english: romanizeAddress(r.address) })));

console.log(`seeded ${lists} list queries and ${details} detail pages`);
