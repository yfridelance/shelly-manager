import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/database.js';
import { getSnapshot, insertSnapshot, listSnapshotMeta } from '../../src/db/snapshots.js';

const MAC = 'A8032AB12345';
const GEN1_MAC = 'E868E7A1B2C3';
const t = (h: number) => `2026-10-14T${String(h).padStart(2, '0')}:00:00.000Z`;

function setup() {
  const db = openDatabase(':memory:');
  const dev = db.prepare('INSERT INTO devices (mac, gen, first_seen, last_seen) VALUES (?, ?, ?, ?)');
  dev.run(MAC, 2, t(0), t(0));
  dev.run(GEN1_MAC, 1, t(0), t(0));
  return db;
}

const rpcInfo = { id: 'shellyplus1pm-a8032ab12345', mac: MAC, gen: 2 };
const rpcConfig = { sys: { device: { name: 'Boiler' } } };

describe('insertSnapshot', () => {
  it('reuses the newest row when info and config are unchanged, updating status and confirmed_at', () => {
    const db = setup();
    const first = insertSnapshot(db, { mac: MAC, takenAt: t(10), info: rpcInfo, config: rpcConfig, status: { sys: { uptime: 1 } } });
    const second = insertSnapshot(db, { mac: MAC, takenAt: t(11), info: rpcInfo, config: rpcConfig, status: { sys: { uptime: 3601 } } });

    expect(second).toBe(first);
    expect(getSnapshot(db, MAC, first)).toMatchObject({
      taken_at: t(10),
      confirmed_at: t(11),
      status_json: JSON.stringify({ sys: { uptime: 3601 } }),
    });
    expect(listSnapshotMeta(db, MAC)).toEqual([{ id: first, taken_at: t(10), confirmed_at: t(11), has_config: 1 }]);
  });

  it('adds a row when the config or the info changed', () => {
    const db = setup();
    const first = insertSnapshot(db, { mac: MAC, takenAt: t(10), info: rpcInfo, config: rpcConfig, status: {} });
    const changed = insertSnapshot(db, { mac: MAC, takenAt: t(11), info: rpcInfo, config: { sys: { device: { name: 'Boiler 2' } } }, status: {} });
    const newFw = insertSnapshot(db, { mac: MAC, takenAt: t(12), info: { ...rpcInfo, ver: '1.5.0' }, config: { sys: { device: { name: 'Boiler 2' } } }, status: {} });
    // Back to the first config: compared with the newest row only, so this is a new entry.
    const back = insertSnapshot(db, { mac: MAC, takenAt: t(13), info: { ...rpcInfo, ver: '1.5.0' }, config: rpcConfig, status: {} });

    expect(new Set([first, changed, newFw, back]).size).toBe(4);
    expect(getSnapshot(db, MAC, first)?.confirmed_at).toBeNull();
    expect(listSnapshotMeta(db, MAC).map((s) => s.id)).toEqual([back, newFw, changed, first]);
  });

  it('adds a row when a config is read for the first time', () => {
    const db = setup();
    const withoutConfig = insertSnapshot(db, { mac: MAC, takenAt: t(10), info: rpcInfo, config: undefined, status: undefined });
    const withConfig = insertSnapshot(db, { mac: MAC, takenAt: t(11), info: rpcInfo, config: rpcConfig, status: {} });
    expect(withConfig).not.toBe(withoutConfig);
  });

  it('ignores the Gen1 device clock in /settings but stores the raw answer', () => {
    const db = setup();
    const info = { type: 'SHSW-1', mac: GEN1_MAC, auth: false, fw: '20230913-112003/v1.14.0-gcb84623' };
    const settings = (unixtime: number, extra: object = {}) => ({ device: { hostname: 'shelly1-A1B2C3' }, time: '12:34', unixtime, ...extra });

    const first = insertSnapshot(db, { mac: GEN1_MAC, takenAt: t(10), info, config: settings(1760445240), status: {} });
    expect(insertSnapshot(db, { mac: GEN1_MAC, takenAt: t(11), info, config: settings(1760448840), status: {} })).toBe(first);
    expect(getSnapshot(db, GEN1_MAC, first)?.config_json).toBe(JSON.stringify(settings(1760445240)));

    const changed = insertSnapshot(db, { mac: GEN1_MAC, takenAt: t(12), info, config: settings(1760452440, { ap_roaming: { enabled: true } }), status: {} });
    expect(changed).not.toBe(first);
  });

  it('compares Gen2+ configs completely', () => {
    const db = setup();
    const first = insertSnapshot(db, { mac: MAC, takenAt: t(10), info: rpcInfo, config: { ...rpcConfig, time: 1 }, status: {} });
    expect(insertSnapshot(db, { mac: MAC, takenAt: t(11), info: rpcInfo, config: { ...rpcConfig, time: 2 }, status: {} })).not.toBe(first);
  });
});
