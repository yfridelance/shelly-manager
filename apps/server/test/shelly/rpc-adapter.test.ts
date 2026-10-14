import { afterEach, describe, expect, it } from 'vitest';
import { RpcAdapter, ShellyAuthError, ShellyNetworkError, ShellyRpcError, createAdapter, probeShelly } from '../../src/shelly/index.js';
import { startMockDevice, type MockDevice, type RpcSpec } from '../mock-shelly/index.js';

const open: RpcSpec = { kind: 'rpc', gen: 2, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler' };
const protectedSpec: RpcSpec = { ...open, gen: 4, mac: '7C2C67B2B2B2', model: 'S4SW-001P16EU', app: 'S1PMG4', name: 'Garage', password: 'gen4-secret' };

describe('RpcAdapter', () => {
  let dev: MockDevice | undefined;
  afterEach(async () => {
    await dev?.stop();
  });

  it.each([2, 3, 4] as const)('is chosen by createAdapter for gen %i', (gen) => {
    expect(createAdapter('127.0.0.1', gen)).toBeInstanceOf(RpcAdapter);
  });

  it('reads info, raw config and status from an open device', async () => {
    dev = await startMockDevice(open);
    const adapter = new RpcAdapter(dev.host);
    expect(await adapter.getInfo()).toMatchObject({ mac: 'A8032AB12345', gen: 2, model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler' });
    expect(await adapter.getConfig()).toMatchObject({ sys: { device: { name: 'Boiler', mac: 'A8032AB12345' } }, 'switch:0': { id: 0 } });
    expect(await adapter.getStatus()).toMatchObject({ sys: { mac: 'A8032AB12345' } });
    expect(dev.state.requests).toEqual(['GET /shelly', 'RPC Shelly.GetConfig', 'RPC Shelly.GetStatus']);
  });

  it('falls back to Sys.GetConfig for the name on older firmware', async () => {
    dev = await startMockDevice({ ...open, gen: 3, legacyShellyEndpoint: true, name: 'Mini' });
    expect(await new RpcAdapter(dev.host).getInfo()).toMatchObject({ gen: 3, name: 'Mini' });
    expect(dev.state.requests).toContain('RPC Sys.GetConfig');
  });

  it('requires credentials on a protected device', async () => {
    dev = await startMockDevice(protectedSpec);
    const adapter = new RpcAdapter(dev.host);
    expect(await adapter.getInfo()).toMatchObject({ authRequired: true });
    await expect(adapter.getConfig()).rejects.toMatchObject({ name: 'ShellyAuthError', reason: 'required' });
  });

  it('rejects a wrong password after one digest round', async () => {
    dev = await startMockDevice(protectedSpec);
    const adapter = new RpcAdapter(dev.host, { credentials: { password: 'wrong' } });
    const err = await adapter.getConfig().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShellyAuthError);
    expect(err).toMatchObject({ reason: 'invalid' });
    expect(String((err as Error).message)).not.toContain('wrong');
    // 1x unauthenticated probe for the challenge, 1x with the wrong digest. No retry storm (devices throttle).
    expect(dev.state.authFailures).toBe(2);
  });

  it('authenticates with digest and reuses the nonce for later calls', async () => {
    dev = await startMockDevice(protectedSpec);
    const adapter = new RpcAdapter(dev.host, { credentials: { password: 'gen4-secret' } });
    expect(await adapter.getConfig()).toMatchObject({ sys: { device: { name: 'Garage' } } });
    expect(dev.state.authFailures).toBe(1); // only the initial challenge
    await adapter.getStatus();
    await adapter.getConfig();
    expect(dev.state.authFailures).toBe(1);
  });

  it('retries once on a stale nonce', async () => {
    dev = await startMockDevice(protectedSpec);
    const adapter = new RpcAdapter(dev.host, { credentials: { password: 'gen4-secret' } });
    await adapter.getConfig();
    dev.expireNonces();
    await expect(adapter.getStatus()).resolves.toMatchObject({ sys: { mac: '7C2C67B2B2B2' } });
  });

  it('surfaces JSON-RPC errors', async () => {
    dev = await startMockDevice(open);
    const err = await new RpcAdapter(dev.host).call('Nope.Method').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShellyRpcError);
    expect(err).toMatchObject({ code: 404, method: 'Nope.Method' });
  });

  it('reboots', async () => {
    dev = await startMockDevice(protectedSpec);
    await new RpcAdapter(dev.host, { credentials: { password: 'gen4-secret' } }).reboot();
    expect(dev.state.rebootCount).toBe(1);
  });

  it('factory-resets and the device leaves the network', async () => {
    dev = await startMockDevice(protectedSpec);
    await new RpcAdapter(dev.host, { credentials: { password: 'gen4-secret' } }).factoryReset();
    expect(dev.state.factoryResetCount).toBe(1);
    expect(dev.state.requests).toContain('RPC Shelly.FactoryReset');
    await expect(probeShelly(dev.host)).rejects.toBeInstanceOf(ShellyNetworkError);
  });

  it('returns factory defaults after a reset when the device stays reachable', async () => {
    dev = await startMockDevice({ ...protectedSpec, offlineAfterReset: false });
    await new RpcAdapter(dev.host, { credentials: { password: 'gen4-secret' } }).factoryReset();
    const after = new RpcAdapter(dev.host);
    expect(await after.getInfo()).toMatchObject({ authRequired: false, name: null });
    expect(await after.getConfig()).toMatchObject({ wifi: { ap: { enable: true }, sta: { enable: false } } });
  });
});
