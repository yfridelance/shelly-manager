import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Gen1Device } from './gen1.js';
import { RpcDevice } from './rpc.js';
import { sendText, type DeviceHandler, type MockDeviceSpec, type MockDeviceState } from './types.js';

export * from './types.js';

export interface MockDevice {
  spec: MockDeviceSpec;
  /** "127.0.0.1:<port>", usable as adapter host. */
  host: string;
  port: number;
  state: MockDeviceState;
  /** Gen2+ only: forget issued nonces to provoke a stale challenge. */
  expireNonces(): void;
  stop(): Promise<void>;
}

export interface MockFleet {
  devices: MockDevice[];
  close(): Promise<void>;
}

/** Starts one HTTP server per device on 127.0.0.1 with an ephemeral port. */
export async function startMockDevice(spec: MockDeviceSpec): Promise<MockDevice> {
  const state: MockDeviceState = { online: true, rebootCount: 0, factoryResetCount: 0, authFailures: 0, requests: [] };
  const handler: DeviceHandler | undefined =
    spec.kind === 'gen1' ? new Gen1Device(spec, state) : spec.kind === 'rpc' ? new RpcDevice(spec, state) : undefined;
  const delayMs = spec.kind === 'gen1' || spec.kind === 'rpc' ? (spec.delayMs ?? 0) : 0;
  const offlineAfterReset = spec.kind === 'gen1' || spec.kind === 'rpc' ? (spec.offlineAfterReset ?? true) : false;

  let server: Server;
  const stop = async (): Promise<void> => {
    state.online = false;
    if (!server.listening) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  };

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (spec.kind === 'hang') return; // never answer
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const respond = (): void => {
        if (spec.kind === 'foreign') {
          sendText(res, 200, '<html><body>Router login</body></html>', { 'Content-Type': 'text/html' });
          return;
        }
        handler?.handle(req, res, Buffer.concat(chunks).toString('utf8'));
        if (handler?.resetPending && offlineAfterReset) {
          // Like a real device: answer, then reboot into AP mode and vanish from the network.
          res.on('finish', () => void stop());
        }
      };
      if (delayMs > 0) setTimeout(respond, delayMs);
      else respond();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    spec,
    host: `127.0.0.1:${port}`,
    port,
    state,
    expireNonces: () => {
      if (handler instanceof RpcDevice) handler.expireNonces();
    },
    stop,
  };
}

export async function startMockFleet(specs: MockDeviceSpec[]): Promise<MockFleet> {
  const devices = await Promise.all(specs.map(startMockDevice));
  return {
    devices,
    close: async () => {
      await Promise.all(devices.map((d) => d.stop()));
    },
  };
}

/** A small mixed fleet: Gen1 with/without Basic auth, Gen2/3/4 with/without Digest auth. */
export const DEFAULT_FLEET: MockDeviceSpec[] = [
  { kind: 'gen1', mac: 'E868E7A1B2C3', type: 'SHSW-1', name: 'Licht Keller' },
  { kind: 'gen1', mac: 'E868E7D4E5F6', type: 'SHSW-25', name: 'Storen Wohnzimmer', auth: { username: 'admin', password: 'gen1-secret' } },
  { kind: 'rpc', gen: 2, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler' },
  { kind: 'rpc', gen: 2, mac: 'A8032AB67890', model: 'SNSW-102P16EU', app: 'Plus2PM', name: 'Rollladen Büro', password: 'gen2-secret' },
  { kind: 'rpc', gen: 3, mac: '34CDB0A1A1A1', model: 'S3SW-001X16EU', app: 'Mini1G3', name: null, legacyShellyEndpoint: true },
  { kind: 'rpc', gen: 4, mac: '7C2C67B2B2B2', model: 'S4SW-001P16EU', app: 'S1PMG4', name: 'Garage', password: 'gen4-secret' },
];
