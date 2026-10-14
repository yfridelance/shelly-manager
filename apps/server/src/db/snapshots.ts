import type { Db } from './database.js';

export interface SnapshotInput {
  mac: string;
  takenAt: string;
  /** Raw device answers, stored unchanged as JSON. */
  info: unknown;
  config: unknown;
  status: unknown;
}

export function insertSnapshot(db: Db, s: SnapshotInput): number {
  const result = db
    .prepare(
      'INSERT INTO config_snapshots (mac, taken_at, info_json, config_json, status_json) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      s.mac,
      s.takenAt,
      JSON.stringify(s.info),
      s.config === undefined ? null : JSON.stringify(s.config),
      s.status === undefined ? null : JSON.stringify(s.status),
    );
  return Number(result.lastInsertRowid);
}
