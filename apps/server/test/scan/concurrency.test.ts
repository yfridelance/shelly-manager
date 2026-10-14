import { describe, expect, it } from 'vitest';
import { forEachConcurrent } from '../../src/scan/concurrency.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('forEachConcurrent', () => {
  it('never runs more than `limit` workers at once and processes every item', async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachConcurrent(Array.from({ length: 50 }, (_, i) => i), 7, async (i) => {
      active++;
      peak = Math.max(peak, active);
      await tick(1 + (i % 3));
      seen.push(i);
      active--;
    });
    expect(peak).toBe(7);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('stops taking new items after abort', async () => {
    const controller = new AbortController();
    let started = 0;
    await forEachConcurrent(Array.from({ length: 100 }, (_, i) => i), 4, async () => {
      started++;
      if (started === 10) controller.abort();
      await tick(1);
    }, controller.signal);
    expect(started).toBeLessThan(15);
  });

  it('handles empty input', async () => {
    await expect(forEachConcurrent([], 32, async () => {})).resolves.toBeUndefined();
  });
});
