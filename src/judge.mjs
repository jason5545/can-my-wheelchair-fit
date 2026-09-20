// Chair vs cabin judgment. Pure functions; shared by the server and the browser.
import { lookupCabin } from './dimensions.mjs';

export const VERDICTS = {
  FITS: { key: 'FITS', label: 'FITS', icon: '✅', rank: 0 },
  STRAIGHT_IN: { key: 'STRAIGHT_IN', label: 'STRAIGHT-IN ONLY', icon: '⚠️', rank: 1 },
  SQUEEZE: { key: 'SQUEEZE', label: 'SQUEEZE', icon: '⚠️❌', rank: 2 },
  CANT_ENTER: { key: 'CANT_ENTER', label: "CAN'T ENTER", icon: '❌', rank: 3 },
  NO_ELEVATOR: { key: 'NO_ELEVATOR', label: 'NO ELEVATOR', icon: '❌', rank: 4 },
};

const DOOR_CLEARANCE = 50; // mm of slack needed either side of the chair

/**
 * Evaluate top to bottom; the first state that matches is the verdict.
 * cabin: { width, depth, door }, chair: { length, width, turnRadius }
 */
export function judgeCabin(cabin, chair) {
  const reasons = [];
  const shortSide = Math.min(cabin.width, cabin.depth);
  const turningCircle = 2 * chair.turnRadius;
  if (cabin.door < chair.width + DOOR_CLEARANCE) {
    reasons.push(`Door ${cabin.door} mm < your chair width ${chair.width} mm + ${DOOR_CLEARANCE} mm clearance — the chair cannot get through the door.`);
    return { ...VERDICTS.CANT_ENTER, reasons };
  }
  reasons.push(`Door ${cabin.door} mm ≥ chair width ${chair.width} mm + ${DOOR_CLEARANCE} mm — the chair gets through the door.`);
  if (cabin.depth < chair.length) {
    reasons.push(`Cabin depth ${cabin.depth} mm < your chair length ${chair.length} mm — ${chair.length - cabin.depth} mm short, footrests must come off.`);
    return { ...VERDICTS.SQUEEZE, reasons };
  }
  reasons.push(`Cabin depth ${cabin.depth} mm ≥ chair length ${chair.length} mm — the chair fits inside.`);
  if (shortSide < turningCircle) {
    reasons.push(`Cabin short side ${shortSide} mm < turning circle ${turningCircle} mm (2 × radius ${chair.turnRadius}, reference) — you ride in and back out.`);
    return { ...VERDICTS.STRAIGHT_IN, reasons };
  }
  reasons.push(`Cabin short side ${shortSide} mm ≥ turning circle ${turningCircle} mm (2 × radius ${chair.turnRadius}, reference) — you can turn around inside.`);
  return { ...VERDICTS.FITS, reasons };
}

/** Cabin geometry for a parsed spec, with the MR/MRL note. licenseYear is the ROC year of the 使用執照. */
export function cabinForSpec(spec, { licenseYear } = {}) {
  const c = lookupCabin(spec.persons);
  const notes = [];
  if (!c.exact) notes.push(`No JIS row for ${spec.code}; using the ${c.classPersons}-person class as the nearest reference.`);
  if (c.mrl) {
    // First machine-room-less elevator shipped 1996 (Taiwan ~1999 = ROC 88): older permits are MR for sure.
    if (licenseYear && licenseYear < 88) notes.push(`Machine-room (MR) variant: the building permit is from ROC ${licenseYear} (${licenseYear + 1911}), before machine-room-less cars existed.`);
    else notes.push(`Assuming the machine-room (MR) variant ${c.width}×${c.depth}; the registry does not say. MRL would be ${c.mrl.width}×${c.mrl.depth}.`);
  }
  return { width: c.width, depth: c.depth, door: c.door, source: c.source, classPersons: c.classPersons, notes };
}

/**
 * Rank the elevators that serve the floor for this chair: best verdict first; among equal verdicts
 * the roomiest car (largest short side, then area) so the card stays on the same elevator when the
 * chair changes. Returns [{ elevator, verdict }].
 */
export function judgeBuilding(elevators, chair) {
  const judged = elevators.map((e) => ({ elevator: e, verdict: judgeCabin(e.cabin, chair) }));
  const short = (e) => Math.min(e.cabin.width, e.cabin.depth);
  const area = (e) => e.cabin.width * e.cabin.depth;
  judged.sort((a, b) => a.verdict.rank - b.verdict.rank || short(b.elevator) - short(a.elevator) || area(b.elevator) - area(a.elevator));
  return judged;
}
