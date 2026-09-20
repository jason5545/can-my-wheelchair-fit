// Query pipeline: address → registry rows → elevator details → cabin → verdict.
// Every registry call goes through the JSON cache; the live session is used only on a miss
// (or when the caller asks for a live query), and only after the human passed the captcha.
//
// Address degradation chain (each step only when the previous one found nothing):
//   1a exact address as typed → 1b numeral-form / sub-number variants (三段 ↔ 3段, drop 之X)
//   → license expansion (devices of the same 使用執照 registered under a sibling 門牌, e.g. 52號 + 54號)
//   → 1c sideways link: a parking row on the queried 門牌 points to the sibling number that holds
//     the elevators (215號 parking ↔ 217號 elevators, same permit 0202 = 00202) → candidates ranked
//     by evidence strength → the HUMAN confirms before any verdict.
//   → 2 NO ELEVATOR when nothing (or only 公園/停車場 units) is registered.
import * as cache from './cache.mjs';
import { NeedCaptchaError } from './els.mjs';
import { parseAddress, romanizeParsed, romanizeBuilding, romanizeAddress, formatStreet } from './address.mjs';
import { parseSpec, servesFloor, isElevator, normalizeLicense, floorLabel } from './parse.mjs';
import { cabinForSpec, judgeBuilding, VERDICTS } from './judge.mjs';
import { CHAIR_PRESETS } from './chairs.mjs';

const ELEVATOR_PREFIX = /^[AB]/;
const PARK_OR_LOT = /公園|停車場/;

export class Registry {
  constructor(session) { this.session = session; }

  /** List query; with soft=true a cache miss without a live session returns null instead of throwing. */
  async list(params, { live = false, soft = false } = {}) {
    const p = cache.listParams(params);
    if (!live) {
      const hit = cache.getList(p);
      if (hit) return { rows: hit.rows, cached: true, fetchedAt: hit.fetchedAt };
    }
    if (!this.session?.alive) { if (soft) return null; throw new NeedCaptchaError(); }
    const rows = await this.session.list(p);
    cache.putList(p, rows);
    return { rows, cached: false, fetchedAt: new Date().toISOString() };
  }

  async detail(row, { live = false, soft = false } = {}) {
    if (!live) {
      const hit = cache.getDetail(row.id);
      if (hit) return { detail: hit.detail, cached: true };
    }
    if (!this.session?.alive) { if (soft) return null; throw new NeedCaptchaError(); }
    const d = await this.session.detail(row.id, row.seq);
    cache.putDetail(row.id, d);
    return { detail: d, cached: false };
  }
}

/** 「103使字第00318號」 → "103-00318" (ROC year - serial) for the English card. */
export function licenseLabel(raw) {
  const m = (raw ?? '').match(/(\d+)\s*使字第\s*(\d+)\s*號/);
  return m ? `${m[1]}-${m[2]}` : raw ?? '';
}

function toElevator(detail) {
  const spec = parseSpec(detail.spec);
  if (!isElevator(detail) || !spec) return null;
  const lic = normalizeLicense(detail.licenseNo);
  return {
    id: detail.id, kind: detail.kind, buildingName: detail.buildingName, buildingNameEn: romanizeBuilding(detail.buildingName),
    address: detail.address, addressEn: romanizeAddress(detail.address), licenseNo: detail.licenseNo, licenseLabel: licenseLabel(detail.licenseNo), license: lic,
    maintenanceNo: detail.maintenanceNo, maintainer: detail.maintainer, completionYear: detail.completionYear,
    spec, cabin: cabinForSpec(spec, { licenseYear: lic?.year }),
    floors: `${floorLabel(spec.fromFloor)}–${floorLabel(spec.toFloor)}${spec.roof ? '+RF' : ''}`,
  };
}

/** Registry rows → elevator objects (skips non-elevators; soft-skips details that are not available). */
export async function elevatorsFromRows(registry, rows, opts) {
  const out = []; let skipped = 0;
  for (const row of rows) {
    if (!ELEVATOR_PREFIX.test(row.id)) continue; // C escalator, I/K/N/G parking etc.
    const r = await registry.detail(row, opts);
    if (!r) { skipped++; continue; }
    const e = toElevator(r.detail);
    if (e) out.push(e);
  }
  out.skipped = skipped;
  return out;
}

