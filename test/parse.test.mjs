import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseList, parseDetail, parseSpec, parseQueryPageTokens, normalizeLicense, isElevator, servesFloor } from '../src/parse.mjs';
import { judgeCabin, cabinForSpec } from '../src/judge.mjs';
import { CHAIR_PRESETS } from '../src/chairs.mjs';

const FX = process.env.HOME + '/work/elevator-research/fixtures/';
const FX2 = process.env.HOME + '/work/elevator-research/fixtures-20260920/';
const read = (p) => readFileSync(p, 'utf8');

test('query page tokens', () => {
  const t = parseQueryPageTokens(read(FX + 'query-page.html'));
  assert.equal(t.pkey, 'b5cdb9a87ed3da754a102c75625063ae');
  assert.equal(t.primaryId, '50fbf742f7215828fc1696fbcb567efc');
});

test('list: 松仁路123號 = 16 rows 華南銀行世貿大樓', () => {
  const { rows, total } = parseList(read(FX + 'list-songren123-p200.html'));
  assert.equal(rows.length, 16);
  assert.equal(total, 16);
  assert.equal(rows[0].id, 'A11009960103');
  assert.equal(rows[0].seq, 'de98');
  assert.equal(rows[0].buildingName, '華南銀行世貿大樓');
  assert.equal(rows[0].address, '110臺北市信義區松仁路123號');
  assert.equal(rows[0].deviceType, '昇降設備');
});

test('list: zero rows', () => {
  const { rows } = parseList(read(FX2 + 'list-zhongxiao-san-54-p10.html'));
  assert.equal(rows.length, 0);
});

test('list: 承德路2段 segment 68 rows', () => {
  const { rows } = parseList(read(FX2 + 'list-chengde2-seg-p200.html'));
  assert.equal(rows.length, 68);
});

test('detail: B11009960776 spec P24', () => {
  const d = parseDetail(read(FX + 'detail-B11009960776.html'));
  assert.equal(d.id, 'B11009960776');
  assert.equal(d.kind, '一般用升降機');
  assert.equal(d.buildingName, '華南銀行世貿大樓');
  assert.equal(d.spec, 'P24 1600-CO 150-16 S/1 -16F');
  assert.equal(d.licenseNo, '103使字第00318號');
  assert.ok(isElevator(d));
});

test('detail: escalator C11009960394 is not an elevator', () => {
  const d = parseDetail(read(FX + 'detail-C11009960394.html'));
  assert.ok(!isElevator(d));
  assert.equal(parseSpec(d.spec), null);
});

test('detail: 忠孝科技大樓 A10608390014 P8', () => {
  const d = parseDetail(read(FX2 + 'detail-A10608390014.html'));
  assert.equal(d.buildingName, '忠孝科技大樓');
  assert.equal(d.licenseNo, '083使字第0404號');
  const s = parseSpec(d.spec);
  assert.equal(s.code, 'P8');
  assert.equal(s.fromFloor, -1);
  assert.equal(s.toFloor, 13);
  assert.ok(servesFloor(s, 4));
});

test('detail: parking K10608360011 has no elevator spec', () => {
  const d = parseDetail(read(FX2 + 'detail-K10608360011.html'));
  assert.ok(!isElevator(d));
  assert.equal(parseSpec(d.spec), null);
});

test('spec variants', () => {
  const a = parseSpec('P24 1600-2S 150-30 S/B2 -27,RF');
  assert.equal(a.doorCode, '2S'); assert.equal(a.fromFloor, -2); assert.equal(a.toFloor, 27); assert.ok(a.roof);
  const b = parseSpec('P17 1150-CO 150-29 S/B2 -27F');
  assert.equal(b.persons, 17); assert.equal(b.loadKg, 1150);
  const c = parseSpec('P15 1000-CO 60 -3  S/B2     -1');
  assert.equal(c.fromFloor, -2); assert.equal(c.toFloor, 1); assert.equal(servesFloor(c, 3), false);
  const d = parseSpec('P10 700-CO 90-13 S/B2 -11F');
  assert.ok(servesFloor(d, 7));
  assert.equal(parseSpec('0     0-      -   S/   -   F'), null);
  assert.equal(parseSpec('F0 1600-   3  -  S/  -  F'), null);
});

test('license normalization: 0202 == 00202', () => {
  assert.equal(normalizeLicense('084使字第0202號').key, normalizeLicense('084使字第00202號').key);
  assert.notEqual(normalizeLicense('083使字第0404號').key, normalizeLicense('083使字第0233號').key);
});

test('judgment: demo verdicts', () => {
  const p24 = cabinForSpec(parseSpec('P24 1600-CO 150-16 S/1 -16F'));
  assert.equal(judgeCabin(p24, CHAIR_PRESETS['Leon']).label, 'FITS');
  assert.equal(judgeCabin(p24, CHAIR_PRESETS['KP-40']).label, 'STRAIGHT-IN ONLY');
  const p8 = cabinForSpec(parseSpec('P8   550-CO 90 -14 S/B1    -13'), { licenseYear: 83 });
  assert.equal(p8.depth, 1030);
  assert.equal(judgeCabin(p8, CHAIR_PRESETS['Leon']).label, 'SQUEEZE');
  assert.match(p8.notes[0], /Machine-room \(MR\)/);
  const p10 = cabinForSpec(parseSpec('P10 700-CO 90-13 S/B2 -11F'));
  assert.equal(judgeCabin(p10, CHAIR_PRESETS['Leon']).label, 'STRAIGHT-IN ONLY');
  assert.equal(judgeCabin({ width: 1400, depth: 1250, door: 800 }, { length: 1000, width: 800, turnRadius: 700 }).label, "CAN'T ENTER");
});
