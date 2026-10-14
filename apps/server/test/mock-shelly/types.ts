import type { IncomingMessage, ServerResponse } from 'node:http';

export interface MockDeviceState {
  online: boolean;
  rebootCount: number;
  factoryResetCount: number;
  /** Requests that failed authentication (missing or wrong credentials). */
  authFailures: number;
  /** "GET /settings", "RPC Shelly.GetConfig", ... Never contains credentials. */
  requests: string[];
}

interface BaseSpec {
  /** Delay before every answer, to emulate slow devices. */
  delayMs?: number;
  /** Real devices drop off the network into AP mode after a factory reset. Default true. */
  offlineAfterReset?: boolean;
  /** Gen1 paths (e.g. "/status") or RPC methods (e.g. "Shelly.GetStatus") that answer with an error. */
  failing?: string[];
}

export interface Gen1Spec extends BaseSpec {
  kind: 'gen1';
  mac: string;
  type: string;
  fw?: string;
  name?: string | null;
  auth?: { username: string; password: string };
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
  /** Called after a factory reset answer was sent. */
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
