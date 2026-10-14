export const MAX_SCAN_ADDRESSES = 1024;

/** Invalid user input. The message is shown in the UI as is, hence German. */
export class RangeParseError extends Error {
  override name = 'RangeParseError';
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipToInt(ip: string): number {
  const m = IPV4.exec(ip.trim());
  if (!m) throw new RangeParseError(`Ungültige IPv4-Adresse: ${ip}`);
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) throw new RangeParseError(`Ungültige IPv4-Adresse: ${ip}`);
  return octets.reduce((acc, o) => acc * 256 + o, 0);
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/**
 * Expands "192.168.1.0/24", "192.168.1.10-192.168.1.50" or a single IP to a list of addresses.
 * For CIDR prefixes up to /30 the network and broadcast addresses are skipped.
 */
export function parseRange(input: string): string[] {
  const text = input.trim();
  if (!text) throw new RangeParseError('Bitte einen IP-Bereich angeben.');

  let first: number;
  let last: number;

  if (text.includes('/')) {
    const [base = '', prefixText = ''] = text.split('/');
    const prefix = Number(prefixText);
    if (!/^\d{1,2}$/.test(prefixText.trim()) || prefix > 32) {
      throw new RangeParseError(`Ungültige CIDR-Präfixlänge: /${prefixText}`);
    }
    const size = 2 ** (32 - prefix);
    const network = Math.floor(ipToInt(base) / size) * size;
    first = network;
    last = network + size - 1;
    if (prefix <= 30) {
      first += 1;
      last -= 1;
    }
  } else if (text.includes('-')) {
    const [a = '', b = ''] = text.split('-');
    first = ipToInt(a);
    last = ipToInt(b);
    if (first > last) throw new RangeParseError('Die Start-IP muss vor der End-IP liegen.');
  } else {
    first = last = ipToInt(text);
  }

  const count = last - first + 1;
  if (count > MAX_SCAN_ADDRESSES) {
    throw new RangeParseError(`Der Bereich umfasst ${count} Adressen, erlaubt sind höchstens ${MAX_SCAN_ADDRESSES}.`);
  }
  return Array.from({ length: count }, (_, i) => intToIp(first + i));
}
