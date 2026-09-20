// JIS A 4301 standard cabin dimensions by capacity class (mm), compiled from public manufacturer
// catalogs (Mitsubishi MR series; cross-checked with Fujitec). The registry spec code (P24, B27 ...)
// gives the rated persons, which is the same convention across Mitsubishi / Hitachi-Yungtay / Otis,
// so one table covers the registry. Values are REFERENCE ESTIMATES: door width and car geometry
// still vary by vendor, and the registry never says machine-room (MR) vs machine-room-less (MRL).
// For small cars the two differ a lot (Mitsubishi P8: MR 1400x1030, MRL 1100x1300).
export const JIS_TABLE = {
  6:  { width: 1400, depth: 850,  door: 800 },
  8:  { width: 1400, depth: 1030, door: 800,  mrl: { width: 1100, depth: 1300 } },
  9:  { width: 1400, depth: 1100, door: 800 },
  10: { width: 1400, depth: 1250, door: 800 },
  11: { width: 1400, depth: 1350, door: 800 },
  12: { width: 1400, depth: 1400, door: 800 },
  13: { width: 1600, depth: 1350, door: 900 },
  15: { width: 1600, depth: 1500, door: 900 },
  17: { width: 2000, depth: 1350, door: 1100 },
  20: { width: 2000, depth: 1500, door: 1100 },
  24: { width: 2000, depth: 1750, door: 1100 },
};

/** Nearest class at or below the rated persons (P30 / B27 fall back to the largest known class). */
export function lookupCabin(persons) {
  const keys = Object.keys(JIS_TABLE).map(Number).sort((a, b) => a - b);
  let best = null;
  for (const k of keys) if (k <= persons) best = k;
  if (best == null) best = keys[0];
  const exact = best === persons;
  return { ...JIS_TABLE[best], classPersons: best, exact, source: 'JIS A 4301 (reference estimate)' };
}
