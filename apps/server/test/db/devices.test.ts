import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/database.js';
import { getDevice, markMissing, upsertSeenDevice } from '../../src/db/devices.js';
import type { DeviceInfo } from '../../src/shelly/types.js';

const info = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  mac: 'A8032AB12345',
  gen: 2,
  model: 'SNSW-001P16EU',
  app: 'Plus1PM',
  firmware: '20241011-114455/1.4.4-g6d2a586',
  name: 'Boiler',
  deviceId: 'shellyplus1pm-a8032ab12345',
  authRequired: false,
  raw: {},
  ...over,
});

describe('upsertSeenDevice', () => {
  it('inserts a new device with first_seen = last_seen', () => {
    const db = openDatabase(':memory:');
    expect(upsertSeenDevice(db, info(), '192.168.1.10', '2026-10-14T10:00:00.000Z')).toEqual({ created: true });
    expect(getDevice(db, 'A8032AB12345')).toMatchObject({
      ip: '192.168.1.10', gen: 2, name: 'Boiler', device_name: 'Boiler', state: 'active',
      first_seen: '2026-10-14T10:00:00.000Z', last_seen: '2026-10-14T10:00:00.000Z',
    });
  });

  it('keeps location and notes when the IP changes', () => {
    const db = openDatabase(':memory:');
    upsertSeenDevice(db, info(), '192.168.1.10', '2026-10-14T10:00:00.000Z');
    db.prepare("UPDATE devices SET location = 'Keller', notes = 'Hinter dem Boiler' WHERE mac = ?").run('A8032AB12345');

    const second = upsertSeenDevice(db, info({ firmware: '20250101-000000/1.5.0-gabc' }), '192.168.1.77', '2026-10-15T10:00:00.000Z');
    expect(second).toEqual({ created: false });
    expect(getDevice(db, 'A8032AB12345')).toMatchObject({
      ip: '192.168.1.77', firmware: '20250101-000000/1.5.0-gabc', location: 'Keller', notes: 'Hinter dem Boiler',
      first_seen: '2026-10-14T10:00:00.000Z', last_seen: '2026-10-15T10:00:00.000Z',
    });
  });

  it('follows device renames but keeps a locally edited name', () => {
    const db = openDatabase(':memory:');
    upsertSeenDevice(db, info(), '10.0.0.1', '2026-10-14T10:00:00.000Z');
    upsertSeenDevice(db, info({ name: 'Boiler neu' }), '10.0.0.1', '2026-10-14T11:00:00.000Z');
    expect(getDevice(db, 'A8032AB12345')).toMatchObject({ name: 'Boiler neu', device_name: 'Boiler neu' });

    db.prepare("UPDATE devices SET name = 'Warmwasser' WHERE mac = ?").run('A8032AB12345');
    upsertSeenDevice(db, info({ name: 'Boiler 2' }), '10.0.0.1', '2026-10-14T12:00:00.000Z');
    expect(getDevice(db, 'A8032AB12345')).toMatchObject({ name: 'Warmwasser', device_name: 'Boiler 2' });
  });

  it('keeps the known device id when a protected Gen1 device reports none', () => {
    const db = openDatabase(':memory:');
    upsertSeenDevice(db, info({ gen: 1, deviceId: 'shelly1-A1B2C3' }), '10.0.0.1', '2026-10-14T10:00:00.000Z');
    upsertSeenDevice(db, info({ gen: 1, deviceId: null, authRequired: true }), '10.0.0.1', '2026-10-14T11:00:00.000Z');
    expect(getDevice(db, 'A8032AB12345')?.device_id).toBe('shelly1-A1B2C3');
  });

  it('keeps the known name when a protected device reports none', () => {
    const db = openDatabase(':memory:');
    upsertSeenDevice(db, info({ gen: 1, name: 'Licht Keller' }), '10.0.0.1', '2026-10-14T10:00:00.000Z');
    upsertSeenDevice(db, info({ gen: 1, name: null, authRequired: true }), '10.0.0.1', '2026-10-14T11:00:00.000Z');
    expect(getDevice(db, 'A8032AB12345')).toMatchObject({ name: 'Licht Keller', auth_required: 1 });
  });

  it('takes the IP away from a device that no longer holds it', () => {
    const db = openDatabase(':memory:');
    upsertSeenDevice(db, info(), '10.0.0.1', '2026-10-14T10:00:00.000Z');
    upsertSeenDevice(db, info({ mac: 'E868E7A1B2C3', gen: 1 }), '10.0.0.1', '2026-10-14T11:00:00.000Z');
    expect(getDevice(db, 'A8032AB12345')?.ip).toBeNull();
    expect(getDevice(db, 'E868E7A1B2C3')?.ip).toBe('10.0.0.1');
  });

  it('reactivates a device that shows up again', () => {
    const db = openDatabase(':memory:');
    upsertSeenDevice(db, info(), '10.0.0.1', '2026-10-14T10:00:00.000Z');
    db.prepare("UPDATE devices SET state = 'missing'").run();
    upsertSeenDevice(db, info(), '10.0.0.1', '2026-10-14T11:00:00.000Z');
    expect(getDevice(db, 'A8032AB12345')?.state).toBe('active');
  });
});

describe('markMissing', () => {
  it('marks only active devices whose IP was scanned and not found', () => {
    const db = openDatabase(':memory:');
    const now = '2026-10-14T10:00:00.000Z';
    upsertSeenDevice(db, info({ mac: '000000000001' }), '10.0.0.1', now);
    upsertSeenDevice(db, info({ mac: '000000000002' }), '10.0.0.2', now);
    upsertSeenDevice(db, info({ mac: '000000000003' }), '10.0.1.3', now);
    upsertSeenDevice(db, info({ mac: '000000000004' }), '10.0.0.4', now);
    db.prepare("UPDATE devices SET state = 'reset' WHERE mac = '000000000004'").run();

    const missing = markMissing(db, new Set(['10.0.0.1', '10.0.0.2', '10.0.0.4']), new Set(['000000000001']));
    expect(missing).toEqual(['000000000002']);
    expect(getDevice(db, '000000000003')?.state).toBe('active'); // outside the scanned range
    expect(getDevice(db, '000000000004')?.state).toBe('reset');
  });
});
