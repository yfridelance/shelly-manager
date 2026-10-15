import { diffJson, formatDiffValue } from './json-diff';

describe('diffJson', () => {
  it('finds changed, added and removed leaves with readable paths', () => {
    const before = { sys: { device: { name: 'Boiler', eco_mode: false } }, 'switch:0': { auto_off: false }, mqtt: { enable: false } };
    const after = { sys: { device: { name: 'Warmwasser', eco_mode: false } }, 'switch:0': { auto_off: true }, ws: { enable: true } };
    expect(diffJson(before, after)).toEqual([
      { path: 'mqtt', kind: 'removed', before: { enable: false } },
      { path: 'switch:0.auto_off', kind: 'changed', before: false, after: true },
      { path: 'sys.device.name', kind: 'changed', before: 'Boiler', after: 'Warmwasser' },
      { path: 'ws', kind: 'added', after: { enable: true } },
    ]);
  });

  it('compares arrays by index and quotes odd keys', () => {
    expect(diffJson({ relays: [{ ison: false }, { ison: true }] }, { relays: [{ ison: true }] })).toEqual([
      { path: 'relays[0].ison', kind: 'changed', before: false, after: true },
      { path: 'relays[1]', kind: 'removed', before: { ison: true } },
    ]);
    expect(diffJson({ 'a b': 1 }, { 'a b': 2 })).toEqual([{ path: '["a b"]', kind: 'changed', before: 1, after: 2 }]);
  });

  it('reports a type change as one change and nothing for equal values', () => {
    expect(diffJson({ a: { b: 1 } }, { a: null })).toEqual([{ path: 'a', kind: 'changed', before: { b: 1 }, after: null }]);
    expect(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
    expect(diffJson(null, { a: 1 })).toEqual([{ path: '', kind: 'changed', before: null, after: { a: 1 } }]);
  });

  it('formats values compactly', () => {
    expect(formatDiffValue('x')).toBe('"x"');
    expect(formatDiffValue(null)).toBe('null');
    expect(formatDiffValue(undefined)).toBe('');
    expect(formatDiffValue({ a: 'y'.repeat(300) })).toHaveLength(198);
  });
});
