// Karma official wheelchair specs (mm). Custom L/W/R inputs are allowed too.
export const CHAIR_PRESETS = {
  'Leon':   { length: 1060, width: 620, turnRadius: 800 },
  'KP-40':  { length: 1180, width: 665, turnRadius: 900 },
  'KP-80':  { length: 1205, width: 640, turnRadius: 745 },
  'eFlexx': { length: 1085, width: 565, turnRadius: 740 },
  'EVO':    { length: 1200, width: 660, turnRadius: 750 },
};
export const CHAIR_NAMES = Object.keys(CHAIR_PRESETS);
