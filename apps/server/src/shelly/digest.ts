import { createHash, randomBytes } from 'node:crypto';

// HTTP Digest auth (RFC 7616, qop=auth only) as used by Gen2+ Shelly devices:
// realm = device id, algorithm SHA-256, user always "admin".
// See https://shelly-api-docs.shelly.cloud/gen2/General/Authentication

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop: string | undefined;
  algorithm: string;
  opaque: string | undefined;
  /** Nonce expired, credentials may still be fine: retry with the new nonce. */
  stale: boolean;
}

const HASHES: Record<string, string> = { 'SHA-256': 'sha256', MD5: 'md5' };

/** Parses a `WWW-Authenticate: Digest ...` header. Returns undefined for other schemes or missing realm/nonce. */
export function parseDigestChallenge(header: string | null | undefined): DigestChallenge | undefined {
  if (!header) return undefined;
  const match = /^\s*Digest\s+(.*)$/is.exec(header);
  if (!match?.[1]) return undefined;

  const params = new Map<string, string>();
  // key=value or key="quoted value" (with \" escapes), comma separated
  const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*))/g;
  for (const m of match[1].matchAll(re)) {
    const key = m[1];
    if (!key) continue;
    params.set(key.toLowerCase(), m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : (m[3] ?? ''));
  }

  const realm = params.get('realm');
  const nonce = params.get('nonce');
  if (realm === undefined || nonce === undefined) return undefined;
  return {
    realm,
    nonce,
    qop: params.get('qop'),
    algorithm: (params.get('algorithm') ?? 'MD5').toUpperCase(),
    opaque: params.get('opaque'),
    stale: params.get('stale')?.toLowerCase() === 'true',
  };
}

function hashFn(algorithm: string): (data: string) => string {
  const name = HASHES[algorithm];
  if (!name) throw new Error(`Unsupported digest algorithm: ${algorithm}`);
  return (data) => createHash(name).update(data).digest('hex');
}

export interface DigestInput {
  username: string;
  password: string;
  method: string;
  uri: string;
  nonce: string;
  realm: string;
  algorithm: string;
  /** 8 hex digits, e.g. "00000001". */
  nc: string;
  cnonce: string;
  qop: 'auth' | undefined;
}

/** response = H(H(user:realm:pass):nonce:nc:cnonce:qop:H(method:uri)), or the legacy form without qop. */
export function computeDigestResponse(i: DigestInput): string {
  const h = hashFn(i.algorithm);
  const ha1 = h(`${i.username}:${i.realm}:${i.password}`);
  const ha2 = h(`${i.method}:${i.uri}`);
  return i.qop ? h(`${ha1}:${i.nonce}:${i.nc}:${i.cnonce}:${i.qop}:${ha2}`) : h(`${ha1}:${i.nonce}:${ha2}`);
}

/**
 * Holds one challenge and its request counter, so consecutive requests reuse the nonce
 * (firmware >= 2.0 requires nc to strictly increase per nonce).
 */
export class DigestSession {
  private challenge: DigestChallenge | undefined;
  private nc = 0;

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}

  get hasChallenge(): boolean {
    return this.challenge !== undefined;
  }

  setChallenge(challenge: DigestChallenge): void {
    this.challenge = challenge;
    this.nc = 0;
  }

  /** Builds the next Authorization header, or undefined if no challenge has been seen yet. */
  authorize(method: string, uri: string): string | undefined {
    const c = this.challenge;
    if (!c) return undefined;
    // Only qop=auth is supported; "auth-int" alone is not offered by Shelly devices.
    const qop = c.qop?.split(',').map((q) => q.trim()).includes('auth') ? ('auth' as const) : undefined;
    this.nc += 1;
    const nc = this.nc.toString(16).padStart(8, '0');
    const cnonce = randomBytes(8).toString('hex');
    const response = computeDigestResponse({
      username: this.username,
      password: this.password,
      method,
      uri,
      nonce: c.nonce,
      realm: c.realm,
      algorithm: c.algorithm,
      nc,
      cnonce,
      qop,
    });

    const parts = [
      `username="${quote(this.username)}"`,
      `realm="${quote(c.realm)}"`,
      `nonce="${quote(c.nonce)}"`,
      `uri="${quote(uri)}"`,
      `algorithm=${c.algorithm}`,
      `response="${response}"`,
    ];
    if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    if (c.opaque !== undefined) parts.push(`opaque="${quote(c.opaque)}"`);
    return `Digest ${parts.join(', ')}`;
  }
}

function quote(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}
