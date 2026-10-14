import type { DeviceInfo } from '../shelly/types.js';
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
  auth_required: number;
  location: string | null;
  notes: string | null;
  state: DeviceState;
  first_seen: string;
  last_seen: string;
}

export interface UpsertResult {
  created: boolean;
}

/**
 * Inserts or updates a device seen on the network, keyed by MAC.
 * Updates IP, firmware, identity and last_seen; never touches location or notes.
 * Another device that still claims the same IP loses it (the address moved on).
 */
export function upsertSeenDevice(db: Db, info: DeviceInfo, ip: string, now: string): UpsertResult {
  return db.transaction((): UpsertResult => {
    const exists = db.prepare('SELECT 1 FROM devices WHERE mac = ?').pluck().get(info.mac) !== undefined;
    db.prepare('UPDATE devices SET ip = NULL WHERE ip = ? AND mac <> ?').run(ip, info.mac);
    db.prepare(
      `INSERT INTO devices (mac, ip, gen, model, app, firmware, name, device_name, auth_required, state, first_seen, last_seen)
       VALUES (@mac, @ip, @gen, @model, @app, @firmware, @name, @name, @authRequired, 'active', @now, @now)
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
      authRequired: info.authRequired ? 1 : 0,
      now,
    });
    return { created: !exists };
  })();
}

/**
 * After a complete scan: active devices whose last known IP was scanned but did not answer as
 * that device become `missing`. Devices marked `reset` stay `reset`. Returns the affected MACs.
 */
export function markMissing(db: Db, scannedIps: ReadonlySet<string>, foundMacs: ReadonlySet<string>): string[] {
  return db.transaction(() => {
    const candidates = db
      .prepare("SELECT mac, ip FROM devices WHERE state = 'active' AND ip IS NOT NULL")
      .all() as { mac: string; ip: string }[];
    const missing = candidates.filter((d) => scannedIps.has(d.ip) && !foundMacs.has(d.mac)).map((d) => d.mac);
    const update = db.prepare("UPDATE devices SET state = 'missing' WHERE mac = ?");
    for (const mac of missing) update.run(mac);
    return missing;
  })();
}

export function getDevice(db: Db, mac: string): DeviceRow | undefined {
  return db.prepare('SELECT * FROM devices WHERE mac = ?').get(mac) as DeviceRow | undefined;
}

export function listDevices(db: Db): DeviceRow[] {
  return db.prepare('SELECT * FROM devices ORDER BY COALESCE(name, device_name, mac)').all() as DeviceRow[];
}
