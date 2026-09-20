// Address parsing (Chinese or Chunghwa Post romanised English) and display romanisation from
// static tables. The registry is queried in Chinese; the card shows English.

export const CITY = { code: '63000', zh: '臺北市', en: 'Taipei City', aliases: ['台北市', '臺北市', 'Taipei City', 'Taipei'] };

// Taipei districts. Codes for 信義/大安/大同/北投 were read from ELS DIST.do on 2026-09-15; the
// other eight follow the same Ministry of the Interior numbering (63000010 … 63000120).
export const DISTRICTS = [
  { zh: '松山區', en: 'Songshan Dist.', code: '63000010' },
  { zh: '信義區', en: 'Xinyi Dist.', code: '63000020' },
  { zh: '大安區', en: "Da'an Dist.", code: '63000030' },
  { zh: '中山區', en: 'Zhongshan Dist.', code: '63000040' },
  { zh: '中正區', en: 'Zhongzheng Dist.', code: '63000050' },
  { zh: '大同區', en: 'Datong Dist.', code: '63000060' },
  { zh: '萬華區', en: 'Wanhua Dist.', code: '63000070' },
  { zh: '文山區', en: 'Wenshan Dist.', code: '63000080' },
  { zh: '南港區', en: 'Nangang Dist.', code: '63000090' },
  { zh: '內湖區', en: 'Neihu Dist.', code: '63000100' },
  { zh: '士林區', en: 'Shilin Dist.', code: '63000110' },
  { zh: '北投區', en: 'Beitou Dist.', code: '63000120' },
];

// Road-name table (Chunghwa Post romanisation). Unknown roads keep their Chinese name.
export const ROADS = [
  { zh: '松仁路', en: 'Songren Rd.' },
  { zh: '忠孝東路', en: 'Zhongxiao E. Rd.' },
  { zh: '忠孝西路', en: 'Zhongxiao W. Rd.' },
  { zh: '振華街', en: 'Zhenhua St.' },
  { zh: '振興街', en: 'Zhenxing St.' },
  { zh: '承德路', en: 'Chengde Rd.' },
  { zh: '信義路', en: 'Xinyi Rd.' },
  { zh: '仁愛路', en: "Ren'ai Rd." },
  { zh: '南京東路', en: 'Nanjing E. Rd.' },
  { zh: '民生東路', en: 'Minsheng E. Rd.' },
  { zh: '中山北路', en: 'Zhongshan N. Rd.' },
  { zh: '基隆路', en: 'Keelung Rd.' },
  { zh: '市民大道', en: 'Civic Blvd.' },
  { zh: '復興南路', en: 'Fuxing S. Rd.' },
  { zh: '敦化南路', en: 'Dunhua S. Rd.' },
];

export const BUILDINGS = [
  { zh: '華南銀行世貿大樓', en: 'Hua Nan Bank World Trade Building' },
  { zh: '忠孝科技大樓', en: 'Zhongxiao Technology Building' },
  { zh: '至德大樓', en: 'Zhide Building' },
  { zh: '振華公園', en: 'Zhenhua Park' },
  { zh: '承德捷運廣場大樓', en: 'Chengde MRT Plaza Building' },
  { zh: '捷運廣場', en: 'MRT Plaza' },
];

const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
const CN_NUM_REV = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const FULLWIDTH = /[０-９]/g;
const toHalf = (s) => s.replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** Parse the street part: road, section, lane, alley, number, floor. */
export function parseStreet(street) {
  const s = toHalf(street).replace(/\s+/g, '');
  const m = s.match(/^(.*?(?:路|街|大道|道))(?:([一二三四五六七八九十\d]+)段)?(?:(\d+)巷)?(?:(\d+)弄)?(?:(\d+)(?:之(\d+))?號)?(?:(\d+)樓)?(.*)$/);
  if (!m) return { road: s, section: null, lane: null, alley: null, number: null, sub: null, floor: null, rest: '' };
  const sec = m[2] == null ? null : (CN_NUM[m[2]] ?? Number(m[2]));
  return { road: m[1], section: sec, lane: m[3] ? Number(m[3]) : null, alley: m[4] ? Number(m[4]) : null,
    number: m[5] ? Number(m[5]) : null, sub: m[6] ? Number(m[6]) : null, floor: m[7] ? Number(m[7]) : null, rest: m[8] ?? '' };
}

