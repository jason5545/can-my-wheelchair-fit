// Can My Wheelchair Fit? — single-file HTTP server. Serves the UI and the JSON API.
//   GET  /api/check?address=&floor=&chair=&live=0|1  → verdict + evidence
//   GET  /api/session                                 → { alive, passedAt }
//   GET  /api/captcha                                 → captcha JPEG (starts a fresh ELS session)
//   POST /api/captcha/check  { code }                 → { ok }
//   GET  /api/recent                                  → recent searches (for the chips)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { ElsSession } from './src/els.mjs';
import { Registry, check } from './src/lookup.mjs';
import * as cache from './src/cache.mjs';
import { CHAIR_PRESETS } from './src/chairs.mjs';

const PORT = Number(process.env.PORT || 3000);
const ROOT = new URL('.', import.meta.url).pathname;
const session = new ElsSession();
const registry = new Registry(session);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s)); });

async function api(req, res, url) {
  const q = url.searchParams;
  if (url.pathname === '/api/session') return json(res, 200, session.status());
  if (url.pathname === '/api/recent') return json(res, 200, cache.getRecent());
  if (url.pathname === '/api/chairs') return json(res, 200, CHAIR_PRESETS);
  if (url.pathname === '/api/captcha') {
    try {
      const img = await session.captchaImage();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      return res.end(img);
    } catch (e) { return json(res, 502, { error: e.message }); }
  }
  if (url.pathname === '/api/captcha/check' && req.method === 'POST') {
    try {
      const { code } = JSON.parse(await readBody(req) || '{}');
      const ok = await session.captchaCheck(String(code ?? '').trim());
      return json(res, 200, { ok, ...session.status() });
    } catch (e) { return json(res, 502, { ok: false, error: e.message }); }
  }
  if (url.pathname === '/api/check') {
    const address = q.get('address') ?? '';
    const floor = q.get('floor') ?? '1';
    const chair = q.get('chair') ?? 'Leon';
    const live = q.get('live') === '1';
    let customChair = null;
    if (q.get('length') && q.get('width') && q.get('radius')) customChair = { length: +q.get('length'), width: +q.get('width'), turnRadius: +q.get('radius') };
    try {
      const result = await check(registry, { address, floor, chair, live, customChair });
      if (!result.error) cache.pushRecent({ address: result.address.zh, floor: result.floor, english: result.address.en });
      return json(res, 200, result);
    } catch (e) {
      if (e.needCaptcha) return json(res, 200, { needCaptcha: true, message: 'This address is not in the cache yet. Solve the registry captcha to run a live query.' });
      console.error(e);
      return json(res, 500, { error: e.message });
    }
  }
  json(res, 404, { error: 'not found' });
}

async function staticFile(res, pathname) {
  let p = pathname === '/' ? '/public/index.html' : pathname;
  if (!p.startsWith('/public/') && !p.startsWith('/src/')) p = '/public' + p;
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch((e) => json(res, 500, { error: e.message }));
  return staticFile(res, url.pathname);
}).listen(PORT, '0.0.0.0', () => console.log(`Can My Wheelchair Fit? → http://localhost:${PORT}`));
