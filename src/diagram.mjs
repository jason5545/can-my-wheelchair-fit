// Cabin top-view diagram: TO-SCALE geometry from plain numbers, rendered as inline SVG.
// layout() is pure (same numbers in → same coordinates out) so it is unit-testable;
// renderCabinDiagram() turns the layout into an SVG string with FIXED width/height (no reflow).
// Drawing is arithmetic here: the chair is a grey rounded rectangle + rear-wheel strips + front casters + a seat.

export const BOX = { w: 300, h: 260 };   // px, fixed
const PAD = 26;                            // px around the drawing (numbers, sill labels)
const COLORS = {
  FITS: '#1f8a4c', STRAIGHT_IN: '#c98a00', SQUEEZE: '#d9480f', CANT_ENTER: '#b3261e', NO_ELEVATOR: '#5b6470',
};

/**
 * Pure layout. All inputs in mm; outputs in px inside a BOX.w × BOX.h frame.
 * The door is a gap centred on the bottom edge; the chair's long side runs along the cabin depth
 * (it enters through the door). Verdict picks where the chair is drawn:
 *   FITS / STRAIGHT_IN → inside, centred; SQUEEZE → pushed in through the door, tail over the sill;
 *   CANT_ENTER → outside, below the door.
 */
export function layout({ cabinWidth, cabinDepth, doorWidth, chairLength, chairWidth, verdict }) {
  const innerW = BOX.w - 2 * PAD, innerH = BOX.h - 2 * PAD;
  // Reserve room below the cabin for a chair standing outside (CAN'T ENTER) and for the sill overhang.
  const outsideMm = verdict === 'CANT_ENTER' ? chairLength + 100 : verdict === 'SQUEEZE' ? Math.max(0, chairLength - cabinDepth) + 60 : 60;
  const scale = Math.min(innerW / Math.max(cabinWidth, chairWidth, 1), innerH / Math.max(cabinDepth + outsideMm, 1));
  const px = (mm) => Math.round(mm * scale * 100) / 100;
  const cabW = px(cabinWidth), cabD = px(cabinDepth);
  const x0 = Math.round((BOX.w - cabW) / 2 * 100) / 100;
  const y0 = PAD;
  const y1 = y0 + cabD;                       // sill line (bottom edge, where the door is)
  const doorW = px(doorWidth);
  const doorX = x0 + (cabW - doorW) / 2;
  const chW = px(chairWidth), chL = px(chairLength);
  const chX = x0 + (cabW - chW) / 2;          // centred on the door
  let chY;
  if (verdict === 'CANT_ENTER') chY = y1 + px(60);
  else if (verdict === 'SQUEEZE') chY = y1 - cabD;  // nose at the back wall, tail over the sill
  else chY = y0 + (cabD - chL) / 2;                 // centred inside
  const overhang = verdict === 'SQUEEZE' ? Math.round((chairLength - cabinDepth) * 100) / 100 : 0;
  const turn = verdict === 'FITS' ? { cx: x0 + cabW / 2, cy: y0 + cabD / 2, r: Math.min(cabW, cabD) / 2 - 2 } : null;
  return {
    scale, cabin: { x: x0, y: y0, w: cabW, h: cabD }, sill: { x1: x0, x2: x0 + cabW, y: y1 },
    door: { x: doorX, w: doorW, y: y1 },
    chair: {
      x: chX, y: chY, w: chW, h: chL,
      // top view: rear wheels are thin strips along the sides, casters are small blocks at the front (top)
      wheelW: Math.max(2, px(60)), wheelL: chL * 0.45, wheelY: chY + chL * 0.42,
      casterW: Math.max(2, px(50)), casterL: Math.max(3, px(150)), casterY: chY + chL * 0.06,
      seat: { x: chX + chW * 0.18, y: chY + chL * 0.3, w: chW * 0.64, h: chL * 0.42 },
    },
    overhangMm: overhang, turn, color: COLORS[verdict] ?? COLORS.NO_ELEVATOR, verdict,
  };
}

