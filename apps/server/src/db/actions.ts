import type { Db } from './database.js';

export type ActionType = 'snapshot' | 'reboot' | 'factory_reset';

export interface ActionRow {
  id: number;
  mac: string;
  action: string;
  requested_at: string;
  finished_at: string | null;
  result: 'ok' | 'error' | null;
  error: string | null;
  error_code: string | null;
}

export function startAction(db: Db, mac: string, action: ActionType, requestedAt: string): number {
  const res = db.prepare('INSERT INTO action_log (mac, action, requested_at) VALUES (?, ?, ?)').run(mac, action, requestedAt);
  return Number(res.lastInsertRowid);
}

export function finishAction(
  db: Db,
  id: number,
  finishedAt: string,
  outcome: { result: 'ok' } | { result: 'error'; code: string; message: string },
): void {
  db.prepare('UPDATE action_log SET finished_at = ?, result = ?, error_code = ?, error = ? WHERE id = ?').run(
    finishedAt,
    outcome.result,
    outcome.result === 'error' ? outcome.code : null,
    outcome.result === 'error' ? outcome.message : null,
    id,
  );
}

export function listActions(db: Db, filter: { mac?: string; limit?: number } = {}): ActionRow[] {
  const limit = filter.limit ?? 500;
  return (
    filter.mac
      ? db.prepare('SELECT * FROM action_log WHERE mac = ? ORDER BY requested_at DESC, id DESC LIMIT ?').all(filter.mac, limit)
      : db.prepare('SELECT * FROM action_log ORDER BY requested_at DESC, id DESC LIMIT ?').all(limit)
  ) as ActionRow[];
}
