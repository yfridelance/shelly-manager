import { Gen1Adapter } from './gen1-adapter.js';
import { RpcAdapter } from './rpc-adapter.js';
import type { AdapterOptions, ShellyAdapter, ShellyGen } from './types.js';

export * from './detect.js';
export * from './errors.js';
export * from './mac.js';
export * from './types.js';
export { Gen1Adapter } from './gen1-adapter.js';
export { RpcAdapter } from './rpc-adapter.js';

/** Picks the protocol by generation, as detected from `/shelly`. */
export function createAdapter(host: string, gen: ShellyGen, options: AdapterOptions = {}): ShellyAdapter {
  return gen === 1 ? new Gen1Adapter(host, options) : new RpcAdapter(host, options);
}
