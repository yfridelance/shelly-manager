// Starts the default mock fleet on fixed ports for manual testing:
//   npm run mock -w apps/server
// and run the server with SHELLY_HOST_MAP=10.99.0.0/24=127.0.0.1:18000 (see `npm run dev:mock`),
// then scan 10.99.0.0/24 in the UI. 10.99.0.N maps to port 18000+N (base port: MOCK_BASE_PORT).
import { DEFAULT_FLEET, startMockDevice, type MockDevice, type MockDeviceSpec } from './index.js';

// MOCK_BASE_PORT lets a second fleet run next to `npm run dev:mock` (e.g. for the docs screenshots).
const BASE_PORT = Number(process.env['MOCK_BASE_PORT'] ?? 18000);
const specs: MockDeviceSpec[] = [...DEFAULT_FLEET, { kind: 'hang' }, { kind: 'foreign' }];

const devices: MockDevice[] = [];
for (const [i, spec] of specs.entries()) {
  // A static IP 10.99.0.N makes the device answer on port 18000+N as well (SHELLY_HOST_MAP convention).
  const withHook: MockDeviceSpec =
    spec.kind === 'gen1' || spec.kind === 'rpc'
      ? {
          ...spec,
          onIpChange: (_iface, ip) => {
            const last = ip?.startsWith('10.99.0.') ? Number(ip.split('.')[3]) : NaN;
            if (Number.isInteger(last) && last > 0 && last < 255) {
              void devices[i]?.listenAlso(BASE_PORT + last).then(
                () => console.log(`  ${spec.mac} antwortet jetzt auch unter 10.99.0.${last}`),
                () => console.log(`  ${spec.mac}: Port ${BASE_PORT + last} belegt`),
              );
            }
          },
        }
      : spec;
  devices.push(await startMockDevice(withHook, BASE_PORT + i + 1));
}

console.log('Mock-Shelly-Fleet läuft:');
for (const [i, d] of devices.entries()) {
  const s = d.spec;
  const label =
    s.kind === 'gen1'
      ? `Gen1 ${s.type} ${s.mac}${s.auth ? ` (Basic: ${s.auth.username}/${s.auth.password})` : ''}`
      : s.kind === 'rpc'
        ? `Gen${s.gen} ${s.app} ${s.mac}${s.password ? ` (Digest: admin/${s.password})` : ''}`
        : s.kind === 'hang'
          ? 'antwortet nie (Timeout)'
          : 'fremder HTTP-Server';
  console.log(`  10.99.0.${i + 1}  ->  ${d.host}  ${label}`);
}
console.log(`\nServer starten mit: SHELLY_HOST_MAP=10.99.0.0/24=127.0.0.1:${BASE_PORT}`);

const shutdown = (): void => {
  void Promise.all(devices.map((d) => d.stop())).then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
