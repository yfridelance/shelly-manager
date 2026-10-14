import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply } from 'fastify';
import type { Db } from '../db/database.js';
import { getDevice, listDevices, updateLocalFields, type DeviceListRow } from '../db/devices.js';
import { getLatestSnapshot, getSnapshot, listSnapshotMeta, type SnapshotRow } from '../db/snapshots.js';
import { DeviceActionError, type DeviceService } from '../devices/device-service.js';
import { normalizeMac } from '../shelly/mac.js';

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);

export const DeviceSchema = Type.Object({
  mac: Type.String(),
  ip: Nullable(Type.String()),
  gen: Type.Integer(),
  model: Nullable(Type.String()),
  app: Nullable(Type.String()),
  firmware: Nullable(Type.String()),
  /** Local display name (falls back to the device's own name). */
  name: Nullable(Type.String()),
  deviceName: Nullable(Type.String()),
  authRequired: Type.Boolean(),
  location: Nullable(Type.String()),
  notes: Nullable(Type.String()),
  state: Type.Union([Type.Literal('active'), Type.Literal('reset'), Type.Literal('missing')]),
  firstSeen: Type.String(),
  lastSeen: Type.String(),
  lastSnapshotAt: Nullable(Type.String()),
});

export const SnapshotSchema = Type.Object({
  id: Type.Integer(),
  takenAt: Type.String(),
  // Raw device answers, unchanged.
  info: Type.Unknown(),
  config: Type.Unknown(),
  status: Type.Unknown(),
});

const SnapshotMetaSchema = Type.Object({ id: Type.Integer(), takenAt: Type.String(), hasConfig: Type.Boolean() });

const DeviceDetailsSchema = Type.Object({
  device: DeviceSchema,
  latestSnapshot: Nullable(SnapshotSchema),
  snapshots: Type.Array(SnapshotMetaSchema),
});

const ErrorBody = Type.Object({ error: Type.String(), message: Type.String(), cause: Type.Optional(Type.String()) });
const MacParams = Type.Object({ mac: Type.String({ maxLength: 32 }) });
const LocalText = (maxLength: number) => Type.Optional(Nullable(Type.String({ maxLength })));

const PatchBody = Type.Object(
  { name: LocalText(200), location: LocalText(200), notes: LocalText(10_000) },
  { additionalProperties: false },
);

// In memory for one request only; never stored or logged.
const CredentialsSchema = Type.Optional(
  Type.Object(
    { username: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })), password: Type.String({ minLength: 1, maxLength: 256 }) },
    { additionalProperties: false },
  ),
);

const CredentialsBody = Type.Object({ credentials: CredentialsSchema }, { additionalProperties: false });

