import { describe, expect, it } from 'vitest';
import { RangeParseError, parseRange } from '../../src/scan/ip-range.js';

describe('parseRange', () => {
  it('expands a /24 without network and broadcast address', () => {
    const ips = parseRange('192.168.1.0/24');
    expect(ips).toHaveLength(254);
    expect(ips[0]).toBe('192.168.1.1');
    expect(ips.at(-1)).toBe('192.168.1.254');
  });

  it('normalizes host bits in CIDR notation', () => {
    expect(parseRange('10.0.0.77/30')).toEqual(['10.0.0.77', '10.0.0.78']);
  });

  it('keeps every address of /31 and /32', () => {
    expect(parseRange('10.0.0.4/31')).toEqual(['10.0.0.4', '10.0.0.5']);
    expect(parseRange('10.0.0.4/32')).toEqual(['10.0.0.4']);
  });

  it('expands start-end ranges across octets', () => {
    expect(parseRange(' 10.0.0.254 - 10.0.1.1 ')).toEqual(['10.0.0.254', '10.0.0.255', '10.0.1.0', '10.0.1.1']);
  });

  it('accepts a single address', () => {
    expect(parseRange('192.168.33.1')).toEqual(['192.168.33.1']);
  });

  it('allows exactly 1024 addresses and rejects more', () => {
    expect(parseRange('10.0.0.0-10.0.3.255')).toHaveLength(1024);
    expect(parseRange('10.0.0.0/22')).toHaveLength(1022);
    expect(() => parseRange('10.0.0.0/21')).toThrow(RangeParseError);
    expect(() => parseRange('10.0.0.0-10.0.4.0')).toThrow(/höchstens 1024/);
  });

  it.each(['', 'abc', '10.0.0.256', '10.0.0.0/33', '10.0.0.0/', '10.0.0.9-10.0.0.1', '10.0.0/24'])('rejects %j', (input) => {
    expect(() => parseRange(input)).toThrow(RangeParseError);
  });
});
