import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/database.js';
import { getDevice, markMissing, recordFirmwareUpdates, upsertSeenDevice } from '../db/devices.js';
import { getSite } from '../db/sites.js';
import { insertSnapshot } from '../db/snapshots.js';
import { DEFAULT_PROBE_TIMEOUT_MS, probeShelly } from '../shelly/detect.js';
import { updatesFromStatus } from '../shelly/firmware.js';
import { ShellyError, describeError } from '../shelly/errors.js';
import { directHost, type HostResolver } from '../shelly/host-map.js';
import { createAdapter } from '../shelly/index.js';
import { DEFAULT_ADAPTER_TIMEOUT_MS, type Credentials, type DeviceInfo } from '../shelly/types.js';
import { forEachConcurrent } from './concurrency.js';
import { parseRange } from './ip-range.js';
import { ScanJob, type ScanDeviceResult } from './scan-job.js';

export interface ScanOptions {
  concurrency: number;
  probeTimeoutMs: number;
  adapterTimeoutMs: number;
  hostFor: HostResolver;
  maxRetainedJobs: number;
  now: () => string;
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  concurrency: 32,
  probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  adapterTimeoutMs: DEFAULT_ADAPTER_TIMEOUT_MS,
  hostFor: directHost,
  maxRetainedJobs: 20,
  now: () => new Date().toISOString(),
};

export class ScanBusyError extends Error {
  override name = 'ScanBusyError';
  constructor(readonly runningId: string) {
    super('Es läuft bereits ein Scan.');
  }
}

/** Owns scan jobs (in memory only) and runs them against the network. One scan at a time. */
export class ScanManager {
  private readonly jobs = new Map<string, ScanJob>();
  private readonly options: ScanOptions;

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    options: Partial<ScanOptions> = {},
  ) {
    this.options = { ...DEFAULT_SCAN_OPTIONS, ...options };
  }

  /** Validates the range (throws RangeParseError) and starts the job in the background. */
  /** Scans for one site: found devices are stored there; devices of other sites are only reported. */
  start(range: string, credentials?: Credentials, siteId = 1): ScanJob {
    const running = this.running();
    if (running) throw new ScanBusyError(running.id);
    const ips = parseRange(range);
    const job = new ScanJob(range.trim(), ips, credentials, this.options.now(), siteId);
    this.jobs.set(job.id, job);
    this.prune();
    void this.run(job);
    return job;
  }

  get(id: string): ScanJob | undefined {
    return this.jobs.get(id);
  }

  /** Newest first. */
  list(): ScanJob[] {
    return [...this.jobs.values()].reverse();
  }

  running(): ScanJob | undefined {
    return [...this.jobs.values()].find((j) => j.status === 'running');
  }

  /** Returns false if the job is unknown or already finished. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return false;
    job.controller.abort(new Error('scan cancelled'));
    return true;
  }

  async shutdown(): Promise<void> {
    const running = this.running();
    if (!running) return;
    this.cancel(running.id);
    await running.finished;
  }

  private async run(job: ScanJob): Promise<void> {
    const { signal } = job.controller;
    try {
      await forEachConcurrent(job.ips, this.options.concurrency, (ip) => this.scanHost(job, ip), signal);
      if (signal.aborted) {
        job.finish('cancelled', this.options.now());
        return;
      }
      job.missing = markMissing(this.db, new Set(job.ips), new Set(job.devices.map((d) => d.mac)), job.siteId);
      job.finish('done', this.options.now());
    } catch (err) {
      this.log.error({ err, scanId: job.id }, 'scan failed');
      job.finish('failed', this.options.now(), err instanceof Error ? err.message : String(err));
    }
  }

  /** Never throws: a failing host must not abort the scan. */
  private async scanHost(job: ScanJob, ip: string): Promise<void> {
    const host = this.options.hostFor(ip);
    let info: DeviceInfo | undefined;
    try {
      info = await probeShelly(host, this.options.probeTimeoutMs, job.controller.signal);
    } catch (err) {
      if (!job.controller.signal.aborted && !(err instanceof ShellyError)) {
        job.errors++;
        this.log.warn({ err, ip }, 'unexpected error while probing');
      }
      // Timeouts, refused connections and non-Shelly servers are the normal case in a scan.
    }
    if (job.controller.signal.aborted) return;
    job.scanned++;

    if (info) {
      const result = await this.collect(job, ip, host, info);
      if (result.errorCode) job.errors++;
      job.devices.push(result);
      job.emit({ type: 'device', device: result });
    }
    job.emit({ type: 'progress', scan: job.summary() });
  }

  /** Reads name/config/status where allowed, upserts the device and stores a snapshot. */
  private async collect(job: ScanJob, ip: string, host: string, info: DeviceInfo): Promise<ScanDeviceResult> {
    const result: ScanDeviceResult = {
      ip,
      mac: info.mac,
      gen: info.gen,
      model: info.model,
      name: info.name,
      deviceId: info.deviceId,
      authRequired: info.authRequired,
      created: false,
      snapshot: 'auth_required',
      errorCode: null,
      error: null,
    };

    // A device of another site is reported, not read: no credentials of this site go to it.
    const known = getDevice(this.db, info.mac);
    if (known && known.site_id !== job.siteId) {
      result.snapshot = 'foreign';
      result.foreignSite = { id: known.site_id, name: getSite(this.db, known.site_id)?.name ?? String(known.site_id) };
      return result;
    }

    let snapshot: { config: unknown; status: unknown } | undefined;
    const credentials = info.authRequired ? job.credentials : undefined;
    if (!info.authRequired || credentials) {
      try {
        const adapter = createAdapter(host, info.gen, { credentials, timeoutMs: this.options.adapterTimeoutMs });
        const full = await adapter.getInfo();
        result.name = full.name;
        result.deviceId = full.deviceId;
        snapshot = { config: await adapter.getConfig(), status: await adapter.getStatus() };
        result.snapshot = 'ok';
      } catch (err) {
        const { code, message } = describeError(err);
        result.snapshot = 'error';
        result.errorCode = code;
        result.error = message;
      }
    }

    try {
      const now = this.options.now();
      this.db.transaction(() => {
        result.created = upsertSeenDevice(this.db, { ...info, name: result.name, deviceId: result.deviceId }, ip, now, job.siteId).created;
        if (snapshot) {
          insertSnapshot(this.db, { mac: info.mac, takenAt: now, info: info.raw, ...snapshot });
          const updates = updatesFromStatus(info.gen, snapshot.status);
          if (updates) recordFirmwareUpdates(this.db, info.mac, updates, now);
        }
      })();
    } catch (err) {
      this.log.error({ err, ip, mac: info.mac }, 'storing scan result failed');
      result.errorCode = 'internal';
      result.error = err instanceof Error ? err.message : String(err);
    }
    return result;
  }

  private prune(): void {
    const finished = [...this.jobs.values()].filter((j) => j.status !== 'running');
    for (const job of finished.slice(0, Math.max(0, this.jobs.size - this.options.maxRetainedJobs))) {
      this.jobs.delete(job.id);
    }
  }
}
