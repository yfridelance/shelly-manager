import type { Device } from './api.types';
import { suggestDeviceName } from './device-name';
import { compareFloor, floorRank } from './floor';

const d = (over: Partial<Device>) => ({ mac: 'A', floor: null, location: null, kind: null, name: null, ...over }) as Device;

describe('suggestDeviceName', () => {
  it('joins floor, location and kind and skips empty parts', () => {
    expect(suggestDeviceName(d({ floor: 'EG', location: 'Küche', kind: 'Licht' }), [])).toBe('EG Küche Licht');
    expect(suggestDeviceName(d({ location: ' Keller ', kind: 'Boiler' }), [])).toBe('Keller Boiler');
    expect(suggestDeviceName(d({}), [])).toBeNull();
  });

  it('numbers duplicates within the site, ignoring the device itself', () => {
    const me = d({ mac: 'ME', location: 'Keller', kind: 'Licht', name: 'Keller Licht' });
    expect(suggestDeviceName(me, [me])).toBe('Keller Licht');
    const others = [d({ mac: 'B', name: 'keller licht' }), d({ mac: 'C', name: 'Keller Licht 2' })];
    expect(suggestDeviceName(me, [me, ...others])).toBe('Keller Licht 3');
  });
});

describe('compareFloor', () => {
  it('sorts floors in building order, unknown names after', () => {
    const floors = ['Garten', 'DG', '1. OG', 'UG', 'EG', 'OG', 'KG'];
    expect(floors.sort((a, b) => compareFloor(a, b, (x, y) => x.localeCompare(y)))).toEqual([
      'KG', 'UG', 'EG', '1. OG', 'OG', 'DG', 'Garten',
    ]);
  });

  it('sorts English floor names in building order', () => {
    const floors = ['Garden', 'Attic', 'Floor 2', '1st floor', 'Ground floor', 'Basement', '2nd basement', '3F'];
    expect(floors.sort((a, b) => compareFloor(a, b, (x, y) => x.localeCompare(y)))).toEqual([
      '2nd basement', 'Basement', 'Ground floor', '1st floor', 'Floor 2', '3F', 'Attic', 'Garden',
    ]);
  });

  it('matches the server rules', () => {
    expect(floorRank('First floor')).toBe(1);
    expect(floorRank('B2')).toBe(-2);
    expect(floorRank('Floor')).toBeUndefined();
  });
});
