import { normalizeIp, normalizeMask } from './kern';

describe('Kern field helpers', () => {
  it('normalises IP ranges and subnet masks like the Kern fields do on leaving them', () => {
    expect(normalizeIp('10.0.0.1 – 50')).toBe('10.0.0.1-10.0.0.50');
    expect(normalizeIp('kein ip')).toBe('kein ip');
    expect(normalizeMask('/24')).toBe('255.255.255.0');
    expect(normalizeMask('22')).toBe('255.255.252.0');
    expect(normalizeMask('255.255.255.0')).toBe('255.255.255.0');
    // Invalid masks stay as typed; the server rejects them with invalid_network.
    expect(normalizeMask('255.0.255.0')).toBe('255.0.255.0');
    expect(normalizeMask(undefined)).toBeUndefined();
  });
});
