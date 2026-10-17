import type { IncomingMessage, ServerResponse } from 'node:http';

export interface MockDeviceState {
  online: boolean;
  rebootCount: number;
  factoryResetCount: number;
  /** Started firmware updates (the mock applies them instantly). */
  updateCount: number;
  /** Requests that failed authentication (missing or wrong credentials). */
  authFailures: number;
  /** "GET /settings", "RPC Shelly.GetConfig", ... Never contains credentials or query values. */
  requests: string[];
  /** Write-only secrets the device received (mqtt_pass, ap pass), so tests can check they arrived. */
  secretsReceived: Record<string, string>;
}

interface BaseSpec {
  /** Delay before every answer, to emulate slow devices. */
  delayMs?: number;
  /** Real devices drop off the network into AP mode after a factory reset. Default true. */
  offlineAfterReset?: boolean;
  /**
   * Some real devices reboot before the reset answer leaves the socket: the reset is executed,
   * but the connection is closed without any HTTP response. Combine with `offlineAfterReset`.
   */
  dropConnectionOnReset?: boolean;
  /** Gen1 paths (e.g. "/status") or RPC methods (e.g. "Shelly.GetStatus") that answer with an error. */
  failing?: string[];
  /**
   * Called when the IP configuration of a WLAN interface changes (static: the new IP, dhcp: null).
   * Tests move their IP → host mapping here; the dev CLI lets the device answer at the new address too.
   */
  onIpChange?: (iface: 'sta' | 'sta1', ip: string | null) => void;
}

export interface Gen1Spec extends BaseSpec {
  kind: 'gen1';
  mac: string;
  type: string;
  fw?: string;
  name?: string | null;
  auth?: { username: string; password: string };
  /** Newer firmware ids offered via /ota and status.update. */
  updates?: { stable?: string; beta?: string };
  /** Shelly 2/2.5: two relays or one roller (`mode` in /settings). Default: one relay, no mode. */
  mode?: 'relay' | 'roller';
  /** Power metering with energy counter (`meters[].total`), like 1PM/2.5. */
  metering?: boolean;
}

export interface RpcSpec extends BaseSpec {
  kind: 'rpc';
  gen: 2 | 3 | 4;
  mac: string;
  model: string;
  app: string;
  /** Device id, also the digest realm. Default: "<app lowercase>-<mac lowercase>". */
  id?: string;
  ver?: string;
  fwId?: string;
  name?: string | null;
  password?: string;
  /** Older firmware does not include `name` in /shelly. */
  legacyShellyEndpoint?: boolean;
  /** Cover profile (Plus2PM): `cover:0` instead of switches. Default: switch. */
  profile?: 'switch' | 'cover';
  /** Number of switches in the switch profile. Default 1. */
  switches?: number;
  /** Power metering (`apower` in the status), like the PM models. Default true. */
  metering?: boolean;
  /** Newer firmware offered via Shelly.CheckForUpdate and sys.available_updates. */
  updates?: { stable?: { version: string; buildId: string }; beta?: { version: string; buildId: string } };
}

/** Accepts connections but never answers. */
export interface HangSpec {
  kind: 'hang';
}

/** Some other HTTP server (router, printer, ...). */
export interface ForeignSpec {
  kind: 'foreign';
}

export type MockDeviceSpec = Gen1Spec | RpcSpec | HangSpec | ForeignSpec;

export interface DeviceHandler {
  handle(req: IncomingMessage, res: ServerResponse, body: string): void;
  /** Set once a factory reset was executed (the answer may still be in flight). */
  readonly resetPending: boolean;
}

export function sendJson(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

export function sendText(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    out[key] =
      typeof existing === 'object' && existing !== null && !Array.isArray(existing) && typeof value === 'object' && value !== null && !Array.isArray(value)
        ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}