/** Build the registry query string for a parsed street; sectionForm: 'zh' (三段) or 'digit' (3段). */
export function formatStreet(p, { sectionForm = 'zh', withNumber = true } = {}) {
  let s = p.road;
  if (p.section != null) s += (sectionForm === 'zh' ? CN_NUM_REV[p.section] ?? p.section : p.section) + '段';
  if (p.lane != null) s += p.lane + '巷';
  if (p.alley != null) s += p.alley + '弄';
  if (withNumber && p.number != null) s += p.number + (p.sub != null ? '之' + p.sub : '') + '號';
  return s;
}

/**
 * Parse user input in Chinese ("台北市 大安區 忠孝東路三段54號") or English
 * ("No. 54, Sec. 3, Zhongxiao E. Rd., Da'an Dist., Taipei City").
 * Returns { city, cityName, district, districtName, street (registry form, Chinese numeral), parsed, lang }.
 */
export function parseAddress(input) {
  const raw = toHalf((input ?? '').trim());
  if (!raw) return null;
  if (/[一-鿿]/.test(raw)) return parseChinese(raw);
  return parseEnglish(raw);
}

function parseChinese(raw) {
  let s = raw.replace(/\s+/g, '').replace(/^\d{3,6}/, '');
  let city = null;
  for (const a of CITY.aliases) if (s.startsWith(a)) { city = CITY; s = s.slice(a.length); break; }
  let district = null;
  for (const d of DISTRICTS) if (s.startsWith(d.zh)) { district = d; s = s.slice(d.zh.length); break; }
  const parsed = parseStreet(s);
  return {
    city: CITY.code, cityName: CITY.zh, district: district?.code ?? '', districtName: district?.zh ?? '',
    street: formatStreet(parsed), parsed, lang: 'zh', input: raw,
  };
}

function parseEnglish(raw) {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  let number = null, section = null, road = null, district = null, floor = null;
  for (const part of parts) {
    let m;
    if ((m = part.match(/^No\.?\s*(\d+)(?:-(\d+))?$/i))) number = Number(m[1]);
    else if ((m = part.match(/^Sec\.?\s*(\d+)$/i))) section = Number(m[1]);
    else if ((m = part.match(/^(\d+)F$/i))) floor = Number(m[1]);
    else if (/Dist\.?$/i.test(part)) district = DISTRICTS.find((d) => d.en.toLowerCase() === part.toLowerCase().replace(/dist$/, 'dist.'));
    else if (/city$/i.test(part) || /^taipei$/i.test(part)) { /* city */ }
    else {
      const r = ROADS.find((x) => x.en.toLowerCase() === part.toLowerCase() || x.en.toLowerCase().replace(/\.$/, '') === part.toLowerCase().replace(/\.$/, ''));
      road = r ? r.zh : part;
    }
  }
  const parsed = { road: road ?? '', section, lane: null, alley: null, number, sub: null, floor, rest: '' };
  return {
    city: CITY.code, cityName: CITY.zh, district: district?.code ?? '', districtName: district?.zh ?? '',
    street: formatStreet(parsed), parsed, lang: 'en', input: raw,
  };
}

/** Chinese registry address (with or without zip/city/district) → Chunghwa Post English. */
export function romanizeAddress(zh) {
  const a = parseAddress(zh);
  if (!a) return '';
  return romanizeParsed(a);
}
export function romanizeParsed(a) {
  const p = a.parsed;
  const road = ROADS.find((r) => r.zh === p.road)?.en ?? p.road;
  const bits = [];
  if (p.number != null) bits.push(`No. ${p.number}${p.sub != null ? '-' + p.sub : ''}`);
  if (p.alley != null) bits.push(`Aly. ${p.alley}`);
  if (p.lane != null) bits.push(`Ln. ${p.lane}`);
  if (p.section != null) bits.push(`Sec. ${p.section}`);
  bits.push(road);
  const d = DISTRICTS.find((x) => x.code === a.district);
  if (d) bits.push(d.en);
  bits.push(CITY.en);
  return bits.join(', ');
}
export function romanizeBuilding(zh) {
  if (!zh) return '';
  for (const b of BUILDINGS) if (zh.includes(b.zh)) return zh.replace(b.zh, b.en).replace(/\s+/g, ' ').trim();
  return zh;
}