export function renderCabinDiagram(input) {
  if (input.verdict === 'NO_ELEVATOR') return '';
  const L = layout(input);
  const c = L.color;
  const { cabin, door, chair, sill } = L;
  const dashed = L.verdict === 'CANT_ENTER';
  const outline = `M${cabin.x},${cabin.y + cabin.h} L${cabin.x},${cabin.y} L${cabin.x + cabin.w},${cabin.y} L${cabin.x + cabin.w},${cabin.y + cabin.h} L${door.x + door.w},${door.y} M${door.x},${door.y} L${cabin.x},${cabin.y + cabin.h}`;
  const arc = L.turn ? `<circle cx="${L.turn.cx}" cy="${L.turn.cy}" r="${L.turn.r}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="5 4" opacity=".7"/>
    <path d="M${L.turn.cx + L.turn.r - 6},${L.turn.cy - 8} l6,8 l-8,5" fill="none" stroke="${c}" stroke-width="1.5"/>` : '';
  const sillLine = `<line x1="${sill.x1 - 8}" y1="${sill.y}" x2="${sill.x2 + 8}" y2="${sill.y}" stroke="#1b1f24" stroke-width="1" stroke-dasharray="2 3" opacity=".8"/>`;
  const caption = L.verdict === 'SQUEEZE'
    ? `cabin depth ${input.cabinDepth} < chair ${input.chairLength} — ${L.overhangMm} mm over the sill`
    : L.verdict === 'CANT_ENTER' ? `door ${input.doorWidth} < chair ${input.chairWidth} + 50 — cannot enter`
    : L.verdict === 'STRAIGHT_IN' ? `fits ${input.cabinWidth}×${input.cabinDepth}, no room to turn`
    : `fits ${input.cabinWidth}×${input.cabinDepth} and can turn`;
  return `<svg class="cabin-diagram" width="${BOX.w}" height="${BOX.h}" viewBox="0 0 ${BOX.w} ${BOX.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${caption}">
  <rect x="${cabin.x}" y="${cabin.y}" width="${cabin.w}" height="${cabin.h}" fill="${c}" opacity="${dashed ? 0.06 : 0.12}"/>
  <path d="${outline}" fill="none" stroke="${c}" stroke-width="3" ${dashed ? 'stroke-dasharray="6 5"' : ''}/>
  ${sillLine}
  ${arc}
  <g class="chair">
    <rect x="${chair.x}" y="${chair.y}" width="${chair.w}" height="${chair.h}" rx="${Math.min(8, chair.w / 4)}" fill="#8a919c" stroke="#3a3f47" stroke-width="1.5"/>
    <rect x="${chair.seat.x}" y="${chair.seat.y}" width="${chair.seat.w}" height="${chair.seat.h}" rx="3" fill="#cfd4db" stroke="#3a3f47" stroke-width="1"/>
    <rect x="${chair.x - chair.wheelW * 0.35}" y="${chair.wheelY}" width="${chair.wheelW}" height="${chair.wheelL}" rx="1.5" fill="#2b2f36"/>
    <rect x="${chair.x + chair.w - chair.wheelW * 0.65}" y="${chair.wheelY}" width="${chair.wheelW}" height="${chair.wheelL}" rx="1.5" fill="#2b2f36"/>
    <rect x="${chair.x + chair.w * 0.12}" y="${chair.casterY}" width="${chair.casterW}" height="${chair.casterL}" rx="1" fill="#2b2f36"/>
    <rect x="${chair.x + chair.w * 0.88 - chair.casterW}" y="${chair.casterY}" width="${chair.casterW}" height="${chair.casterL}" rx="1" fill="#2b2f36"/>
  </g>
  <text x="${cabin.x + cabin.w / 2}" y="${cabin.y - 8}" text-anchor="middle" font-size="11" fill="#5b6470">${input.cabinWidth} mm</text>
  <text x="${cabin.x - 6}" y="${cabin.y + cabin.h / 2}" text-anchor="end" font-size="11" fill="#5b6470" transform="rotate(-90 ${cabin.x - 6} ${cabin.y + cabin.h / 2})">${input.cabinDepth} mm</text>
  <text x="${door.x - 4}" y="${door.y + 12}" text-anchor="end" font-size="10" fill="${c}">door ${input.doorWidth}</text>
  <text x="${BOX.w / 2}" y="${BOX.h - 6}" text-anchor="middle" font-size="11" fill="#1b1f24">${caption}</text>
</svg>`;
}

