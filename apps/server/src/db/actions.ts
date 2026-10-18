import type { Db } from './database.js';

export type ActionType = 'snapshot' | 'reboot' | 'factory_reset' | 'firmware_update' | 'apply_template' | 'rename';

export interface ActionRow {
  id: number;
  mac: string;
  action: string;
  requested_at: string;
  requested_by: string | null;
  finished_at: string | null;
  result: 'ok' | 'error' | null;
  error: string | null;
  error_code: string | null;
  details: string | null;
  site_id: number | null;
}

export interface ActionListRow extends ActionRow {
  device_name: string | null;
}

export function startAction(db: Db, mac: string, action: ActionType, requestedAt: string, requestedBy?: string): number {
  // The site at the time of the action; the device may move later.
  const res = db
    .prepare(
      `INSERT INTO action_log (mac, action, requested_at, requested_by, site_id)
       VALUES (?, ?, ?, ?, (SELECT site_id FROM devices WHERE mac = ?))`,
    )
    .run(mac, action, requestedAt, requestedBy ?? null, mac);
  return Number(res.lastInsertRowid);
}

export function finishAction(
  db: Db,
  id: number,
  finishedAt: string,
  outcome: { result: 'ok' } | { result: 'error'; code: string; message: string },
  details?: Record<string, unknown>,
): void {
  db.prepare('UPDATE action_log SET finished_at = ?, result = ?, error_code = ?, error = ?, details = ? WHERE id = ?').run(
    finishedAt,
    outcome.result,
    outcome.result === 'error' ? outcome.code : null,
    outcome.result === 'error' ? outcome.message : null,
    details && Object.keys(details).length > 0 ? JSON.stringify(details) : null,
    id,
  );
}

/**
 * Newest first by completion time: a factory reset starts before its automatic snapshot but finishes
 * after it, so the reset is listed above its snapshot. On ties the action that started first wins.
 */
export function listActions(db: Db, filter: { mac?: string; siteId?: number; limit?: number } = {}): ActionListRow[] {
  const limit = filter.limit ?? 500;
  const order = 'ORDER BY COALESCE(a.finished_at, a.requested_at) DESC, a.requested_at ASC, a.id ASC';
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.mac) {
    where.push('a.mac = ?');
    args.push(filter.mac);
  }
  if (filter.siteId !== undefined) {
    where.push('a.site_id = ?');
    args.push(filter.siteId);
  }
  const sql = `SELECT a.*, COALESCE(d.name, d.device_name) AS device_name
               FROM action_log a LEFT JOIN devices d ON d.mac = a.mac
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${order} LIMIT ?`;
  return db.prepare(sql).all(...args, limit) as ActionListRow[];
}
