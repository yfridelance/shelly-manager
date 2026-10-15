import { describe, expect, it } from 'vitest';
import { parseRpcUpdates, updatesFromStatus } from '../../src/shelly/firmware.js';

describe('updatesFromStatus', () => {
  it('reads Gen1 status.update', () => {
    expect(
      updatesFromStatus(1, { update: { status: 'idle', has_update: true, new_version: 'v1.14.1', old_version: 'v1.14.0', beta_version: 'v1.15.0-beta' } }),
    ).toEqual({ stable: 'v1.14.1', beta: 'v1.15.0-beta' });
    // Without an update new_version repeats the current version.
    expect(updatesFromStatus(1, { update: { has_update: false, new_version: 'v1.14.0', old_version: 'v1.14.0' } })).toEqual({ stable: null, beta: null });
  });

  it('reads Gen2+ sys.available_updates', () => {
    expect(updatesFromStatus(3, { sys: { available_updates: { stable: { version: '1.5.0' } } } })).toEqual({ stable: '1.5.0', beta: null });
    expect(updatesFromStatus(2, { sys: { available_updates: {} } })).toEqual({ stable: null, beta: null });
  });

  it('returns undefined when the status does not say', () => {
    expect(updatesFromStatus(1, { relays: [] })).toBeUndefined();
    expect(updatesFromStatus(2, { sys: {} })).toBeUndefined();
    expect(updatesFromStatus(4, null)).toBeUndefined();
  });

  it('parses Shelly.CheckForUpdate results', () => {
    expect(parseRpcUpdates({ beta: { version: '0.5.1', build_id: '20210610-122509/g4bbec18' } })).toEqual({ stable: null, beta: '0.5.1' });
    expect(parseRpcUpdates({})).toEqual({ stable: null, beta: null });
  });
});
