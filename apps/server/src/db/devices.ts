import type { DeviceInfo, FirmwareUpdates } from '../shelly/types.js';
import type { Db } from './database.js';

export type DeviceState = 'active' | 'reset' | 'missing';

export interface DeviceRow {
  mac: string;
  ip: string | null;
  gen: number;
  model: string | null;
  app: string | null;
  firmware: string | null;
  name: string | null;
  device_name: string | null;
  device_id: string | null;
  site_id: number;
  auth_required: number;
  location: string | null;
  notes: string | null;
  /** What is connected (local, free text). */
  kind: string | null;
  /** DeviceFunctions as JSON, derived from the newest snapshot. */
  functions: string | null;
  state: DeviceState;
  first_seen: string;
  last_seen: string;
  update_stable: string | null;
  update_beta: string | null;
  update_checked_at: string | null;
}

export interface UpsertResult {
  created: boolean;
  /** The MAC belongs to another site: nothing was changed (devices only move explicitly). */
  foreignSiteId?: number;
}

/**
 * Inserts or updates a device seen on the network, keyed by MAC.
 * Updates IP, firmware, identity and last_seen; never touches location or notes.
 * Another device that still claims the same IP loses it (the address moved on).
 */
export function upsertSeenDevice(db: Db, info: DeviceInfo, ip: string, now: string, siteId = 1): UpsertResult {
  return db.transaction((): UpsertResult => {
    const existingSite = db.prepare('SELECT site_id FROM devices WHERE mac = ?').pluck().get(info.mac) as number | undefined;
    if (existingSite !== undefined && existingSite !== siteId) return { created: false, foreignSiteId: existingSite };
    // IPs are unique per site only: other sites are separate networks.
    db.prepare('UPDATE devices SET ip = NULL WHERE ip = ? AND mac <> ? AND site_id = ?').run(ip, info.mac, siteId);
    db.prepare(
      `INSERT INTO devices (mac, ip, gen, model, app, firmware, name, device_name, device_id, auth_required, state, first_seen, last_seen, site_id)
       VALUES (@mac, @ip, @gen, @model, @app, @firmware, @name, @name, @deviceId, @authRequired, 'active', @now, @now, @siteId)
       ON CONFLICT (mac) DO UPDATE SET
         ip = excluded.ip,
         gen = excluded.gen,
         model = excluded.model,
         app = excluded.app,
         firmware = excluded.firmware,
         name = CASE WHEN devices.name IS devices.device_name
                     THEN COALESCE(excluded.device_name, devices.name)
                     ELSE devices.name END,
         -- A protected Gen1 device without credentials reports no name; keep the known one.
         device_name = COALESCE(excluded.device_name, devices.device_name),
         -- Gen1 reports its id only via /settings; keep the known one when that is not readable.
         device_id = COALESCE(excluded.device_id, devices.device_id),
         auth_required = excluded.auth_required,
         state = 'active',
         last_seen = excluded.last_seen`,
    ).run({
      mac: info.mac,
      ip,
      gen: info.gen,
      model: info.model,
      app: info.app,
      firmware: info.firmware,
      name: info.name,
      deviceId: info.deviceId,
      authRequired: info.authRequired ? 1 : 0,
      now,
      siteId,
    });
    return { created: existingSite === undefined };
  })();
}

/**
 * After a complete scan: active devices whose last known IP was scanned but did not answer as
 * that device become `missing`. Devices marked `reset` stay `reset`. Returns the affected MACs.
 */
export function markMissing(db: Db, scannedIps: ReadonlySet<string>, foundMacs: ReadonlySet<string>, siteId = 1): string[] {
  return db.transaction(() => {
    const candidates = db
      .prepare("SELECT mac, ip FROM devices WHERE state = 'active' AND ip IS NOT NULL AND site_id = ?")
      .all(siteId) as { mac: string; ip: string }[];
    const missing = candidates.filter((d) => scannedIps.has(d.ip) && !foundMacs.has(d.mac)).map((d) => d.mac);
    const update = db.prepare("UPDATE devices SET state = 'missing' WHERE mac = ?");
    for (const mac of missing) update.run(mac);
    return missing;
  })();
}

