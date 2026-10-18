// Building order of floors («Stockwerk»): basements, ground floor, upper floors, attic.
// Same rules as apps/server/src/devices/floor.ts (keep both in sync).

const BASEMENT = /^(?:untergeschoss|keller|ug|kg)$/;
const GROUND = /^(?:eg|erdgeschoss|parterre|hochparterre)$/;
const UPPER = /^(?:og|obergeschoss)$/;
const ATTIC = /^(?:dg|dachgeschoss|estrich|dachboden)$/;
const ATTIC_RANK = 1000;

/**
 * Position of a floor in the building, or undefined for names without a known order:
 * "2. UG" -2, "UG"/"KG"/"Keller" -1, "EG" 0, "OG"/"1. OG" 1, "2. OG"/"OG2" 2, …, "DG" last.
 */
export function floorRank(floor: string | null | undefined): number | undefined {
  const f = (floor ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!f) return undefined;
  if (GROUND.test(f)) return 0;
  if (ATTIC.test(f)) return ATTIC_RANK;
  // "2. OG", "2.OG", "2 OG", "OG 2", "OG2", "2. Obergeschoss", "1. UG"
  const m = /^(?:(\d{1,2})\s*\.?\s*)?([a-z]+)(?:\s*\.?\s*(\d{1,2}))?$/.exec(f);
  if (!m || (m[1] && m[3])) return undefined;
  const n = Number(m[1] ?? m[3] ?? 1);
  if (UPPER.test(m[2] ?? '')) return n;
  if (BASEMENT.test(m[2] ?? '')) return -n;
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

/** Suggested in the floor field next to the floors already used in the site. */
export const COMMON_FLOORS = ['UG', 'EG', 'OG', 'DG'];
