import { describe, expect, it } from 'vitest';
import { compareFloor, floorRank } from '../../src/devices/floor.js';

const collator = new Intl.Collator('de-CH', { numeric: true, sensitivity: 'base' });

describe('floorRank', () => {
  it('knows the usual Swiss/German floor names', () => {
    expect(floorRank('2. UG')).toBe(-2);
    expect(floorRank('UG')).toBe(-1);
    expect(floorRank('KG')).toBe(-1);
    expect(floorRank('Keller')).toBe(-1);
    expect(floorRank('EG')).toBe(0);
    expect(floorRank('Erdgeschoss')).toBe(0);
    expect(floorRank('OG')).toBe(1);
    expect(floorRank('1. OG')).toBe(1);
    expect(floorRank('2.OG')).toBe(2);
    expect(floorRank('og 3')).toBe(3);
    expect(floorRank('2. Obergeschoss')).toBe(2);
    expect(floorRank('DG')).toBe(1000);
    expect(floorRank('Estrich')).toBe(1000);
  });

  it('knows English floor names', () => {
    expect(floorRank('2nd basement')).toBe(-2);
    expect(floorRank('Basement 2')).toBe(-2);
    expect(floorRank('B2')).toBe(-2);
    expect(floorRank('b 1')).toBe(-1);
    expect(floorRank('Basement')).toBe(-1);
    expect(floorRank('Cellar')).toBe(-1);
    expect(floorRank('Lower ground floor')).toBe(-0.5);
    expect(floorRank('LG')).toBe(-0.5);
    expect(floorRank('Ground floor')).toBe(0);
    expect(floorRank('GF')).toBe(0);
    expect(floorRank('Ground')).toBe(0);
    expect(floorRank('1st floor')).toBe(1);
    expect(floorRank('First Floor')).toBe(1);
    expect(floorRank('2nd floor')).toBe(2);
    expect(floorRank('3rd storey')).toBe(3);
    expect(floorRank('11th floor')).toBe(11);
    expect(floorRank('Floor 2')).toBe(2);
    expect(floorRank('Level 3')).toBe(3);
    expect(floorRank('2F')).toBe(2);
    expect(floorRank('L2')).toBe(2);
    expect(floorRank('Attic')).toBe(1000);
    expect(floorRank('Loft')).toBe(1000);
  });

  it('has no rank for other names', () => {
    expect(floorRank('Garten')).toBeUndefined();
    expect(floorRank('Haus B')).toBeUndefined();
    expect(floorRank('1. OG 2')).toBeUndefined();
    expect(floorRank('Floor')).toBeUndefined();
    expect(floorRank('Level')).toBeUndefined();
    expect(floorRank('First')).toBeUndefined();
    expect(floorRank('B')).toBeUndefined();
    expect(floorRank('Basement 0')).toBeUndefined();
    expect(floorRank('Garden')).toBeUndefined();
    expect(floorRank('')).toBeUndefined();
    expect(floorRank(null)).toBeUndefined();
  });
});

describe('compareFloor', () => {
  it('sorts in building order, unknown names alphabetically after, empty last', () => {
    const floors = ['DG', null, 'Garten', '1. OG', 'EG', 'Aussen', 'UG', '2. OG', '2. UG', ''];
    expect(floors.sort((a, b) => compareFloor(a, b, collator.compare))).toEqual([
      '2. UG',
      'UG',
      'EG',
      '1. OG',
      '2. OG',
      'DG',
      'Aussen',
      'Garten',
      null,
      '',
    ]);
  });

  it('sorts English names in building order', () => {
    const floors = ['Attic', 'Garden', '2nd floor', 'Ground floor', 'Basement', '1st floor', 'B2', 'Floor 3'];
    expect(floors.sort((a, b) => compareFloor(a, b, collator.compare))).toEqual([
      'B2',
      'Basement',
      'Ground floor',
      '1st floor',
      '2nd floor',
      'Floor 3',
      'Attic',
      'Garden',
    ]);
  });
});
