// Parsers for the Taiwan national elevator registry (ELS, cloudbm.nlma.gov.tw).
// Everything here is pure: HTML string in, plain objects out. Tested against fixtures.
import * as cheerio from 'cheerio';

/** WAF: bare requests get HTTP 200 with a "Request Rejected" page. */
export function isRequestRejected(html) {
  return /Request Rejected/i.test(html);
}
/** Stale session: a ~900-byte page that loads /TSPD/?type=18 (bot challenge) instead of results. */
export function isTspdChallenge(html) {
  return /\/TSPD\//.test(html) || /系統已逾時/.test(html);
}

/** Scrape the two per-load tokens from the query page. */
export function parseQueryPageTokens(html) {
  const pkey = html.match(/var\s+sidjphumrsqf\s*=\s*"([0-9a-f]{32})"/)?.[1] ?? null;
  const $ = cheerio.load(html);
  const primaryId = $('input[name="frm_query_para_PRIMARYID"]').attr('value') ?? null;
  return { pkey, primaryId };
}

function cleanText(s) {
  return (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Parse a list fragment: rows with data-name cells, followed by an inspector/maintainer row. */
export function parseList(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table#AjaxTableid tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const cell = (name) => $tr.find(`td[data-name="${name}"]`);
    const id = cleanText(cell('設備').text());
    if (!id) return; // the second row of each pair (檢查機構 / 維護廠商) or the hidden spacer
    const onclick = $tr.find('button[onclick]').attr('onclick') ?? '';
    const m = onclick.match(/run_button2\('([^']+)',\s*'([^']+)'\)/);
    const nameCell = cell('建築物名稱');
    const nameHtml = nameCell.find('span').html() ?? nameCell.html() ?? '';
    const nameText = nameHtml.replace(/<br\s*\/?>/gi, '\n');
    const buildingName = cleanText(nameText.match(/名稱：([^\n]*)/)?.[1]);
    const address = cleanText(nameText.match(/地址：([^\n]*)/)?.[1]);
    rows.push({
      id,
      seq: m?.[2] ?? null,
      deviceType: cleanText(cell('設備類型').text()),
      authority: cleanText(cell('主管機關').text()),
      permitNo: cleanText(cell('使用').text()),
      buildingName,
      address,
      permitExpiry: cleanText(cell('許可證').text()),
      status: cleanText(cell('狀態').text()),
    });
  });
  const totalMatch = html.replace(/&nbsp;/g, ' ').match(/共\s*(\d+)\s*筆/);
  const total = totalMatch ? Number(totalMatch[1]) : rows.length;
  return { rows, total };
}

const DETAIL_LABELS = ['設備統一編碼', '設備種類', '建築物名稱', '執照號碼', '發照日期', '地址', '使用許可證號', '設備保養編號', '設備規格', '竣工檢查年度', '維護廠商', '檢查機構', '設置無障礙設施', '功能別'];

/** Parse a detail page. Some labels appear twice: take the first NON-EMPTY value per label. */
export function parseDetail(html) {
  const $ = cheerio.load(html);
  const out = {};
  $('td.name').each((_, td) => {
    const label = cleanText($(td).text());
    if (!DETAIL_LABELS.includes(label)) return;
    const value = cleanText($(td).next('td').text());
    if (value && !out[label]) out[label] = value;
  });
  for (const l of DETAIL_LABELS) if (!(l in out)) out[l] = '';
  return {
    id: out['設備統一編碼'],
    kind: out['設備種類'],
    buildingName: out['建築物名稱'],
    licenseNo: out['執照號碼'],
    licenseDate: out['發照日期'],
    address: out['地址'],
    permitNo: out['使用許可證號'],
    maintenanceNo: out['設備保養編號'],
    spec: out['設備規格'],
    completionYear: out['竣工檢查年度'],
    maintainer: out['維護廠商'],
    inspector: out['檢查機構'],
  };
}

/**
 * Spec string: `{code} {loadKg}-{door} {speed}-{stops} S/{from} -{to}`
 * e.g. `P24 1600-CO 150-16 S/1 -16F`, `P8   550-CO 90 -14 S/B1    -13`, `P24 1600-2S 150-30 S/B2 -27,RF`.
 * Returns null for non-elevator specs (parking `F0 1600- 3 - S/ - F`, escalator `0 0- - S/ - F`).
 */
export function parseSpec(raw) {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  const m = s.match(/^([A-Z])\s*(\d+)\s+(\d+)\s*-\s*([A-Z0-9]*)\s+([\d.]*)\s*-\s*(\d*)\s+S\/\s*([A-Z]*\d*)\s*-\s*([A-Z0-9,]*)$/i);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const persons = Number(m[2]);
  if (!/[PB]/.test(letter) || persons === 0) return null;
  const doorCode = m[4].toUpperCase();
  const from = parseFloorToken(m[7]);
  const toRaw = m[8].toUpperCase();
  const roof = /RF/.test(toRaw);
  const to = parseFloorToken(toRaw.replace(/,?RF/, '').replace(/F$/, ''));
  return {
    raw: s,
    code: `${letter}${persons}`,
    letter,
    persons,
    loadKg: Number(m[3]),
    doorCode,
    doorType: doorCode.includes('CO') ? 'center-opening' : doorCode.includes('S') ? 'side-opening' : doorCode || 'unknown',
    speed: m[5] ? Number(m[5]) : null,
    stops: m[6] ? Number(m[6]) : null,
    fromFloor: from,
    toFloor: to,
    roof,
  };
}

/** B2 → -2, B1 → -1, 1 → 1, 13 → 13, '' → null. */
export function parseFloorToken(t) {
  if (!t) return null;
  const s = String(t).toUpperCase().trim();
  const b = s.match(/^B(\d+)$/);
  if (b) return -Number(b[1]);
  const n = s.match(/^(\d+)F?$/);
  return n ? Number(n[1]) : null;
}

/** Floor label for display: -1 → B1, 12 → 12F. */
export function floorLabel(n) {
  if (n == null) return '?';
  return n < 0 ? `B${-n}` : `${n}F`;
}

/** Does the car serve this floor? Floor 0 does not exist; B1 is -1. */
export function servesFloor(spec, floor) {
  if (!spec || spec.fromFloor == null || spec.toFloor == null) return null;
  if (floor === 0) return false;
  return floor >= spec.fromFloor && floor <= spec.toFloor;
}

/** 「{year}使字第{serial}號」 → { year, serial } with the serial as an integer (0202 == 00202). */
export function normalizeLicense(s) {
  const m = (s ?? '').match(/(\d+)\s*使字第\s*0*(\d+)\s*號/);
  if (!m) return null;
  return { year: Number(m[1]), serial: Number(m[2]), key: `${Number(m[1])}/${Number(m[2])}` };
}

/** Elevator or not: use the detail's 設備種類 (ends in 升降機) or the ID prefix (A/B), never 設備類型. */
export function isElevator({ id, kind }) {
  if (kind) return /升降機$/.test(kind) && !/自動樓梯/.test(kind);
  return /^[AB]/.test(id ?? '');
}
