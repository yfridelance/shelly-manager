import { randomUUID } from 'node:crypto';
import type { DeviceErrorCode } from '../shelly/errors.js';
import type { Credentials, ShellyGen } from '../shelly/types.js';

export type ScanStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface ScanDeviceResult {
  ip: string;
  mac: string;
  gen: ShellyGen;
  model: string | null;
  name: string | null;
  deviceId: string | null;
  authRequired: boolean;
  /** First time this MAC was seen. */
  created: boolean;
  /**
   * `auth_required`: protected device and no credentials given, so no config was read.
   * `foreign`: the device belongs to another site and was left untouched (see `foreignSite`).
   */
  snapshot: 'ok' | 'auth_required' | 'error' | 'foreign';
  foreignSite?: { id: number; name: string } | undefined;
  errorCode: DeviceErrorCode | null;
  error: string | null;
}

export interface ScanSummary {
  id: string;
  range: string;
  status: ScanStatus;
  total: number;
  scanned: number;
  found: number;
  /** Hosts that failed for reasons other than "no Shelly there". */
  errors: number;
  withCredentials: boolean;
  siteId: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  /** MACs set to `missing` by this scan (only for completed scans). */
  missing: string[];
}

export interface ScanDetails extends ScanSummary {
  devices: ScanDeviceResult[];
}

export type ScanEvent =
  | { type: 'progress'; scan: ScanSummary }
  | { type: 'device'; device: ScanDeviceResult }
  | { type: 'finished'; scan: ScanSummary };

export class ScanJob {
  readonly id = randomUUID();
  status: ScanStatus = 'running';
  scanned = 0;
  errors = 0;
  finishedAt: string | null = null;
  error: string | null = null;
  missing: string[] = [];
  readonly devices: ScanDeviceResult[] = [];
  readonly controller = new AbortController();
  /** Resolves when the job has finished (any final status). */
  readonly finished: Promise<void>;

  // Private field: never serialized, cleared as soon as the job ends.
  #credentials: Credentials | undefined;
  #resolveFinished!: () => void;
  readonly #listeners = new Set<(event: ScanEvent) => void>();

  constructor(
    readonly range: string,
    readonly ips: readonly string[],
    credentials: Credentials | undefined,
    readonly startedAt: string,
    readonly siteId: number = 1,
  ) {
    this.#credentials = credentials;
    this.withCredentials = credentials !== undefined;
    this.finished = new Promise((resolve) => {
      this.#resolveFinished = resolve;
    });
  }

  readonly withCredentials: boolean;

  get credentials(): Credentials | undefined {
    return this.#credentials;
  }

  subscribe(listener: (event: ScanEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: ScanEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  finish(status: Exclude<ScanStatus, 'running'>, finishedAt: string, error: string | null = null): void {
    this.#credentials = undefined;
    this.status = status;
    this.finishedAt = finishedAt;
    this.error = error;
    this.emit({ type: 'finished', scan: this.summary() });
    this.#listeners.clear();
    this.#resolveFinished();
  }

  summary(): ScanSummary {
    return {
      id: this.id,
      range: this.range,
      status: this.status,
      total: this.ips.length,
      scanned: this.scanned,
      found: this.devices.length,
      errors: this.errors,
      withCredentials: this.withCredentials,
      siteId: this.siteId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      missing: this.missing,
    };
  }

  details(): ScanDetails {
    return { ...this.summary(), devices: [...this.devices] };
  }
}
