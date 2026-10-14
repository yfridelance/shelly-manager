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

export interface SnapshotRow {
  id: number;
  mac: string;
  taken_at: string;
  info_json: string;
  config_json: string | null;
  status_json: string | null;
}

export interface SnapshotMeta {
  id: number;
  taken_at: string;
  has_config: number;
}

/** Newest first. */
export function listSnapshotMeta(db: Db, mac: string, limit = 100): SnapshotMeta[] {
  return db
    .prepare(
      `SELECT id, taken_at, config_json IS NOT NULL AS has_config
       FROM config_snapshots WHERE mac = ? ORDER BY taken_at DESC, id DESC LIMIT ?`,
    )
    .all(mac, limit) as SnapshotMeta[];
}

export function getSnapshot(db: Db, mac: string, id: number): SnapshotRow | undefined {
  return db.prepare('SELECT * FROM config_snapshots WHERE mac = ? AND id = ?').get(mac, id) as SnapshotRow | undefined;
}

export function getLatestSnapshot(db: Db, mac: string): SnapshotRow | undefined {
  return db
    .prepare('SELECT * FROM config_snapshots WHERE mac = ? ORDER BY taken_at DESC, id DESC LIMIT 1')
    .get(mac) as SnapshotRow | undefined;
}
