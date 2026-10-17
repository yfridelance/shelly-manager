import { intToIp, ipToInt } from '../scan/ip-range.js';

// Static IP planning for templates: subnet arithmetic and incremental assignment.

export const IPV4_PATTERN = '^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$';

export function isIpv4(value: string): boolean {
  return new RegExp(IPV4_PATTERN).test(value);
}

/** Prefix length of a dotted netmask, or undefined if it is not a contiguous mask (e.g. 255.0.255.0). */
export function netmaskBits(netmask: string): number | undefined {
  if (!isIpv4(netmask)) return undefined;
  const n = ipToInt(netmask);
  const bits = n.toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bits)) return undefined;
  return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
}

export interface Subnet {
  network: number;
  broadcast: number;
  bits: number;
}

export function subnetOf(ip: string, netmask: string): Subnet | undefined {
  const bits = netmaskBits(netmask);
  if (bits === undefined || bits < 8 || bits > 30 || !isIpv4(ip)) return undefined;
  const size = 2 ** (32 - bits);
  const network = Math.floor(ipToInt(ip) / size) * size;
  return { network, broadcast: network + size - 1, bits };
}

export type IpProblem = 'invalid' | 'outside_subnet' | 'reserved' | 'gateway' | 'taken';

/**
 * Checks a planned static IP against the subnet of `ipFrom/netmask`: not network/broadcast,
 * not the gateway, not used by another device (`taken`: ip → mac of the current holder).
 */
export function checkStaticIp(
  ip: string,
  cfg: { ipFrom: string; netmask: string; gateway?: string | undefined },
  mac: string,
  taken: ReadonlyMap<string, string>,
): IpProblem | undefined {
  if (!isIpv4(ip)) return 'invalid';
  const subnet = subnetOf(cfg.ipFrom, cfg.netmask);
  if (!subnet) return 'invalid';
  const n = ipToInt(ip);
  if (n < subnet.network || n > subnet.broadcast) return 'outside_subnet';
  if (n === subnet.network || n === subnet.broadcast) return 'reserved';
  if (cfg.gateway && ip === cfg.gateway) return 'gateway';
  const holder = taken.get(ip);
  if (holder !== undefined && holder !== mac) return 'taken';
  return undefined;
}

export interface AssignmentCandidate {
  mac: string;
  /** Current static IP of this interface, if the device is already static. */
  currentStatic?: string | null | undefined;
}

/**
 * Assigns static IPs to `candidates` (already in the wanted order). A device that already has a
 * valid static IP in the subnet keeps it, so a second run changes nothing; the others get the next
 * free address from `ipFrom` upwards. `taken` maps used IPs to the MAC holding them (other devices
 * in the inventory). Devices for which the subnet has no free address left get no entry.
 */
export function assignStaticIps(
  candidates: readonly AssignmentCandidate[],
  cfg: { ipFrom: string; netmask: string; gateway?: string | undefined },
  taken: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  const subnet = subnetOf(cfg.ipFrom, cfg.netmask);
  if (!subnet) return result;
  const used = new Map(taken);

  for (const c of candidates) {
    if (c.currentStatic && !checkStaticIp(c.currentStatic, cfg, c.mac, used) && ipToInt(c.currentStatic) >= ipToInt(cfg.ipFrom)) {
      result.set(c.mac, c.currentStatic);
      used.set(c.currentStatic, c.mac);
    }
  }
  // Each device searches from the start of the range, so it can take its own current (DHCP)
  // address and no gaps remain. Addresses of other devices stay taken until they have moved:
  // devices are reconfigured in parallel.
  const first = Math.max(ipToInt(cfg.ipFrom), subnet.network + 1);
  for (const c of candidates) {
    if (result.has(c.mac)) continue;
    for (let n = first; n < subnet.broadcast; n++) {
      const ip = intToIp(n);
      if (!checkStaticIp(ip, cfg, c.mac, used)) {
        result.set(c.mac, ip);
        used.set(ip, c.mac);
        break;
      }
    }
  }
  return result;
}


/** Validates a template's network group; returns a German message for the UI, or undefined. */
export function validateNetwork(
  iface: string,
  n: { mode: string; ipFrom?: string | undefined; netmask?: string | undefined; gateway?: string | undefined },
): string | undefined {
  const label = iface === 'sta' ? 'Haupt-WLAN' : 'Zweites WLAN';
  if (n.mode !== 'static') return undefined;
  if (!n.ipFrom || !n.netmask) return `${label}: Für statische IPs braucht es «IP ab» und eine Netzmaske.`;
  const subnet = subnetOf(n.ipFrom, n.netmask);
  if (!subnet) return `${label}: Die Netzmaske ${n.netmask} ist ungültig (erlaubt /8 bis /30).`;
  const from = ipToInt(n.ipFrom);
  if (from === subnet.network || from === subnet.broadcast) return `${label}: «IP ab» darf nicht Netz- oder Broadcast-Adresse sein.`;
  if (n.gateway) {
    const gw = ipToInt(n.gateway);
    if (gw <= subnet.network || gw >= subnet.broadcast) return `${label}: Das Gateway ${n.gateway} liegt nicht im Netz von ${n.ipFrom}/${subnet.bits}.`;
  }
  return undefined;
}
