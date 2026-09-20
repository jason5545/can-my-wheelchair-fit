// Query pipeline: address → registry rows → elevator details → cabin → verdict.
// Every registry call goes through the JSON cache; the live session is used only on a miss
// (or when the caller asks for a live query), and only after the human passed the captcha.
import * as cache from './cache.mjs';
import { NeedCaptchaError } from './els.mjs';
import { parseAddress, romanizeParsed, romanizeBuilding, romanizeAddress } from './address.mjs';
import { parseSpec, servesFloor, isElevator, normalizeLicense, floorLabel } from './parse.mjs';
import { cabinForSpec, judgeBuilding, VERDICTS } from './judge.mjs';
import { CHAIR_PRESETS } from './chairs.mjs';

const ELEVATOR_PREFIX = /^[AB]/;

export class Registry {
  constructor(session) { this.session = session; }

  async list(params, { live = false } = {}) {
    const p = cache.listParams(params);
    if (!live) {
      const hit = cache.getList(p);
      if (hit) return { rows: hit.rows, cached: true, fetchedAt: hit.fetchedAt };
    }
    if (!this.session?.alive) throw new NeedCaptchaError();
    const rows = await this.session.list(p);
    cache.putList(p, rows);
    return { rows, cached: false, fetchedAt: new Date().toISOString() };
  }

  async detail(row, { live = false } = {}) {
    if (!live) {
      const hit = cache.getDetail(row.id);
      if (hit) return { detail: hit.detail, cached: true };
    }
    if (!this.session?.alive) throw new NeedCaptchaError();
    const d = await this.session.detail(row.id, row.seq);
    cache.putDetail(row.id, d);
    return { detail: d, cached: false };
  }
}

/** Turn registry rows into elevator objects with parsed spec + cabin (skips non-elevators). */
export async function elevatorsFromRows(registry, rows, opts) {
  const out = [];
  for (const row of rows) {
    if (!ELEVATOR_PREFIX.test(row.id)) continue; // C escalator, I/K/N/G parking etc.
    const { detail } = await registry.detail(row, opts);
    if (!isElevator(detail)) continue;
    const spec = parseSpec(detail.spec);
    if (!spec) continue;
    const lic = normalizeLicense(detail.licenseNo);
    out.push({
      id: detail.id, kind: detail.kind, buildingName: detail.buildingName, buildingNameEn: romanizeBuilding(detail.buildingName),
      address: detail.address, addressEn: romanizeAddress(detail.address), licenseNo: detail.licenseNo, license: lic,
      maintenanceNo: detail.maintenanceNo, maintainer: detail.maintainer, completionYear: detail.completionYear,
      spec, cabin: cabinForSpec(spec, { licenseYear: lic?.year }),
      floors: `${floorLabel(spec.fromFloor)}–${floorLabel(spec.toFloor)}${spec.roof ? '+RF' : ''}`,
    });
  }
  return out;
}

/** Main entry: { address, floor, chair, live } → result JSON. */
export async function check(registry, { address, floor, chair = 'Leon', live = false, customChair = null }) {
  const a = parseAddress(address);
  if (!a || !a.parsed.road) return { error: 'Please enter an address with a street name.' };
  const chairSpec = customChair ?? CHAIR_PRESETS[chair] ?? CHAIR_PRESETS.Leon;
  const floorN = Number(floor) || 1;
  const steps = [];
  const opts = { live };

  // 1a. Exact address as typed (Chinese-numeral form).
  const params = { type: '', lic: '', name: '', city: a.city, dist: a.district, addr: a.street };
  const r = await registry.list(params, opts);
  steps.push({ step: 'exact', query: a.street, rows: r.rows.length, cached: r.cached });
  const rows = r.rows;

  const base = {
    address: { input: address, zh: `${a.cityName}${a.districtName}${a.street}`, en: romanizeParsed(a), district: a.districtName },
    floor: floorN, chair: { name: customChair ? 'Custom' : chair, ...chairSpec }, steps,
  };

  if (!rows.length) return noElevator(base, `No device is registered at ${base.address.en}.`);

  const elevators = await elevatorsFromRows(registry, rows, opts);
  const parking = rows.filter((x) => !ELEVATOR_PREFIX.test(x.id)).length;
  if (!elevators.length) return noElevator(base, `${rows.length} device(s) registered at this address, but none is a passenger elevator${parking ? ` (${parking} parking/escalator units)` : ''}.`, rows);

  const serving = elevators.filter((e) => servesFloor(e.spec, floorN));
  if (!serving.length) return noElevator(base, `${elevators.length} elevator(s) registered, but none serves floor ${floorLabel(floorN)} (coverage: ${[...new Set(elevators.map((e) => e.floors))].join(', ')}).`, rows, elevators);

  const judged = judgeBuilding(serving, chairSpec);
  const best = judged[0];
  return {
    ...base,
    verdict: best.verdict.label, icon: best.verdict.icon, verdictKey: best.verdict.key, reasons: best.verdict.reasons,
    building: { zh: best.elevator.buildingName, en: best.elevator.buildingNameEn, licenseNo: best.elevator.licenseNo },
    evidence: {
      buildingName: best.elevator.buildingNameEn, spec: best.elevator.spec.raw, code: best.elevator.spec.code,
      cabin: best.elevator.cabin, door: best.elevator.cabin.door, chair: chairSpec, floors: best.elevator.floors,
      deviceId: best.elevator.id, notes: best.elevator.cabin.notes,
      counts: { rows: rows.length, elevators: elevators.length, servingFloor: serving.length },
    },
    elevators: serving,
    otherElevators: elevators.filter((e) => !servesFloor(e.spec, floorN)),
  };
}

function noElevator(base, why, rows = [], elevators = []) {
  return {
    ...base, verdict: VERDICTS.NO_ELEVATOR.label, icon: VERDICTS.NO_ELEVATOR.icon, verdictKey: 'NO_ELEVATOR',
    reasons: [why, 'Buildings of 5 floors or fewer are legally exempt from installing an elevator in Taiwan.'],
    building: null, evidence: { counts: { rows: rows.length, elevators: elevators.length, servingFloor: 0 } }, elevators: [], otherElevators: elevators,
  };
}
