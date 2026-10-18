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

  it('has no rank for other names', () => {
    expect(floorRank('Garten')).toBeUndefined();
    expect(floorRank('Haus B')).toBeUndefined();
    expect(floorRank('1. OG 2')).toBeUndefined();
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
});