/** 1b: numeral-form and sub-number variants of the street string, exact form excluded. */
export function streetVariants(parsed, exact) {
  const set = new Set();
  for (const sectionForm of ['zh', 'digit']) {
    set.add(formatStreet(parsed, { sectionForm }));
    if (parsed.sub != null) set.add(formatStreet({ ...parsed, sub: null }, { sectionForm }));
  }
  set.delete(exact);
  return [...set];
}

const numberOf = (addr) => { const m = (addr ?? '').match(/(\d+)號/); return m ? Number(m[1]) : null; };
const stripBuildingWord = (s) => (s ?? '').replace(/大樓|大廈|廣場|中心/g, '');

/** 1c: sideways candidates for a queried 門牌 that has only parking rows. */
async function sidewaysCandidates(registry, a, parkingRows, opts) {
  const steps = [];
  const soft = { ...opts, soft: true };
  const anchorRow = parkingRows[0];
  const anchorDetail = (await registry.detail(anchorRow, soft))?.detail;
  const anchorLic = normalizeLicense(anchorDetail?.licenseNo);
  const anchorName = anchorDetail?.buildingName || anchorRow.buildingName;
  const number = a.parsed.number;
  const found = new Map(); // id → { row, source }

  // Direct license query first (catches 52號/54號; misses zero-padding variants).
  if (anchorDetail?.licenseNo) {
    const r = await registry.list({ lic: anchorDetail.licenseNo }, soft);
    steps.push({ step: 'license', query: anchorDetail.licenseNo, rows: r ? r.rows.length : null, cached: r?.cached ?? false, skipped: !r });
    for (const row of r?.rows ?? []) if (ELEVATOR_PREFIX.test(row.id)) found.set(row.id, { row, source: 'license' });
  }
  // Street segment without a number, both numeral forms (they are disjoint sets), same parity within ±4.
  if (number != null) {
    for (const sectionForm of ['zh', 'digit']) {
      const seg = formatStreet(a.parsed, { sectionForm, withNumber: false });
      const r = await registry.list({ city: a.city, dist: a.district, addr: seg }, soft);
      steps.push({ step: 'segment', query: seg, rows: r ? r.rows.length : null, cached: r?.cached ?? false, skipped: !r });
      for (const row of r?.rows ?? []) {
        const n = numberOf(row.address);
        if (!ELEVATOR_PREFIX.test(row.id) || n == null || n === number || n % 2 !== number % 2 || Math.abs(n - number) > 4) continue;
        if (PARK_OR_LOT.test(row.buildingName)) continue;
        if (!found.has(row.id)) found.set(row.id, { row, source: 'segment' });
      }
    }
  }
  // Open the candidates' details and rank by evidence.
  const groups = new Map();
  let skipped = 0;
  for (const { row } of found.values()) {
    const d = (await registry.detail(row, soft))?.detail;
    if (!d) { skipped++; continue; }
    const e = toElevator(d);
    if (!e) continue;
    const lic = e.license;
    const sameLicense = !!(anchorLic && lic && anchorLic.key === lic.key);
    const n = numberOf(e.address);
    const adjacent = number != null && n != null && n % 2 === number % 2 && Math.abs(n - number) <= 4;
    const an = stripBuildingWord(anchorName), en = stripBuildingWord(e.buildingName);
    const nameOverlap = !!(an && en && (an.includes(en) || en.includes(an)));
    let strength = 'WEAK', why;
    if (sameLicense) { strength = 'STRONG'; why = `Same occupancy permit as the parking at No. ${number}: ${licenseLabel(anchorDetail.licenseNo)} = ${e.licenseLabel} (zero-padding differs, same number).`; }
    else if (nameOverlap && adjacent) { strength = 'MEDIUM'; why = `Building name "${e.buildingNameEn}" overlaps "${romanizeBuilding(anchorName)}" and No. ${n} is next door on the same side.`; }
    else { why = `Same side of the street, ${Math.abs((n ?? 0) - (number ?? 0))} numbers away — proximity only, not proof.`; }
    const key = `${e.address}|${e.buildingName}`;
    if (!groups.has(key)) groups.set(key, { address: { zh: e.address.replace(/^\d{3,6}/, ''), en: e.addressEn }, building: { zh: e.buildingName, en: e.buildingNameEn, licenseNo: e.licenseNo, licenseLabel: e.licenseLabel }, strength, why, elevators: [] });
    groups.get(key).elevators.push(e);
  }
  const rank = { STRONG: 0, MEDIUM: 1, WEAK: 2 };
  const candidates = [...groups.values()].sort((x, y) => rank[x.strength] - rank[y.strength]);
  return { candidates, steps, skipped, anchor: { building: { zh: anchorName, en: romanizeBuilding(anchorName), licenseNo: anchorDetail?.licenseNo ?? '', licenseLabel: licenseLabel(anchorDetail?.licenseNo) }, parkingUnits: parkingRows.length } };
}