/**
 * Street strip for the sideways-link candidate card: same-parity house numbers around the queried one.
 * nearby: [{ number, devices, elevators, names }] from the registry; queried: the number typed;
 * candidates: numbers that hold the candidate elevators. Fixed size, pure inline SVG.
 */
export const MAP_BOX = { w: 560, h: 120 };
export function renderStreetMap({ queried, candidates = [], nearby = [], streetEn = '' }) {
  const nums = new Set([queried, ...candidates, ...nearby.map((n) => n.number)]);
  for (let d = -4; d <= 4; d += 2) nums.add(queried + d);
  const list = [...nums].filter((n) => n > 0 && Math.abs(n - queried) <= 6).sort((a, b) => a - b);
  const by = Object.fromEntries(nearby.map((n) => [n.number, n]));
  const slotW = Math.min(96, Math.floor((MAP_BOX.w - 20) / list.length));
  const x0 = (MAP_BOX.w - slotW * list.length) / 2;
  const boxes = list.map((n, i) => {
    const x = x0 + i * slotW + 6, w = slotW - 12, y = 30, h = 52;
    const info = by[n];
    const isQ = n === queried, isC = candidates.includes(n);
    const fill = isC ? '#1f8a4c' : isQ ? '#5b6470' : info ? '#dfe3e8' : 'none';
    const stroke = isC ? '#1f8a4c' : isQ ? '#5b6470' : '#b9c0c8';
    const dash = info ? '' : 'stroke-dasharray="4 3"';
    const txt = isC || isQ ? '#fff' : '#1b1f24';
    const line2 = isC ? `${info?.elevators ?? candidates.length} elevator${(info?.elevators ?? 1) === 1 ? '' : 's'}` : isQ ? `${info?.devices ?? 0} parking` : info ? `${info.elevators} elev / ${info.devices} dev` : 'no record';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="2" ${dash}/>
      <text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" font-size="15" font-weight="700" fill="${txt}">No. ${n}</text>
      <text x="${x + w / 2}" y="${y + 40}" text-anchor="middle" font-size="10.5" fill="${txt}">${line2}</text>`;
  }).join('');
  const qi = list.indexOf(queried), ci = candidates.length ? list.indexOf(candidates[0]) : -1;
  const link = qi >= 0 && ci >= 0 ? (() => {
    const xa = x0 + qi * slotW + slotW / 2, xb = x0 + ci * slotW + slotW / 2;
    return `<path d="M${xa},${100} C${xa},${118} ${xb},${118} ${xb},${100}" fill="none" stroke="#1f8a4c" stroke-width="2" stroke-dasharray="5 4"/>
      <text x="${(xa + xb) / 2}" y="${116}" text-anchor="middle" font-size="10.5" fill="#1f8a4c" style="paint-order:stroke" stroke="#fff" stroke-width="3">same occupancy permit</text>`;
  })() : '';
  return `<svg class="street-map" width="${MAP_BOX.w}" height="${MAP_BOX.h}" viewBox="0 0 ${MAP_BOX.w} ${MAP_BOX.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="street map of nearby house numbers">
  <text x="${MAP_BOX.w / 2}" y="16" text-anchor="middle" font-size="12" fill="#5b6470">${streetEn ? streetEn + ' — ' : ''}same side of the street (${queried % 2 ? 'odd' : 'even'} numbers), registry records</text>
  <line x1="10" y1="92" x2="${MAP_BOX.w - 10}" y2="92" stroke="#b9c0c8" stroke-width="3"/>
  ${boxes}${link}
</svg>`;
}
