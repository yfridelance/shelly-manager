import type { Db } from '../db/database.js';
import { listDevices, type DeviceListRow } from '../db/devices.js';
import { listSites } from '../db/sites.js';
import { toCsv } from './csv.js';

interface SnapshotJsonRow {
  id: number;
  mac: string;
  taken_at: string;
  confirmed_at: string | null;
  info_json: string;
  config_json: string | null;
  status_json: string | null;
}

interface ResetRow {
  mac: string;
  finished_at: string;
}

const parse = (json: string | null): unknown => (json === null ? null : JSON.parse(json));

/** "A8032AB12345" -> "A8:03:2A:B1:23:45" */
const formatMac = (mac: string): string => mac.match(/.{2}/g)?.join(':') ?? mac;

/** Last successful factory reset per device. */
function resetTimes(db: Db): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT mac, MAX(finished_at) AS finished_at FROM action_log
       WHERE action = 'factory_reset' AND result = 'ok' GROUP BY mac`,
    )
    .all() as ResetRow[];
  return new Map(rows.map((r) => [r.mac, r.finished_at]));
}

function deviceJson(d: DeviceListRow, resetAt: string | undefined) {
  return {
    mac: d.mac,
    macFormatted: formatMac(d.mac),
    ip: d.ip,
    gen: d.gen,
    model: d.model,
    app: d.app,
    firmware: d.firmware,
    name: d.name ?? d.device_name,
    deviceName: d.device_name,
    deviceId: d.device_id,
    authRequired: d.auth_required === 1,
    location: d.location,
    notes: d.notes,
    state: d.state,
    firstSeen: d.first_seen,
    lastSeen: d.last_seen,
    factoryResetAt: resetAt ?? null,
    updateStable: d.update_stable,
    updateBeta: d.update_beta,
    updateCheckedAt: d.update_checked_at,
  };
}

/**
 * Full inventory as JSON, including the raw device answers (info/config/status) of the newest
 * snapshot, or of every snapshot with `allSnapshots`. Credentials are never stored, so none are exported.
 */
export function buildJsonExport(db: Db, options: { allSnapshots: boolean; now: string; siteId?: number | undefined }) {
  const sites = new Map(listSites(db).map((s) => [s.id, s.name]));
  const snapshots = db
    .prepare(
      options.allSnapshots
        ? 'SELECT * FROM config_snapshots ORDER BY mac, taken_at DESC, id DESC'
        : `SELECT s.* FROM config_snapshots s
           WHERE s.id = (SELECT id FROM config_snapshots t WHERE t.mac = s.mac ORDER BY taken_at DESC, id DESC LIMIT 1)`,
    )
    .all() as SnapshotJsonRow[];
  const byMac = new Map<string, SnapshotJsonRow[]>();
  for (const s of snapshots) byMac.set(s.mac, [...(byMac.get(s.mac) ?? []), s]);
  const resets = resetTimes(db);

  return {
    format: 'shelly-manager-inventory',
    version: 1,
    exportedAt: options.now,
    snapshots: options.allSnapshots ? 'all' : 'latest',
    site: options.siteId === undefined ? null : { id: options.siteId, name: sites.get(options.siteId) ?? null },
    devices: listDevices(db, options.siteId).map((d) => ({
      site: { id: d.site_id, name: sites.get(d.site_id) ?? null },
      ...deviceJson(d, resets.get(d.mac)),
      snapshots: (byMac.get(d.mac) ?? []).map((s) => ({
        id: s.id,
        takenAt: s.taken_at,
        confirmedAt: s.confirmed_at,
        info: parse(s.info_json),
        config: parse(s.config_json),
        status: parse(s.status_json),
      })),
    })),
  };
}

const STATE_TEXT: Record<string, string> = { active: 'Aktiv', missing: 'Vermisst', reset: 'Zurückgesetzt' };

/** Overview as CSV with German headers (opened in Excel by humans). Times stay ISO 8601 UTC. */
export function buildCsvExport(db: Db, siteId?: number): string {
  const resets = resetTimes(db);
  const sites = new Map(listSites(db).map((s) => [s.id, s.name]));
  return toCsv(
    [
      'Standort',
      'Name',
      'Name auf Gerät',
      'Geräte-ID',
      'Modell',
      'App',
      'Generation',
      'IP',
      'MAC',
      'Firmware',
      'Ort',
      'Notizen',
      'Status',
      'Passwortgeschützt',
      'Erstmals gesehen (UTC)',
      'Zuletzt gesehen (UTC)',
      'Letzter Snapshot (UTC)',
      'Werksreset (UTC)',
      'Firmware-Update verfügbar',
    ],
    listDevices(db, siteId).map((d) => [
      sites.get(d.site_id) ?? String(d.site_id),
      d.name ?? d.device_name,
      d.device_name,
      d.device_id,
      d.model,
      d.app,
      d.gen,
      d.ip,
      formatMac(d.mac),
      d.firmware,
      d.location,
      d.notes,
      STATE_TEXT[d.state] ?? d.state,
      d.auth_required === 1 ? 'ja' : 'nein',
      d.first_seen,
      d.last_seen,
      d.last_snapshot_at,
      resets.get(d.mac),
      d.update_stable,
    ]),
  );
}