/** Main entry: { address, floor, chair, live } → result JSON. */
export async function check(registry, { address, floor, chair = 'Leon', live = false, customChair = null }) {
  const a = parseAddress(address);
  if (!a || !a.parsed.road) return { error: 'Please enter an address with a street name.' };
  const chairSpec = customChair ?? CHAIR_PRESETS[chair] ?? CHAIR_PRESETS.Leon;
  const floorN = Number(floor) || 1;
  const steps = [];
  const opts = { live };
  const base = {
    address: { input: address, zh: `${a.cityName}${a.districtName}${a.street}`, en: romanizeParsed(a), district: a.districtName, number: a.parsed.number },
    floor: floorN, chair: { name: customChair ? 'Custom' : chair, ...chairSpec }, steps,
  };

  // 1a exact, then 1b variants.
  let rows = [];
  let matchedQuery = a.street;
  for (const [i, q] of [a.street, ...streetVariants(a.parsed, a.street)].entries()) {
    const r = await registry.list({ city: a.city, dist: a.district, addr: q }, opts);
    steps.push({ step: i === 0 ? 'exact' : 'variant', query: q, rows: r.rows.length, cached: r.cached });
    if (r.rows.length) { rows = r.rows; matchedQuery = q; break; }
  }
  const excluded = rows.filter((x) => PARK_OR_LOT.test(x.buildingName));
  const usable = rows.filter((x) => !PARK_OR_LOT.test(x.buildingName));
  if (!usable.length) {
    const why = rows.length
      ? `${rows.length} registered device(s) at this address belong to ${[...new Set(excluded.map((x) => romanizeBuilding(x.buildingName)))].join(', ')} — a park / car-park lift, not a building elevator.`
      : `No device is registered at ${base.address.en} in the national elevator registry.`;
    return noElevator(base, why, rows);
  }

  const elevRows = usable.filter((x) => ELEVATOR_PREFIX.test(x.id));
  const parkingRows = usable.filter((x) => !ELEVATOR_PREFIX.test(x.id));
  let elevators = await elevatorsFromRows(registry, elevRows, opts);

  // Sideways link: parking registered here, elevators not → candidates for the human to confirm.
  if (!elevators.length) {
    if (parkingRows.length && a.parsed.number != null) {
      const side = await sidewaysCandidates(registry, a, parkingRows, opts);
      steps.push(...side.steps);
      if (side.candidates.length) {
        const top = side.candidates[0];
        return {
          ...base, verdict: VERDICTS.NO_ELEVATOR.label, icon: VERDICTS.NO_ELEVATOR.icon, verdictKey: 'NO_ELEVATOR', needsConfirmation: true,
          reasons: [
            `No passenger elevator is registered at No. ${a.parsed.number} — only ${side.anchor.parkingUnits} mechanical parking unit(s) of ${side.anchor.building.en} (permit ${side.anchor.building.licenseLabel}).`,
            `Found ${top.building.en} with ${top.elevators.length} elevator(s) registered at ${top.address.en} — evidence: ${top.strength}. ${top.why}`,
            'Is this your building? Confirm below and the verdict is computed for that building. The machine ranks evidence; you make the call.',
          ],
          candidates: side.candidates.map((c) => ({ ...c, elevators: c.elevators.map((e) => ({ id: e.id, spec: e.spec.raw, floors: e.floors })) })),
          anchor: side.anchor, building: null,
          evidence: { counts: { rows: rows.length, elevators: 0, servingFloor: 0 } }, elevators: [], otherElevators: [],
        };
      }
    }
    return noElevator(base, `${rows.length} device(s) registered at this address, but none is a passenger elevator (${parkingRows.length} parking / escalator units).`, rows);
  }

  // License expansion: devices of the same 使用執照 registered under a sibling 門牌 (52號 + 54號).
  const seenIds = new Set(rows.map((x) => x.id));
  for (const licNo of [...new Set(elevators.map((e) => e.licenseNo).filter(Boolean))]) {
    const r = await registry.list({ lic: licNo }, { ...opts, soft: true });
    steps.push({ step: 'license', query: licNo, rows: r ? r.rows.length : null, cached: r?.cached ?? false, skipped: !r });
    if (!r) continue;
    const extraRows = r.rows.filter((x) => !seenIds.has(x.id));
    for (const x of extraRows) seenIds.add(x.id);
    rows = rows.concat(extraRows);
    const extra = await elevatorsFromRows(registry, extraRows.filter((x) => !PARK_OR_LOT.test(x.buildingName)), { ...opts, soft: true });
    const want = normalizeLicense(licNo)?.key;
    elevators = elevators.concat(extra.filter((e) => e.license?.key === want && !elevators.some((k) => k.id === e.id)));
  }

  const serving = elevators.filter((e) => servesFloor(e.spec, floorN));
  if (!serving.length) return noElevator(base, `${elevators.length} elevator(s) registered, but none serves floor ${floorLabel(floorN)} (coverage: ${[...new Set(elevators.map((e) => e.floors))].join(', ')}).`, rows, elevators);

  // Fan-out: several buildings under one 門牌 → prefer the one with most cars serving the floor; list the others.
  const byBuilding = new Map();
  for (const e of serving) { if (!byBuilding.has(e.buildingName)) byBuilding.set(e.buildingName, []); byBuilding.get(e.buildingName).push(e); }
  const buildings = [...byBuilding.entries()].sort((x, y) => y[1].length - x[1].length);
  const chosen = buildings[0][1];
  const judged = judgeBuilding(chosen, chairSpec);
  const best = judged[0];
  return {
    ...base, matchedQuery,
    verdict: best.verdict.label, icon: best.verdict.icon, verdictKey: best.verdict.key, reasons: best.verdict.reasons,
    building: { zh: best.elevator.buildingName, en: best.elevator.buildingNameEn, licenseNo: best.elevator.licenseNo, licenseLabel: best.elevator.licenseLabel },
    otherBuildings: buildings.slice(1).map(([name, list]) => ({ zh: name, en: romanizeBuilding(name), elevators: list.length })),
    evidence: {
      buildingName: best.elevator.buildingNameEn, spec: best.elevator.spec.raw, code: best.elevator.spec.code,
      cabin: best.elevator.cabin, door: best.elevator.cabin.door, chair: chairSpec, floors: best.elevator.floors,
      deviceId: best.elevator.id, notes: best.elevator.cabin.notes,
      counts: { rows: rows.length, elevators: elevators.length, servingFloor: serving.length },
    },
    elevators: chosen,
    otherElevators: elevators.filter((e) => !chosen.includes(e)),
  };
}

function noElevator(base, why, rows = [], elevators = []) {
  const reasons = [why];
  if (!elevators.length) reasons.push('Buildings of 5 floors or fewer are legally exempt from installing an elevator in Taiwan — check with the site before you go.');
  return {
    ...base, verdict: VERDICTS.NO_ELEVATOR.label, icon: VERDICTS.NO_ELEVATOR.icon, verdictKey: 'NO_ELEVATOR', reasons,
    building: null, evidence: { counts: { rows: rows.length, elevators: elevators.length, servingFloor: 0 } }, elevators: [], otherElevators: elevators,
  };
}