export interface DeviceListRow extends DeviceRow {
  last_snapshot_at: string | null;
}

const SELECT_WITH_SNAPSHOT = `
  SELECT d.*, (SELECT MAX(COALESCE(confirmed_at, taken_at)) FROM config_snapshots s WHERE s.mac = d.mac) AS last_snapshot_at
  FROM devices d`;

export function getDevice(db: Db, mac: string): DeviceListRow | undefined {
  return db.prepare(`${SELECT_WITH_SNAPSHOT} WHERE d.mac = ?`).get(mac) as DeviceListRow | undefined;
}

/** All devices, or those of one site. */
export function listDevices(db: Db, siteId?: number): DeviceListRow[] {
  const order = 'ORDER BY COALESCE(d.name, d.device_name, d.mac)';
  return (
    siteId === undefined
      ? db.prepare(`${SELECT_WITH_SNAPSHOT} ${order}`).all()
      : db.prepare(`${SELECT_WITH_SNAPSHOT} WHERE d.site_id = ? ${order}`).all(siteId)
  ) as DeviceListRow[];
}

/** Moves a device to another site; its IP is dropped there if another device of that site holds it. */
export function moveDevice(db: Db, mac: string, siteId: number): boolean {
  return db.transaction(() => {
    const d = db.prepare('SELECT ip FROM devices WHERE mac = ?').get(mac) as { ip: string | null } | undefined;
    if (!d) return false;
    const clash = d.ip && db.prepare('SELECT 1 FROM devices WHERE site_id = ? AND ip = ? AND mac <> ?').get(siteId, d.ip, mac);
    db.prepare('UPDATE devices SET site_id = ?, ip = ? WHERE mac = ?').run(siteId, clash ? null : d.ip, mac);
    return true;
  })();
}

export interface LocalDeviceFields {
  /** null/empty: show the name the device reports again (and follow it on later scans). */
  name?: string | null;
  location?: string | null;
  notes?: string | null;
  kind?: string | null;
}

/** Updates local-only fields; nothing is written to the device. Returns false for unknown MACs. */
export function updateLocalFields(db: Db, mac: string, fields: LocalDeviceFields): boolean {
  const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
  const name = clean(fields.name);
  const location = clean(fields.location);
  const notes = clean(fields.notes);
  const kind = clean(fields.kind);
  const res = db
    .prepare(
      `UPDATE devices SET
         name = CASE WHEN @setName THEN COALESCE(@name, device_name) ELSE name END,
         location = CASE WHEN @setLocation THEN @location ELSE location END,
         notes = CASE WHEN @setNotes THEN @notes ELSE notes END,
         kind = CASE WHEN @setKind THEN @kind ELSE kind END
       WHERE mac = @mac`,
    )
    .run({
      mac,
      setName: name !== undefined ? 1 : 0,
      name: name ?? null,
      setLocation: location !== undefined ? 1 : 0,
      location: location ?? null,
      setNotes: notes !== undefined ? 1 : 0,
      notes: notes ?? null,
      setKind: kind !== undefined ? 1 : 0,
      kind: kind ?? null,
    });
  return res.changes > 0;
}

/** After a successful factory reset. The record stays for documentation. */
export function markReset(db: Db, mac: string): void {
  db.prepare("UPDATE devices SET state = 'reset' WHERE mac = ?").run(mac);
}

/** Remembers which newer firmware the device offers. */
export function recordFirmwareUpdates(db: Db, mac: string, updates: FirmwareUpdates, checkedAt: string): void {
  db.prepare('UPDATE devices SET update_stable = ?, update_beta = ?, update_checked_at = ? WHERE mac = ?').run(
    updates.stable,
    updates.beta,
    checkedAt,
    mac,
  );
}

/** New address of a device after a network change (null: unknown); another device loses the address. */
export function updateDeviceIp(db: Db, mac: string, ip: string | null): void {
  db.transaction(() => {
    if (ip) {
      db.prepare('UPDATE devices SET ip = NULL WHERE ip = ? AND mac <> ? AND site_id = (SELECT site_id FROM devices WHERE mac = ?)').run(ip, mac, mac);
    }
    db.prepare('UPDATE devices SET ip = ? WHERE mac = ?').run(ip, mac);
  })();
}
