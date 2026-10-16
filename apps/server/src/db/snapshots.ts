import type { Db } from './database.js';

export interface SnapshotInput {
  mac: string;
  takenAt: string;
  /** Raw device answers, stored unchanged as JSON. */
  info: unknown;
  config: unknown;
  status: unknown;
}

/**
 * Gen1 `/settings` carries the device clock (`time`, `unixtime`), which changes on every read.
 * Only for comparing snapshots; the stored config stays raw.
 */
const VOLATILE_GEN1_CONFIG_KEYS = ['time', 'unixtime'];

/** Gen1 is recognised like in detection: its `/shelly` answer has no `gen` field. */
const isGen1Info = (info: unknown): boolean => typeof info === 'object' && info !== null && !('gen' in info);

function comparableConfig(info: unknown, config: unknown): string | null {
  if (config === undefined || config === null) return null;
  if (isGen1Info(info) && typeof config === 'object' && !Array.isArray(config)) {
    const copy: Record<string, unknown> = { ...(config as Record<string, unknown>) };
    for (const key of VOLATILE_GEN1_CONFIG_KEYS) delete copy[key];
    return JSON.stringify(copy);
  }
  return JSON.stringify(config);
}

/**
 * Stores what the device answered. If info and config equal the device's newest snapshot, no row
 * is added: that row gets the new status and `confirmed_at`, and its id is returned. Callers that
 * record the id as "config saved before" stay correct, because the config is the same.
 */
export function insertSnapshot(db: Db, s: SnapshotInput): number {
  const infoJson = JSON.stringify(s.info);
  const statusJson = s.status === undefined ? null : JSON.stringify(s.status);
  const latest = getLatestSnapshot(db, s.mac);
  if (
    latest &&
    latest.info_json === infoJson &&
    comparableConfig(JSON.parse(latest.info_json), latest.config_json === null ? undefined : JSON.parse(latest.config_json)) ===
      comparableConfig(s.info, s.config)
  ) {
    db.prepare('UPDATE config_snapshots SET status_json = ?, confirmed_at = ? WHERE id = ?').run(statusJson, s.takenAt, latest.id);
    return latest.id;
  }
  const result = db
    .prepare(
      'INSERT INTO config_snapshots (mac, taken_at, info_json, config_json, status_json) VALUES (?, ?, ?, ?, ?)',
    )
    .run(s.mac, s.takenAt, infoJson, s.config === undefined ? null : JSON.stringify(s.config), statusJson);
  return Number(result.lastInsertRowid);
}

export interface SnapshotRow {
  id: number;
  mac: string;
  taken_at: string;
  info_json: string;
  config_json: string | null;
  status_json: string | null;
  /** Last time the device answered with the same info/config; NULL = seen once. */
  confirmed_at: string | null;
}

export interface SnapshotMeta {
  id: number;
  taken_at: string;
  confirmed_at: string | null;
  has_config: number;
}

/** Newest first. */
export function listSnapshotMeta(db: Db, mac: string, limit = 100): SnapshotMeta[] {
  return db
    .prepare(
      `SELECT id, taken_at, confirmed_at, config_json IS NOT NULL AS has_config
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
