// HTTP client for the Taiwan national elevator registry (ELS). One session = one cookie jar +
// the two per-load tokens + captchaPassedAt. Sequence verified with curl on 2026-09-18:
//   1 GET ELSQuery.do (tokens) → 2 GET VaildImage.do (captcha) → 3 POST VaildImageCheck.do
//   → 4 POST elsq11q_lst.jsp (list, header ELSpkey) → 5 POST queryAjax.do page size 200 (302, follow)
//   → 6 POST elsq11q_frm.jsp?q=qr&ipno=<id>&seq=<seq> (detail).
// The live path is NOT exercised on Build Day itself (every demo query is served from the cache
// seeded from raw fixtures); it stays here as the product's real data path.
import { parseQueryPageTokens, parseList, parseDetail, isRequestRejected, isTspdChallenge } from './parse.mjs';

export const BASE = 'https://cloudbm.nlma.gov.tw';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
};
const HEARTBEAT_MS = 5 * 60 * 1000;

export class SessionError extends Error {}
export class NeedCaptchaError extends Error {
  constructor(msg = 'captcha required') { super(msg); this.needCaptcha = true; }
}

export class ElsSession {
  constructor() { this.reset(); }
  reset() {
    this.jar = new Map();
    this.pkey = null;
    this.primaryId = null;
    this.captchaPassedAt = null;
    this.stopHeartbeat();
  }
  get alive() { return !!this.captchaPassedAt; }
  status() { return { alive: this.alive, passedAt: this.captchaPassedAt }; }

  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  /** One request with our cookie jar; follows 302 with the same jar (step 5 needs it). */
  async request(path, { method = 'GET', body = null, headers = {}, follow = true } = {}) {
    let url = BASE + path;
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(url, {
        method, body, redirect: 'manual',
        headers: { ...BASE_HEADERS, ...headers, ...(this.jar.size ? { Cookie: this.cookieHeader() } : {}) },
      });
      this.storeCookies(res);
      if (follow && res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url).toString();
        method = 'GET'; body = null; headers = {};
        continue;
      }
      return res;
    }
    throw new SessionError('too many redirects');
  }
  async text(path, opts) {
    const res = await this.request(path, opts);
    const html = await res.text();
    if (isRequestRejected(html)) throw new SessionError('WAF: Request Rejected');
    if (isTspdChallenge(html)) { this.reset(); throw new SessionError('TSPD challenge / session expired — restart the session'); }
    return html;
  }

  /** Step 1: fresh session, scrape tokens. */
  async start() {
    this.reset();
    const html = await this.text('/ELS/ELSQuery.do');
    const { pkey, primaryId } = parseQueryPageTokens(html);
    if (!pkey || !primaryId) throw new SessionError('tokens not found on the query page');
    this.pkey = pkey; this.primaryId = primaryId;
    return this.status();
  }
  /** Step 2: captcha image (proxied to the human — the app never reads it). */
  async captchaImage() {
    if (!this.pkey) await this.start();
    const res = await this.request('/ELS/VaildImage.do', { headers: { Accept: 'image/*' } });
    return Buffer.from(await res.arrayBuffer());
  }
  /** Step 3: the only place the captcha is checked. */
  async captchaCheck(code) {
    const xml = await this.text('/ELS/VaildImageCheck.do', {
      method: 'POST', body: new URLSearchParams({ validCodeStr: code }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: '*/*' },
    });
    const ok = /<ISOK>\s*true\s*<\/ISOK>/i.test(xml);
    if (ok) { this.captchaPassedAt = new Date().toISOString(); this.startHeartbeat(); }
    return ok;
  }
  /** Step 3b: keep the server session warm every 5 minutes; stop when it says false. */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(async () => {
      try {
        const xml = await this.text(`/ELS/sessionTimeoutCheck.do?nowdate=${Date.now()}`, { headers: { Accept: '*/*' } });
        if (/<ISOK>\s*false\s*<\/ISOK>/i.test(xml)) this.reset();
      } catch { this.reset(); }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }
  stopHeartbeat() { if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = null; }

  requireAlive() { if (!this.alive) throw new NeedCaptchaError(); }

  /** Steps 4 + 5: list query with every field present, then page size 200 (follow the 302). */
  async list(p) {
    this.requireAlive();
    const form = {
      Qry_ELPB_ELPTYPE: p.type ?? '', Qry_ELPB_ADMORGAN: '', Qry_ELPB_ADMORGANNAME: '',
      Qry_ELPB_USAGELICIDXKEY: p.lic ?? '', Qry_ELPB_BUILDINGNAME: p.name ?? '',
      Qry_ELPB_BUDCITY: p.city ?? '', Qry_ELPB_BUDDIST8: p.dist ?? '', Qry_ELPB_BUDCBADDR: p.addr ?? '',
      Qry_NO: '', Qry_ELIC_PERMITID: '', imageCodetxt: '', Qry_vProgramNo: 'elsq10',
      frm_query_para_PRIMARYID: this.primaryId, frm_query_para_sortKeys: 'null', fromajax: 'true',
      QueryParamButton_executeQuery: '執行查詢',
    };
    const h = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', ELSpkey: this.pkey, Accept: '*/*' };
    const first = parseList(await this.text('/ELS/maliapp/elsq00/elsq11q/elsq11q_lst.jsp?queryparammode=true', {
      method: 'POST', body: new URLSearchParams(form).toString(), headers: h,
    }));
    if (first.total <= first.rows.length) return this.sanity(first.rows, p);
    const rows = [];
    for (let page = 1; rows.length < first.total && page < 50; page++) {
      const html = await this.text('/ELS/queryAjax.do?queryparammode=true&', {
        method: 'POST', headers: h,
        body: new URLSearchParams({ P_PAGE_SIZE: '200', P_CUR_PAGE: String(page), cur_page: String(page), fromajax: 'true', frm_query_para_PRIMARYID: this.primaryId }).toString(),
      });
      const pg = parseList(html);
      if (!pg.rows.length) break;
      rows.push(...pg.rows);
    }
    return this.sanity(rows, p);
  }
  /** Without ELSpkey the server ignores every filter and returns unrelated buildings: detect that. */
  sanity(rows, p) {
    if (p.addr && rows.length && !rows.some((r) => r.address.includes(p.addr.replace(/號.*$/, '號')))) {
      throw new SessionError('list rows do not match the query — request bug (missing ELSpkey?)');
    }
    return rows;
  }
  /** Step 6: detail page; seq is mandatory (without it the page is an empty template). */
  async detail(id, seq) {
    this.requireAlive();
    const html = await this.text(`/ELS/maliapp/elsq00/elsq11q/elsq11q_frm.jsp?q=qr&ipno=${encodeURIComponent(id)}&seq=${encodeURIComponent(seq)}`, {
      method: 'POST', body: '=&responseText=true',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: '*/*' },
    });
    const d = parseDetail(html);
    if (!d.buildingName) throw new SessionError(`detail ${id}: empty template (seq missing/invalid)`);
    return d;
  }
}
