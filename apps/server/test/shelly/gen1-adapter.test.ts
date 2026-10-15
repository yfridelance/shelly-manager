import { afterEach, describe, expect, it } from 'vitest';
import { Gen1Adapter, ShellyAuthError, ShellyNetworkError, createAdapter, probeShelly } from '../../src/shelly/index.js';
import { startMockDevice, type Gen1Spec, type MockDevice } from '../mock-shelly/index.js';

const open: Gen1Spec = { kind: 'gen1', mac: 'E868E7A1B2C3', type: 'SHSW-1', name: 'Licht Keller' };
const protectedSpec: Gen1Spec = { ...open, mac: 'E868E7D4E5F6', auth: { username: 'admin', password: 'gen1-secret' } };

describe('Gen1Adapter', () => {
  let dev: MockDevice | undefined;
  afterEach(async () => {
    await dev?.stop();
  });

  it('is chosen by createAdapter for gen 1', () => {
    expect(createAdapter('127.0.0.1', 1)).toBeInstanceOf(Gen1Adapter);
  });

  it('reads info with name, raw config and status from an open device', async () => {
    dev = await startMockDevice(open);
    const adapter = new Gen1Adapter(dev.host);
    expect(await adapter.getInfo()).toMatchObject({ mac: 'E868E7A1B2C3', gen: 1, model: 'SHSW-1', name: 'Licht Keller', deviceId: 'shelly1-A1B2C3', authRequired: false });
    expect(await adapter.getConfig()).toMatchObject({ device: { type: 'SHSW-1', mac: 'E868E7A1B2C3' }, name: 'Licht Keller' });
    expect(await adapter.getStatus()).toMatchObject({ mac: 'E868E7A1B2C3', relays: [{ ison: false }] });
  });

  it('requires credentials on a protected device', async () => {
    dev = await startMockDevice(protectedSpec);
    const adapter = new Gen1Adapter(dev.host);
    // getInfo still works without credentials, just without the name.
    expect(await adapter.getInfo()).toMatchObject({ authRequired: true, name: null, deviceId: null });
    await expect(adapter.getConfig()).rejects.toMatchObject({ name: 'ShellyAuthError', reason: 'required' });
  });

  it('rejects a wrong password', async () => {
    dev = await startMockDevice(protectedSpec);
    const adapter = new Gen1Adapter(dev.host, { credentials: { username: 'admin', password: 'wrong' } });
    const err = await adapter.getConfig().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShellyAuthError);
    expect(err).toMatchObject({ reason: 'invalid' });
    expect(String((err as Error).message)).not.toContain('wrong');
    expect(dev.state.authFailures).toBe(1);
  });

  it('works with the right credentials', async () => {
    dev = await startMockDevice(protectedSpec);
    const adapter = new Gen1Adapter(dev.host, { credentials: { username: 'admin', password: 'gen1-secret' } });
    expect(await adapter.getInfo()).toMatchObject({ name: 'Licht Keller', authRequired: true });
    expect(await adapter.getConfig()).toMatchObject({ login: { enabled: true, username: 'admin' } });
  });

  it('reboots', async () => {
    dev = await startMockDevice(open);
    await new Gen1Adapter(dev.host).reboot();
    expect(dev.state.rebootCount).toBe(1);
    expect(dev.state.requests).toContain('GET /reboot');
  });

  it('factory-resets via /settings?reset=true and the device leaves the network', async () => {
    dev = await startMockDevice(protectedSpec);
    await new Gen1Adapter(dev.host, { credentials: { username: 'admin', password: 'gen1-secret' } }).factoryReset();
    expect(dev.state.factoryResetCount).toBe(1);
    expect(dev.state.requests).toContain('GET /settings?reset=true');
    await expect(probeShelly(dev.host)).rejects.toBeInstanceOf(ShellyNetworkError);
  });

  it('returns factory defaults after a reset when the device stays reachable', async () => {
    dev = await startMockDevice({ ...protectedSpec, offlineAfterReset: false });
    await new Gen1Adapter(dev.host, { credentials: { username: 'admin', password: 'gen1-secret' } }).factoryReset();
    const after = new Gen1Adapter(dev.host);
    expect(await after.getInfo()).toMatchObject({ authRequired: false, name: null });
    expect(await after.getConfig()).toMatchObject({ login: { enabled: false }, wifi_ap: { enabled: true }, wifi_sta: { enabled: false } });
  });
});
