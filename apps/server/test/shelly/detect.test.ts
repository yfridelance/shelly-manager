import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotAShellyError, ShellyNetworkError, ShellyTimeoutError, parseShellyInfo, probeShelly } from '../../src/shelly/index.js';
import { DEFAULT_FLEET, startMockDevice, startMockFleet, type MockFleet } from '../mock-shelly/index.js';

describe('parseShellyInfo', () => {
  it('detects Gen1 by the missing gen field', () => {
    const info = parseShellyInfo({ type: 'SHSW-1', mac: 'E8:68:e7:A1:B2:C3', auth: true, fw: '20230913-112003/v1.14.0-gcb84623', longid: 1 });
    expect(info).toMatchObject({ gen: 1, mac: 'E868E7A1B2C3', model: 'SHSW-1', app: null, firmware: '20230913-112003/v1.14.0-gcb84623', deviceId: null, authRequired: true });
  });

  it.each([2, 3, 4])('detects RPC gen %i', (gen) => {
    const raw = { id: 'shellyplus1pm-a8032ab12345', mac: 'A8032AB12345', model: 'SNSW-001P16EU', gen, fw_id: '20241011-114455/1.4.4-g6d2a586', ver: '1.4.4', app: 'Plus1PM', auth_en: false, auth_domain: null, name: 'Boiler' };
    expect(parseShellyInfo(raw)).toMatchObject({ gen, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', firmware: '20241011-114455/1.4.4-g6d2a586', name: 'Boiler', deviceId: 'shellyplus1pm-a8032ab12345', authRequired: false, raw });
  });

  it('keeps the raw answer unchanged', () => {
    const raw = { type: 'SHSW-1', mac: 'E868E7A1B2C3', auth: false, fw: 'x', extra: { a: 1 } };
    expect(parseShellyInfo(raw)?.raw).toBe(raw);
  });

  it('rejects things that are not Shelly answers', () => {
    expect(parseShellyInfo(null)).toBeUndefined();
    expect(parseShellyInfo({ hello: 'world' })).toBeUndefined();
    expect(parseShellyInfo({ mac: 'not-a-mac', type: 'SHSW-1' })).toBeUndefined();
    expect(parseShellyInfo({ mac: 'E868E7A1B2C3', gen: 9 })).toBeUndefined();
    expect(parseShellyInfo({ mac: 'E868E7A1B2C3' })).toBeUndefined();
  });
});

describe('probeShelly against the mock fleet', () => {
  let fleet: MockFleet;
  beforeAll(async () => {
    fleet = await startMockFleet(DEFAULT_FLEET);
  });
  afterAll(async () => {
    await fleet.close();
  });

  it('identifies every device without credentials', async () => {
    const infos = await Promise.all(fleet.devices.map((d) => probeShelly(d.host)));
    expect(infos.map((i) => [i.mac, i.gen, i.authRequired])).toEqual([
      ['E868E7A1B2C3', 1, false],
      ['E868E7D4E5F6', 1, true],
      ['A8032AB12345', 2, false],
      ['A8032AB67890', 2, true],
      ['34CDB0A1A1A1', 3, false],
      ['7C2C67B2B2B2', 4, true],
    ]);
    // /shelly must work without auth, so no device saw an auth failure.
    expect(fleet.devices.every((d) => d.state.authFailures === 0)).toBe(true);
  });

  it('reports other HTTP servers as NotAShellyError', async () => {
    const foreign = await startMockDevice({ kind: 'foreign' });
    try {
      await expect(probeShelly(foreign.host)).rejects.toBeInstanceOf(NotAShellyError);
    } finally {
      await foreign.stop();
    }
  });

  it('times out on hosts that never answer', async () => {
    const hang = await startMockDevice({ kind: 'hang' });
    try {
      const started = Date.now();
      await expect(probeShelly(hang.host, 200)).rejects.toBeInstanceOf(ShellyTimeoutError);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await hang.stop();
    }
  });

  it('reports closed ports as ShellyNetworkError', async () => {
    const dev = await startMockDevice({ kind: 'foreign' });
    await dev.stop();
    await expect(probeShelly(dev.host)).rejects.toBeInstanceOf(ShellyNetworkError);
  });
});
