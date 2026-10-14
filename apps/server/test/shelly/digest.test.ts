import { describe, expect, it } from 'vitest';
import { DigestSession, computeDigestResponse, parseDigestChallenge } from '../../src/shelly/digest.js';

describe('parseDigestChallenge', () => {
  it('parses a Shelly Gen2+ challenge', () => {
    const c = parseDigestChallenge(
      'Digest qop="auth", realm="shellypro4pm-f008d1d8b8b8", nonce="60dc59c6", algorithm=SHA-256',
    );
    expect(c).toEqual({
      realm: 'shellypro4pm-f008d1d8b8b8',
      nonce: '60dc59c6',
      qop: 'auth',
      algorithm: 'SHA-256',
      opaque: undefined,
      stale: false,
    });
  });

  it('reads stale, opaque and escaped quotes', () => {
    const c = parseDigestChallenge('Digest realm="a \\"b\\"", nonce="n=1+/", opaque="xyz", stale=TRUE, algorithm=sha-256');
    expect(c).toMatchObject({ realm: 'a "b"', nonce: 'n=1+/', opaque: 'xyz', stale: true, algorithm: 'SHA-256' });
  });

  it('rejects other schemes and incomplete challenges', () => {
    expect(parseDigestChallenge('Basic realm="x"')).toBeUndefined();
    expect(parseDigestChallenge('Digest realm="x"')).toBeUndefined();
    expect(parseDigestChallenge(null)).toBeUndefined();
  });
});

describe('computeDigestResponse', () => {
  // Test vectors from RFC 7616, section 3.9.1.
  const rfc = {
    username: 'Mufasa',
    password: 'Circle of Life',
    realm: 'http-auth@example.org',
    method: 'GET',
    uri: '/dir/index.html',
    nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
    nc: '00000001',
    cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
    qop: 'auth' as const,
  };

  it('matches the RFC 7616 SHA-256 example', () => {
    expect(computeDigestResponse({ ...rfc, algorithm: 'SHA-256' })).toBe(
      '753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1',
    );
  });

  it('matches the RFC 7616 MD5 example', () => {
    expect(computeDigestResponse({ ...rfc, algorithm: 'MD5' })).toBe('8ca523f5e9506fed4657c9700eebdbec');
  });

  it('refuses unknown algorithms', () => {
    expect(() => computeDigestResponse({ ...rfc, algorithm: 'SHA-512-256' })).toThrow(/Unsupported/);
  });
});

describe('DigestSession', () => {
  it('produces no header before a challenge was seen', () => {
    expect(new DigestSession('admin', 'pw').authorize('POST', '/rpc')).toBeUndefined();
  });

  it('increments nc per request and resets it for a new nonce', () => {
    const s = new DigestSession('admin', 'pw');
    const challenge = { realm: 'dev', nonce: 'n1', qop: 'auth', algorithm: 'SHA-256', opaque: undefined, stale: false };
    s.setChallenge(challenge);
    expect(s.authorize('POST', '/rpc')).toMatch(/nc=00000001/);
    expect(s.authorize('POST', '/rpc')).toMatch(/nc=00000002/);
    s.setChallenge({ ...challenge, nonce: 'n2' });
    const header = s.authorize('POST', '/rpc');
    expect(header).toMatch(/nc=00000001/);
    expect(header).toMatch(/^Digest username="admin", realm="dev", nonce="n2", uri="\/rpc", algorithm=SHA-256, response="[0-9a-f]{64}", qop=auth/);
  });
});
