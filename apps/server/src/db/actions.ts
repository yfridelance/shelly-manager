import type { Db } from './database.js';

export type ActionType = 'snapshot' | 'reboot' | 'factory_reset' | 'firmware_update' | 'apply_template';

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
}

export interface ActionListRow extends ActionRow {
  device_name: string | null;
}

export function startAction(db: Db, mac: string, action: ActionType, requestedAt: string, requestedBy?: string): number {
  const res = db
    .prepare('INSERT INTO action_log (mac, action, requested_at, requested_by) VALUES (?, ?, ?, ?)')
    .run(mac, action, requestedAt, requestedBy ?? null);
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
export function listActions(db: Db, filter: { mac?: string; limit?: number } = {}): ActionListRow[] {
  const limit = filter.limit ?? 500;
  const order = 'ORDER BY COALESCE(a.finished_at, a.requested_at) DESC, a.requested_at ASC, a.id ASC';
  const base = `SELECT a.*, COALESCE(d.name, d.device_name) AS device_name
                FROM action_log a LEFT JOIN devices d ON d.mac = a.mac`;
  return (
    filter.mac
      ? db.prepare(`${base} WHERE a.mac = ? ${order} LIMIT ?`).all(filter.mac, limit)
      : db.prepare(`${base} ${order} LIMIT ?`).all(limit)
  ) as ActionListRow[];
}
