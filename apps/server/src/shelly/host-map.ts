import { RangeParseError, ipToInt, intToIp } from '../scan/ip-range.js';

export type HostResolver = (ip: string) => string;

/** Real devices: the IP itself, port 80. */
export const directHost: HostResolver = (ip) => ip;

/**
 * Parses SHELLY_HOST_MAP, used to point scanned IPs at mock devices during development and tests.
 * Comma separated entries:
 *   "10.99.0.5=127.0.0.1:18005"      one IP -> host:port
 *   "10.99.0.0/24=127.0.0.1:18000"   every IP in the block -> host:(basePort + offset in block)
 * IPs without a match resolve to themselves.
 */
export function parseHostMap(spec: string | undefined): HostResolver {
  const entries = (spec ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((entry) => {
      const [from = '', to = ''] = entry.split('=');
      const target = /^(.+):(\d+)$/.exec(to.trim());
      if (!target?.[1] || !target[2]) throw new Error(`Invalid SHELLY_HOST_MAP entry: ${entry}`);
      const host = target[1];
      const port = Number(target[2]);
      try {
        if (from.includes('/')) {
          const [base = '', prefixText = ''] = from.split('/');
          const size = 2 ** (32 - Number(prefixText));
          const network = Math.floor(ipToInt(base) / size) * size;
          return { first: network, last: network + size - 1, resolve: (n: number) => `${host}:${port + (n - network)}` };
        }
        const ip = ipToInt(from);
        return { first: ip, last: ip, resolve: () => `${host}:${port}` };
      } catch (err) {
        if (err instanceof RangeParseError) throw new Error(`Invalid SHELLY_HOST_MAP entry: ${entry}`);
        throw err;
      }
    });

  if (entries.length === 0) return directHost;
  return (ip) => {
    const n = ipToInt(ip);
    const entry = entries.find((e) => n >= e.first && n <= e.last);
    return entry ? entry.resolve(n) : intToIp(n);
  };
}