const FactoryResetBody = Type.Object(
  {
    /** Must equal :mac. A single string: there is deliberately no way to reset several devices at once. */
    confirmMac: Type.String({ minLength: 1, maxLength: 32 }),
    credentials: CredentialsSchema,
    /** Explicit override when the automatic pre-reset snapshot fails. */
    allowWithoutSnapshot: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export function toDeviceDto(row: DeviceListRow) {
  return {
    mac: row.mac,
    ip: row.ip,
    gen: row.gen,
    model: row.model,
    app: row.app,
    firmware: row.firmware,
    name: row.name ?? row.device_name,
    deviceName: row.device_name,
    authRequired: row.auth_required === 1,
    location: row.location,
    notes: row.notes,
    state: row.state,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastSnapshotAt: row.last_snapshot_at,
  };
}

function toSnapshotDto(row: SnapshotRow) {
  const parse = (json: string | null): unknown => (json === null ? null : JSON.parse(json));
  return { id: row.id, takenAt: row.taken_at, info: parse(row.info_json), config: parse(row.config_json), status: parse(row.status_json) };
}

const CONFLICT_CODES = new Set(['no_ip', 'mac_mismatch', 'busy', 'snapshot_failed']);

/** Maps device action failures to HTTP: 404 unknown, 400 wrong confirmation, 409 refused by a safety check, 502 device error. */
export function sendDeviceError(reply: FastifyReply, err: unknown): FastifyReply {
  if (!(err instanceof DeviceActionError)) throw err;
  const status =
    err.code === 'not_found' ? 404 : err.code === 'confirm_mismatch' ? 400 : CONFLICT_CODES.has(err.code) ? 409 : 502;
  return reply.code(status).send({ error: err.code, message: err.message, ...(err.causeCode ? { cause: err.causeCode } : {}) });
}

export const deviceRoutes: FastifyPluginAsyncTypebox<{ db: Db; devices: DeviceService }> = async (app, { db, devices }) => {
  // MACs in URLs may come with separators or lowercase; normalize, reject garbage.
  const macOf = (raw: string, reply: FastifyReply): string | undefined => {
    try {
      return normalizeMac(raw);
    } catch {
      void reply.code(400).send({ error: 'invalid_mac', message: `Ungültige MAC-Adresse: ${raw}` });
      return undefined;
    }
  };
  const notFound = (reply: FastifyReply, mac: string) =>
    reply.code(404).send({ error: 'not_found', message: `Gerät ${mac} ist nicht im Inventar.` });

  app.get('/devices', { schema: { response: { 200: Type.Array(DeviceSchema) } } }, async () => listDevices(db).map(toDeviceDto));

  app.get(
    '/devices/:mac',
    { schema: { params: MacParams, response: { 200: DeviceDetailsSchema, 400: ErrorBody, 404: ErrorBody } } },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      const device = getDevice(db, mac);
      if (!device) return notFound(reply, mac);
      const latest = getLatestSnapshot(db, mac);
      return {
        device: toDeviceDto(device),
        latestSnapshot: latest ? toSnapshotDto(latest) : null,
        snapshots: listSnapshotMeta(db, mac).map((s) => ({ id: s.id, takenAt: s.taken_at, hasConfig: s.has_config === 1 })),
      };
    },
  );

  app.get(
    '/devices/:mac/snapshots/:id',
    {
      schema: {
        params: Type.Object({ mac: Type.String({ maxLength: 32 }), id: Type.Integer() }),
        response: { 200: SnapshotSchema, 400: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      const snapshot = getSnapshot(db, mac, request.params.id);
      if (!snapshot) return reply.code(404).send({ error: 'not_found', message: 'Snapshot nicht gefunden.' });
      return toSnapshotDto(snapshot);
    },
  );

  app.patch(
    '/devices/:mac',
    { schema: { params: MacParams, body: PatchBody, response: { 200: DeviceSchema, 400: ErrorBody, 404: ErrorBody } } },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      if (!updateLocalFields(db, mac, request.body)) return notFound(reply, mac);
      const device = getDevice(db, mac);
      return device ? toDeviceDto(device) : notFound(reply, mac);
    },
  );

  app.post(
    '/devices/:mac/snapshot',
    {
      schema: {
        params: MacParams,
        body: CredentialsBody,
        response: { 201: SnapshotSchema, 400: ErrorBody, 404: ErrorBody, 409: ErrorBody, 502: ErrorBody },
      },
      // A POST without body means "no credentials".
      preValidation: async (request) => {
        request.body ??= {};
      },
    },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      try {
        const id = await devices.takeSnapshot(mac, request.body.credentials, { requestedBy: request.ip });
        const snapshot = getSnapshot(db, mac, id);
        if (!snapshot) throw new Error(`Snapshot ${id} vanished right after insert`);
        return reply.code(201).send(toSnapshotDto(snapshot));
      } catch (err) {
        return sendDeviceError(reply, err);
      }
    },
  );

  app.post(
    '/devices/:mac/reboot',
    {
      schema: { params: MacParams, body: CredentialsBody, response: { 202: Type.Object({ ok: Type.Literal(true) }), 400: ErrorBody, 404: ErrorBody, 409: ErrorBody, 502: ErrorBody } },
      preValidation: async (request) => {
        request.body ??= {};
      },
    },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      try {
        await devices.reboot(mac, request.body.credentials, { requestedBy: request.ip });
        return reply.code(202).send({ ok: true as const });
      } catch (err) {
        return sendDeviceError(reply, err);
      }
    },
  );

  app.post(
    '/devices/:mac/factory-reset',
    {
      schema: {
        params: MacParams,
        body: FactoryResetBody,
        response: { 202: Type.Object({ snapshotId: Nullable(Type.Integer()), confirmed: Type.Boolean() }), 400: ErrorBody, 404: ErrorBody, 409: ErrorBody, 502: ErrorBody },
      },
    },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      try {
        const result = await devices.factoryReset(
          mac,
          { confirmMac: request.body.confirmMac, credentials: request.body.credentials, allowWithoutSnapshot: request.body.allowWithoutSnapshot },
          { requestedBy: request.ip },
        );
        return reply.code(202).send(result);
      } catch (err) {
        return sendDeviceError(reply, err);
      }
    },
  );
};
