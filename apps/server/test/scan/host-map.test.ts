import { describe, expect, it } from 'vitest';
import { directHost, parseHostMap } from '../../src/shelly/host-map.js';

describe('parseHostMap', () => {
  it('resolves to the IP itself without a map', () => {
    expect(parseHostMap(undefined)).toBe(directHost);
    expect(parseHostMap('')('192.168.1.5')).toBe('192.168.1.5');
  });

  it('maps single IPs and CIDR blocks with a base port', () => {
    const resolve = parseHostMap('10.99.0.0/24=127.0.0.1:18000, 10.98.0.1=localhost:9000');
    expect(resolve('10.99.0.5')).toBe('127.0.0.1:18005');
    expect(resolve('10.99.0.254')).toBe('127.0.0.1:18254');
    expect(resolve('10.98.0.1')).toBe('localhost:9000');
    expect(resolve('192.168.1.1')).toBe('192.168.1.1');
  });

  it('rejects malformed entries', () => {
    expect(() => parseHostMap('10.0.0.1')).toThrow(/SHELLY_HOST_MAP/);
    expect(() => parseHostMap('nope=127.0.0.1:1')).toThrow(/SHELLY_HOST_MAP/);
  });
});
