import { ShellyHttpError, ShellyNetworkError, ShellyTimeoutError } from './errors.js';

export interface HttpRequest {
  method?: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** External cancellation (e.g. a cancelled scan). Its abort reason is rethrown unchanged. */
  signal?: AbortSignal | undefined;
}

/** fetch() against a device with a hard timeout, mapping transport failures to Shelly errors. */
export async function deviceFetch(host: string, req: HttpRequest): Promise<Response> {
  try {
    return await fetch(`http://${host}${req.path}`, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      redirect: 'manual',
      signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]) : AbortSignal.timeout(req.timeoutMs),
    });
  } catch (err) {
    if (req.signal?.aborted) throw req.signal.reason;
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new ShellyTimeoutError(host, req.timeoutMs);
    }
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    throw new ShellyNetworkError(host, `Cannot reach ${host}: ${cause?.code ?? cause?.message ?? String(err)}`, {
      cause: err,
    });
  }
}

/** Reads a JSON body; the timeout also covers a device that stalls mid-body. */
export async function readJson(host: string, res: Response, timeoutMs: number): Promise<unknown> {
  let text: string;
  try {
    text = await Promise.race([
      res.text(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new ShellyTimeoutError(host, timeoutMs)), timeoutMs).unref();
      }),
    ]);
  } catch (err) {
    if (err instanceof ShellyTimeoutError) throw err;
    throw new ShellyNetworkError(host, `Reading response from ${host} failed`, { cause: err });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ShellyHttpError(host, res.status, `${host} answered with invalid JSON`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
