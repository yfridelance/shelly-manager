import type { Db } from './database.js';

export const DEFAULT_SITE_ID = 1;

export interface Site {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  deviceCount: number;
  templateCount: number;
}

interface SiteRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  device_count: number;
  template_count: number;
}

export class SiteError extends Error {
  constructor(
    readonly code: 'name_taken' | 'site_not_empty' | 'last_site',
    message: string,
  ) {
    super(message);
  }
}

const SELECT = `
  SELECT s.*,
         (SELECT COUNT(*) FROM devices d WHERE d.site_id = s.id) AS device_count,
         (SELECT COUNT(*) FROM templates t WHERE t.site_id = s.id) AS template_count
  FROM sites s`;

const toSite = (r: SiteRow): Site => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdAt: r.created_at,
  deviceCount: r.device_count,
  templateCount: r.template_count,
});

export function listSites(db: Db): Site[] {
  return (db.prepare(`${SELECT} ORDER BY s.name COLLATE NOCASE`).all() as SiteRow[]).map(toSite);
}

export function getSite(db: Db, id: number): Site | undefined {
  const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as SiteRow | undefined;
  return row ? toSite(row) : undefined;
}

function unique<T>(name: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: sites.name/.test(err.message)) {
      throw new SiteError('name_taken', `Site name "${name}" is already used`);
    }
    throw err;
  }
}

export function createSite(db: Db, s: { name: string; description: string | null }, now: string): Site {
  return unique(s.name, () => {
    const res = db.prepare('INSERT INTO sites (name, description, created_at) VALUES (?, ?, ?)').run(s.name, s.description, now);
    return getSite(db, Number(res.lastInsertRowid)) as Site;
  });
}

export function updateSite(db: Db, id: number, s: { name: string; description: string | null }): Site | undefined {
  return unique(s.name, () => {
    const res = db.prepare('UPDATE sites SET name = ?, description = ? WHERE id = ?').run(s.name, s.description, id);
    return res.changes > 0 ? getSite(db, id) : undefined;
  });
}

/** Only empty sites can be deleted (devices and templates are documentation), and never the last one. */
export function deleteSite(db: Db, id: number): boolean {
  return db.transaction(() => {
    const site = getSite(db, id);
    if (!site) return false;
    if (site.deviceCount > 0 || site.templateCount > 0) {
      throw new SiteError('site_not_empty', `Site ${id} still has devices or templates`);
    }
    const count = db.prepare('SELECT COUNT(*) FROM sites').pluck().get() as number;
    if (count <= 1) throw new SiteError('last_site', 'The last site cannot be deleted');
    db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    return true;
  })();
}
