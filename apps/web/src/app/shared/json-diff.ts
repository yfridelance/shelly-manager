export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  /** e.g. "sys.device.name", "relays[0].ison", '["odd key"]'. Empty for the root. */
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

/**
 * Structural diff of two JSON values, down to the leaves. Objects are compared by key,
 * arrays by index. Returns the differences sorted by path.
 */
export function diffJson(before: unknown, after: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(before, after, '', out);
  return out.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
}

function walk(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const child = joinKey(path, key);
      if (!(key in b)) out.push({ path: child, kind: 'removed', before: a[key] });
      else if (!(key in a)) out.push({ path: child, kind: 'added', after: b[key] });
      else walk(a[key], b[key], child, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const child = `${path}[${i}]`;
      if (i >= b.length) out.push({ path: child, kind: 'removed', before: a[i] });
      else if (i >= a.length) out.push({ path: child, kind: 'added', after: b[i] });
      else walk(a[i], b[i], child, out);
    }
    return;
  }
  if (!sameJson(a, b)) out.push({ path, kind: 'changed', before: a, after: b });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function joinKey(path: string, key: string): string {
  // Shelly component keys like "switch:0" read fine with dots.
  if (/^[A-Za-z_$][\w$:-]*$/.test(key)) return path ? `${path}.${key}` : key;
  return `${path}[${JSON.stringify(key)}]`;
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Compact display of a value in a diff cell. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}
