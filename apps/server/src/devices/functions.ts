/**
 * What a device does, derived from its raw config and status (newest snapshot): outputs by kind,
 * energy meters, inputs and sensors, and whether it measures power. Never asks the device itself.
 */
export interface DeviceFunctions {
  switch: number;
  cover: number;
  light: number;
  /** Dedicated energy meter channels (Gen1 `emeters`, Gen2+ `em`/`em1`/`pm1`). */
  meter: number;
  input: number;
  sensor: number;
  /** Measures power: an output with power metering or a dedicated energy meter. */
  metering: boolean;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arrayLength = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Gen2+ component keys (`switch:0`, `cover:1` …) by type. */
function countComponents(config: Obj, types: readonly string[]): number {
  return Object.keys(config).filter((key) => types.includes(key.split(':')[0] ?? '')).length;
}

const RPC_LIGHT = ['light', 'rgb', 'rgbw', 'cct', 'rgbcct'];
const RPC_METER = ['em', 'em1', 'pm1'];
const RPC_SENSOR = ['temperature', 'humidity', 'illuminance', 'smoke', 'flood', 'voltmeter'];

function rpcFunctions(config: Obj, status: unknown): DeviceFunctions {
  const meter = countComponents(config, RPC_METER);
  // Only the PM variants report `apower` in the status of switch/cover/light (official Gen2 docs).
  const outputMetering =
    isObj(status) &&
    Object.entries(status).some(
      ([key, value]) => ['switch', 'cover', ...RPC_LIGHT].includes(key.split(':')[0] ?? '') && isObj(value) && typeof value['apower'] === 'number',
    );
  return {
    switch: countComponents(config, ['switch']),
    cover: countComponents(config, ['cover']),
    light: countComponents(config, RPC_LIGHT),
    meter,
    input: countComponents(config, ['input']),
    sensor: countComponents(config, RPC_SENSOR),
    metering: meter > 0 || outputMetering,
  };
}

function gen1Functions(settings: Obj, status: unknown): DeviceFunctions {
  // Shelly 2/2.5 list both `relays` and `rollers` in /settings; `mode` says which is active (Gen1 docs).
  const roller = settings['mode'] === 'roller';
  const st = isObj(status) ? status : {};
  const meter = arrayLength(st['emeters']);
  // A plain Shelly 1 reports `meters` with only power/is_valid (a configured constant); real metering
  // devices also have the energy counter `total` (Gen1 docs, Shelly1/1PM status).
  const outputMetering = Array.isArray(st['meters']) && st['meters'].some((m) => isObj(m) && typeof m['total'] === 'number');
  const switches = roller ? 0 : arrayLength(settings['relays']);
  const covers = roller ? Math.max(1, arrayLength(settings['rollers'])) : 0;
  const lights = arrayLength(settings['lights']);
  // Dedicated sensors (H&T, Flood, Smoke, Door/Window …); relay devices only report their own `tmp`.
  const sensor = ['hum', 'flood', 'smoke', 'lux', 'sensor'].some((k) => k in st) || ('tmp' in st && switches + covers + lights === 0) ? 1 : 0;
  return {
    switch: switches,
    cover: covers,
    light: lights,
    meter,
    input: arrayLength(st['inputs']),
    sensor,
    metering: meter > 0 || outputMetering,
  };
}

/** Null when the config is unknown (e.g. protected device read without credentials). */
export function deriveFunctions(gen: number, config: unknown, status: unknown): DeviceFunctions | null {
  if (!isObj(config)) return null;
  return gen === 1 ? gen1Functions(config, status) : rpcFunctions(config, status);
}

/** German summary for exports, e.g. "2× Schalter · Messung" (the web UI has its own copy in core/texts). */
export function describeFunctions(f: DeviceFunctions | null): string {
  if (!f) return '';
  const n = (count: number, label: string): string[] => (count === 0 ? [] : [count > 1 ? `${count}× ${label}` : label]);
  const outputs = f.switch + f.cover + f.light;
  const parts = [
    ...n(f.cover, 'Rollladen'),
    ...n(f.switch, 'Schalter'),
    ...n(f.light, 'Licht'),
    ...(f.meter > 0 ? ['Energiezähler'] : []),
    ...n(f.sensor, 'Sensor'),
    // Inputs only describe the device when it has nothing else (i3, Plus i4).
    ...(outputs + f.meter + f.sensor === 0 ? n(f.input, 'Eingang') : []),
  ];
  if (f.metering && f.meter === 0) parts.push('Messung');
  return parts.join(' · ');
}
