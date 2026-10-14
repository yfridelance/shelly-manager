/**
 * Runs `worker` for every item with at most `limit` in flight. Stops taking new items once
 * `signal` is aborted; items already running are awaited. Worker errors must be handled by the worker.
 */
export async function forEachConcurrent<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (!signal?.aborted && next < items.length) {
      const item = items[next++] as T;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
