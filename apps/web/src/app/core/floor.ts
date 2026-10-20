// Building order of floors («Stockwerk»): basements, ground floor, upper floors, attic.
// Same rules as apps/server/src/devices/floor.ts (keep both in sync).

const BASEMENT = /^(?:untergeschoss|keller|ug|kg)$/;
const GROUND = /^(?:eg|erdgeschoss|parterre|hochparterre|ground(?: floor| level)?|gf)$/;
const UPPER = /^(?:og|obergeschoss)$/;
const ATTIC = /^(?:dg|dachgeschoss|estrich|dachboden|attic|loft)$/;
const ATTIC_RANK = 1000;

// English: "1st floor"/"first floor", "floor 2"/"level 2", "2F", "L2"; "basement 2"/"2nd basement", "B2".
// Ordinals map 1:1 to the rank, so British ("ground floor", "1st floor") and American ("1st floor" = ground
// floor, "2nd floor") numbering both keep their own order; only mixing both conventions would be off by one.
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ORDINAL = `(?:(\\d{1,2})(?:st|nd|rd|th)|(${ORDINAL_WORDS.join('|')}))`;
const LEVEL = '(?:floor|storey|story|level)';
const EN_LOWER_GROUND = /^(?:lower ground(?: floor| level)?|lg|lgf)$/;
const EN_UPPER = [new RegExp(`^${ORDINAL} ${LEVEL}$`), new RegExp(`^${LEVEL} (\\d{1,2})$`), /^(\d{1,2}) ?f$/, /^l ?(\d{1,2})$/];
const EN_BASEMENT = [
  new RegExp(`^(?:${ORDINAL} )?(?:basement|cellar)$`),
  /^(?:basement|cellar) (\d{1,2})$/,
  /^b ?(\d{1,2})$/,
];

/**
 * Position of a floor in the building, or undefined for names without a known order:
 * "2. UG"/"B2" -2, "UG"/"KG"/"Keller"/"basement" -1, "lower ground" -0.5, "EG"/"ground floor" 0,
 * "OG"/"1. OG"/"1st floor" 1, "2. OG"/"OG2"/"floor 2"/"2F" 2, …, "DG"/"attic" last.
 */
export function floorRank(floor: string | null | undefined): number | undefined {
  const f = (floor ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!f) return undefined;
  if (GROUND.test(f)) return 0;
  if (ATTIC.test(f)) return ATTIC_RANK;
  if (EN_LOWER_GROUND.test(f)) return -0.5;
  // "2. OG", "2.OG", "2 OG", "OG 2", "OG2", "2. Obergeschoss", "1. UG"
  const m = /^(?:(\d{1,2})\s*\.?\s*)?([a-z]+)(?:\s*\.?\s*(\d{1,2}))?$/.exec(f);
  if (m && !(m[1] && m[3])) {
    const n = Number(m[1] ?? m[3] ?? 1);
    if (UPPER.test(m[2] ?? '')) return n;
    if (BASEMENT.test(m[2] ?? '')) return -n;
  }
  const upper = englishNumber(f, EN_UPPER);
  if (upper !== undefined) return upper;
  const basement = englishNumber(f, EN_BASEMENT);
  return basement ? -basement : undefined;
}

/** Number from the first matching pattern: digits or an ordinal word, 1 if the pattern has none. */
function englishNumber(f: string, patterns: RegExp[]): number | undefined {
  for (const p of patterns) {
    const m = p.exec(f);
    if (!m) continue;
    const word = m.slice(1).find((g) => g !== undefined);
    if (word === undefined) return 1;
    return /^\d/.test(word) ? Number(word) : ORDINAL_WORDS.indexOf(word) + 1;
  }
  return undefined;
}

/** Floors in building order; unknown names after the known ones, alphabetically; empty last. */
export function compareFloor(a: string | null | undefined, b: string | null | undefined, compareText: (a: string, b: string) => number): number {
  const ea = !a?.trim();
  const eb = !b?.trim();
  if (ea || eb) return Number(ea) - Number(eb);
  const ra = floorRank(a);
  const rb = floorRank(b);
  if (ra !== undefined && rb !== undefined) return ra - rb || compareText(a ?? '', b ?? '');
  if (ra !== undefined) return -1;
  if (rb !== undefined) return 1;
  return compareText(a ?? '', b ?? '');
}
