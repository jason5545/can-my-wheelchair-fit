// End-to-end over the seeded cache (no network): the five demo addresses and the degradation chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, check, streetVariants, licenseLabel } from '../src/lookup.mjs';
import { parseAddress, romanizeAddress } from '../src/address.mjs';

const reg = new Registry(null); // no live session: everything must come from the cache
const run = (address, floor, chair = 'Leon') => check(reg, { address, floor, chair });

test('address parsing: Chinese and English forms agree', () => {
  const zh = parseAddress('台北市 大安區 忠孝東路三段54號');
  const en = parseAddress("No. 54, Sec. 3, Zhongxiao E. Rd., Da'an Dist., Taipei City");
  assert.equal(zh.street, '忠孝東路三段54號');
  assert.equal(en.street, '忠孝東路三段54號');
  assert.equal(zh.district, '63000030');
  assert.equal(en.district, '63000030');
  assert.equal(romanizeAddress('110臺北市信義區松仁路123號'), 'No. 123, Songren Rd., Xinyi Dist., Taipei City');
  assert.deepEqual(streetVariants(zh.parsed, zh.street), ['忠孝東路3段54號']);
  assert.equal(licenseLabel('084使字第00202號'), '084-00202');
});

test('松仁路123號 12F: FITS for Leon, STRAIGHT-IN ONLY for KP-40, same P24 car', async () => {
  const a = await run('No. 123, Songren Rd., Xinyi Dist., Taipei City', 12);
  assert.equal(a.verdict, 'FITS');
  assert.equal(a.evidence.code, 'P24');
  assert.deepEqual([a.evidence.cabin.width, a.evidence.cabin.depth, a.evidence.door], [2000, 1750, 1100]);
  assert.equal(a.evidence.counts.elevators, 12);
  const b = await run('No. 123, Songren Rd., Xinyi Dist., Taipei City', 12, 'KP-40');
  assert.equal(b.verdict, 'STRAIGHT-IN ONLY');
  assert.equal(b.evidence.code, 'P24');
  assert.ok(a.steps.every((s) => s.cached || s.skipped));
});

test('忠孝東路三段54號 4F: numeral expansion + license expansion → 4 elevators → SQUEEZE (MR)', async () => {
  const r = await run("No. 54, Sec. 3, Zhongxiao E. Rd., Da'an Dist., Taipei City", 4);
  assert.equal(r.verdict, 'SQUEEZE');
  assert.equal(r.building.en, 'Zhongxiao Technology Building');
  assert.equal(r.matchedQuery, '忠孝東路3段54號');
  assert.equal(r.evidence.counts.rows, 9);
  assert.equal(r.evidence.counts.elevators, 4);
  assert.equal(r.evidence.cabin.depth, 1030);
  assert.match(r.evidence.notes[0], /Machine-room \(MR\) variant/);
  assert.equal(r.steps[0].rows, 0);
});

test('振華街 3F: park lift excluded → NO ELEVATOR', async () => {
  const r = await run('Zhenhua St., Beitou Dist., Taipei City', 3);
  assert.equal(r.verdict, 'NO ELEVATOR');
  assert.match(r.reasons[0], /Zhenhua Park/);
});

test('承德路二段215號 7F: sideways link → STRONG candidate at 217, needs confirmation', async () => {
  const r = await run('No. 215, Sec. 2, Chengde Rd., Datong Dist., Taipei City', 7);
  assert.equal(r.verdict, 'NO ELEVATOR');
  assert.equal(r.needsConfirmation, true);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].strength, 'STRONG');
  assert.equal(r.candidates[0].building.en, 'MRT Plaza');
  assert.equal(r.candidates[0].address.en, 'No. 217, Sec. 2, Chengde Rd., Datong Dist., Taipei City');
  // confirming runs the direct query
  const c = await run(r.candidates[0].address.en, 7);
  assert.equal(c.verdict, 'STRAIGHT-IN ONLY');
  assert.equal(c.evidence.counts.elevators, 2);
});

test('承德路二段217號 7F direct hit, no chain', async () => {
  const r = await run('No. 217, Sec. 2, Chengde Rd., Datong Dist., Taipei City', 7);
  assert.equal(r.verdict, 'STRAIGHT-IN ONLY');
  assert.equal(r.steps[0].step, 'exact');
  assert.equal(r.steps[0].rows, 2);
});

test('floor not served → NO ELEVATOR with coverage', async () => {
  const r = await run('No. 217, Sec. 2, Chengde Rd., Datong Dist., Taipei City', 12);
  assert.equal(r.verdict, 'NO ELEVATOR');
  assert.match(r.reasons[0], /none serves floor 12F/);
});
