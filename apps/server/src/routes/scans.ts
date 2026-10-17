import { Type, type Static } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { RangeParseError } from '../scan/ip-range.js';
import { ScanBusyError, type ScanManager } from '../scan/scan-manager.js';
import type { ScanEvent } from '../scan/scan-job.js';
import type { Db } from '../db/database.js';
import { getSite } from '../db/sites.js';
import { SiteQuery } from './sites.js';

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);

const ScanStatus = Type.Union([Type.Literal('running'), Type.Literal('done'), Type.Literal('failed'), Type.Literal('cancelled')]);

export const ScanSummarySchema = Type.Object({
  id: Type.String(),
  range: Type.String(),
  status: ScanStatus,
  total: Type.Integer(),
  scanned: Type.Integer(),
  found: Type.Integer(),
  errors: Type.Integer(),
  withCredentials: Type.Boolean(),
  siteId: Type.Integer(),
  startedAt: Type.String(),
  finishedAt: Nullable(Type.String()),
  error: Nullable(Type.String()),
  missing: Type.Array(Type.String()),
});

export const ScanDeviceResultSchema = Type.Object({
  ip: Type.String(),
  mac: Type.String(),
  gen: Type.Integer(),
  model: Nullable(Type.String()),
  name: Nullable(Type.String()),
  deviceId: Nullable(Type.String()),
  authRequired: Type.Boolean(),
  created: Type.Boolean(),
  snapshot: Type.Union([Type.Literal('ok'), Type.Literal('auth_required'), Type.Literal('error'), Type.Literal('foreign')]),
  foreignSite: Type.Optional(Type.Object({ id: Type.Integer(), name: Type.String() })),
  errorCode: Nullable(Type.String()),
  error: Nullable(Type.String()),
});

export const ScanDetailsSchema = Type.Intersect([ScanSummarySchema, Type.Object({ devices: Type.Array(ScanDeviceResultSchema) })]);

const StartScanBody = Type.Object(
  {
    range: Type.String({ minLength: 1, maxLength: 100 }),
    /** Site the found devices belong to (default 1). */
    siteId: Type.Optional(Type.Integer({ minimum: 1 })),
    // Held in memory for the duration of the scan only; never stored or logged.
    credentials: Type.Optional(
      Type.Object(
        { username: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })), password: Type.String({ minLength: 1, maxLength: 256 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type StartScanBody = Static<typeof StartScanBody>;

const ErrorBody = Type.Object({ error: Type.String(), message: Type.String(), runningId: Type.Optional(Type.String()) });
const IdParams = Type.Object({ id: Type.String() });

export const scanRoutes: FastifyPluginAsyncTypebox<{ scans: ScanManager; db: Db }> = async (app, { scans, db }) => {
  app.post(
    '/scans',
    { schema: { body: StartScanBody, response: { 202: ScanSummarySchema, 400: ErrorBody, 409: ErrorBody } } },
    async (request, reply) => {
      const { range, credentials, siteId = 1 } = request.body;
      if (!getSite(db, siteId)) return reply.code(400).send({ error: 'site_not_found', message: 'Standort nicht gefunden.' });
      try {
        const job = scans.start(range, credentials ? { username: credentials.username, password: credentials.password } : undefined, siteId);
        return reply.code(202).send(job.summary());
      } catch (err) {
        if (err instanceof RangeParseError) return reply.code(400).send({ error: 'invalid_range', message: err.message });
        if (err instanceof ScanBusyError) {
          return reply.code(409).send({ error: 'scan_running', message: err.message, runningId: err.runningId });
        }
        throw err;
      }
    },
  );

  app.get('/scans', { schema: { querystring: SiteQuery, response: { 200: Type.Array(ScanSummarySchema) } } }, async (request) =>
    scans
      .list()
      .filter((j) => request.query.site === undefined || j.siteId === request.query.site)
      .map((j) => j.summary()),
  );

  app.get(
    '/scans/:id',
    { schema: { params: IdParams, response: { 200: ScanDetailsSchema, 404: ErrorBody } } },
    async (request, reply) => {
      const job = scans.get(request.params.id);
      if (!job) return reply.code(404).send({ error: 'not_found', message: 'Scan nicht gefunden.' });
      return job.details();
    },
  );

  app.delete(
    '/scans/:id',
    { schema: { params: IdParams, response: { 202: ScanSummarySchema, 404: ErrorBody, 409: ErrorBody } } },
    async (request, reply) => {
      const job = scans.get(request.params.id);
      if (!job) return reply.code(404).send({ error: 'not_found', message: 'Scan nicht gefunden.' });
      if (!scans.cancel(job.id)) return reply.code(409).send({ error: 'not_running', message: 'Der Scan läuft nicht mehr.' });
      return reply.code(202).send(job.summary());
    },
  );

  // Server-Sent Events: "snapshot" (full details) first, then "progress" / "device" / "finished".
  app.get('/scans/:id/events', { schema: { params: IdParams } }, async (request, reply) => {
    const job = scans.get(request.params.id);
    if (!job) return reply.code(404).send({ error: 'not_found', message: 'Scan nicht gefunden.' });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const write = (event: string, data: unknown): void => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    write('snapshot', job.details());
    if (job.status !== 'running') {
      write('finished', job.summary());
      raw.end();
      return;
    }

    const unsubscribe = job.subscribe((event: ScanEvent) => {
      write(event.type, event.type === 'device' ? event.device : event.scan);
      if (event.type === 'finished') raw.end();
    });
    request.raw.on('close', unsubscribe);
  });
};
