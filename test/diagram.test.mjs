import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, renderCabinDiagram, BOX } from '../src/diagram.mjs';

const P24 = { cabinWidth: 2000, cabinDepth: 1750, doorWidth: 1100 };
const P8 = { cabinWidth: 1400, cabinDepth: 1030, doorWidth: 800 };
const LEON = { chairLength: 1060, chairWidth: 620 };

test('layout is deterministic and to scale', () => {
  const a = layout({ ...P24, ...LEON, verdict: 'FITS' });
  const b = layout({ ...P24, ...LEON, verdict: 'FITS' });
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.cabin.w / a.cabin.h - 2000 / 1750) < 0.01);
  assert.ok(Math.abs(a.chair.h / a.chair.w - 1060 / 620) < 0.02);
  assert.ok(a.turn, 'FITS draws the turning circle');
  // chair inside the cabin
  assert.ok(a.chair.y >= a.cabin.y && a.chair.y + a.chair.h <= a.cabin.y + a.cabin.h);
});

test('SQUEEZE: tail crosses the sill by the real overhang', () => {
  const l = layout({ ...P8, ...LEON, verdict: 'SQUEEZE' });
  assert.equal(l.overhangMm, 30);
  assert.ok(l.chair.y + l.chair.h > l.sill.y, 'chair tail is below the sill line');
  assert.equal(l.turn, null);
  assert.match(renderCabinDiagram({ ...P8, ...LEON, verdict: 'SQUEEZE' }), /30 mm over the sill/);
});

test("CAN'T ENTER: chair outside, dashed frame; NO ELEVATOR: no diagram", () => {
  const l = layout({ ...P8, chairLength: 1000, chairWidth: 800, verdict: 'CANT_ENTER' });
  assert.ok(l.chair.y > l.sill.y);
  assert.match(renderCabinDiagram({ ...P8, chairLength: 1000, chairWidth: 800, verdict: 'CANT_ENTER' }), /stroke-dasharray="6 5"/);
  assert.equal(renderCabinDiagram({ ...P8, ...LEON, verdict: 'NO_ELEVATOR' }), '');
});

test('svg has fixed width/height and fits the box', () => {
  for (const v of ['FITS', 'STRAIGHT_IN', 'SQUEEZE', 'CANT_ENTER']) {
    const svg = renderCabinDiagram({ ...P24, ...LEON, verdict: v });
    assert.match(svg, new RegExp(`width="${BOX.w}" height="${BOX.h}"`));
    const l = layout({ ...P24, ...LEON, verdict: v });
    assert.ok(l.chair.y + l.chair.h <= BOX.h && l.chair.x >= 0 && l.chair.x + l.chair.w <= BOX.w);
  }
});
