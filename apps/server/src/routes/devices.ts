import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply } from 'fastify';
import type { Db } from '../db/database.js';
import { getDevice, listDevices, moveDevice, updateLocalFields, type DeviceListRow } from '../db/devices.js';
import { getSite } from '../db/sites.js';
import { SiteQuery } from './sites.js';
import { getLatestSnapshot, getSnapshot, listSnapshotMeta, type SnapshotRow } from '../db/snapshots.js';
import { DeviceActionError, type DeviceService } from '../devices/device-service.js';
import { getTemplate } from '../db/templates.js';
import { PlanItemSchema } from './templates.js';
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
  /** Shelly device id (Gen2+ `id`, Gen1 hostname). */
  deviceId: Nullable(Type.String()),
  siteId: Type.Integer(),
  authRequired: Type.Boolean(),
  location: Nullable(Type.String()),
  notes: Nullable(Type.String()),
  state: Type.Union([Type.Literal('active'), Type.Literal('reset'), Type.Literal('missing')]),
  firstSeen: Type.String(),
  lastSeen: Type.String(),
  lastSnapshotAt: Nullable(Type.String()),
  /** Newer firmware the device offers (Gen1: firmware id, Gen2+: version). */
  updateStable: Nullable(Type.String()),
  updateBeta: Nullable(Type.String()),
  updateCheckedAt: Nullable(Type.String()),
});

export const SnapshotSchema = Type.Object({
  id: Type.Integer(),
  takenAt: Type.String(),
  /** Last time the device answered with the same info/config (null = seen once). */
  confirmedAt: Nullable(Type.String()),
  // Raw device answers, unchanged.
  info: Type.Unknown(),
  config: Type.Unknown(),
  status: Type.Unknown(),
});

const SnapshotMetaSchema = Type.Object({
  id: Type.Integer(),
  takenAt: Type.String(),
  confirmedAt: Nullable(Type.String()),
  hasConfig: Type.Boolean(),
});

const DeviceDetailsSchema = Type.Object({
  device: DeviceSchema,
  latestSnapshot: Nullable(SnapshotSchema),
  snapshots: Type.Array(SnapshotMetaSchema),
});

const ErrorBody = Type.Object({ error: Type.String(), message: Type.String(), cause: Type.Optional(Type.String()) });
const MacParams = Type.Object({ mac: Type.String({ maxLength: 32 }) });
const LocalText = (maxLength: number) => Type.Optional(Nullable(Type.String({ maxLength })));

const PatchBody = Type.Object(
  {
    name: LocalText(200),
    location: LocalText(200),
    notes: LocalText(10_000),
    /** Move the device to another site. */
    siteId: Type.Optional(Type.Integer({ minimum: 1 })),
  },
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
    deviceId: row.device_id,
    siteId: row.site_id,
    authRequired: row.auth_required === 1,
    location: row.location,
    notes: row.notes,
    state: row.state,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastSnapshotAt: row.last_snapshot_at,
    updateStable: row.update_stable,
    updateBeta: row.update_beta,
    updateCheckedAt: row.update_checked_at,
  };
}

function toSnapshotDto(row: SnapshotRow) {
  const parse = (json: string | null): unknown => (json === null ? null : JSON.parse(json));
  return { id: row.id, takenAt: row.taken_at, confirmedAt: row.confirmed_at, info: parse(row.info_json), config: parse(row.config_json), status: parse(row.status_json) };
}

const CONFLICT_CODES = new Set(['no_ip', 'mac_mismatch', 'busy', 'snapshot_failed', 'no_update', 'ip_conflict']);
// template_failed and device errors map to 502.

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

  app.get('/devices', { schema: { querystring: SiteQuery, response: { 200: Type.Array(DeviceSchema) } } }, async (request) =>
    listDevices(db, request.query.site).map(toDeviceDto),
  );

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
        snapshots: listSnapshotMeta(db, mac).map((s) => ({ id: s.id, takenAt: s.taken_at, confirmedAt: s.confirmed_at, hasConfig: s.has_config === 1 })),
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
      const { siteId, ...local } = request.body;
      if (siteId !== undefined && !getSite(db, siteId)) {
        return reply.code(400).send({ error: 'site_not_found', message: 'Standort nicht gefunden.' });
      }
      if (!updateLocalFields(db, mac, local)) return notFound(reply, mac);
      if (siteId !== undefined) moveDevice(db, mac, siteId);
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

  app.post(
    '/devices/:mac/firmware/check',
    {
      schema: {
        params: MacParams,
        body: CredentialsBody,
        response: {
          200: Type.Object({ stable: Nullable(Type.String()), beta: Nullable(Type.String()), checkedAt: Type.String() }),
          400: ErrorBody,
          404: ErrorBody,
          409: ErrorBody,
          502: ErrorBody,
        },
      },
      preValidation: async (request) => {
        request.body ??= {};
      },
    },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      try {
        return await devices.checkFirmware(mac, request.body.credentials);
      } catch (err) {
        return sendDeviceError(reply, err);
      }
    },
  );

  app.post(
    '/devices/:mac/firmware/update',
    {
      schema: {
        params: MacParams,
        body: Type.Object(
          { channel: Type.Union([Type.Literal('stable'), Type.Literal('beta')]), credentials: CredentialsSchema },
          { additionalProperties: false },
        ),
        response: { 202: Type.Object({ version: Type.String() }), 400: ErrorBody, 404: ErrorBody, 409: ErrorBody, 502: ErrorBody },
      },
    },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      try {
        const result = await devices.updateFirmware(mac, request.body.channel, request.body.credentials, { requestedBy: request.ip });
        return reply.code(202).send(result);
      } catch (err) {
        return sendDeviceError(reply, err);
      }
    },
  );

  app.post(
    '/devices/:mac/apply-template',
    {
      schema: {
        params: MacParams,
        body: Type.Object(
          {
            templateId: Type.Integer(),
            credentials: CredentialsSchema,
            // Entered when applying; never stored or logged.
            secrets: Type.Optional(
              Type.Object(
                {
                  mqttPassword: Type.Optional(Type.String({ maxLength: 256 })),
                  apPassword: Type.Optional(Type.String({ minLength: 8, maxLength: 64 })),
                },
                { additionalProperties: false },
              ),
            ),
            rebootIfRequired: Type.Optional(Type.Boolean()),
            /** Planned static IPs (from the preview, possibly edited); missing ones are assigned on the server. */
            network: Type.Optional(
              Type.Object(
                { sta: Type.Optional(Type.String({ maxLength: 15 })), sta1: Type.Optional(Type.String({ maxLength: 15 })) },
                { additionalProperties: false },
              ),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            snapshotId: Type.Integer(),
            items: Type.Array(PlanItemSchema),
            changed: Type.Integer(),
            restartRequired: Type.Boolean(),
            rebooted: Type.Boolean(),
            network: Type.Optional(
              Type.Object({
                /** Address the device now has in the inventory (null: unknown, e.g. switched to DHCP). */
                ip: Nullable(Type.String()),
                /** false: not reachable at the expected address after the change; rescan. */
                confirmed: Type.Boolean(),
              }),
            ),
            script: Type.Optional(
              Type.Object({ created: Type.Boolean(), codeChanged: Type.Boolean(), enableChanged: Type.Boolean(), started: Type.Boolean() }),
            ),
          }),
          400: ErrorBody,
          404: ErrorBody,
          409: ErrorBody,
          502: ErrorBody,
        },
      },
    },
    async (request, reply) => {
      const mac = macOf(request.params.mac, reply);
      if (!mac) return reply;
      const template = getTemplate(db, request.body.templateId);
      if (!template) return reply.code(404).send({ error: 'template_not_found', message: 'Template nicht gefunden.' });
      const device = getDevice(db, mac);
      if (device && device.site_id !== template.siteId) {
        return reply.code(409).send({ error: 'site_mismatch', message: 'Gerät und Template gehören zu verschiedenen Standorten.' });
      }
      try {
        return await devices.applyTemplate(
          mac,
          template,
          {
            credentials: request.body.credentials,
            secrets: request.body.secrets,
            rebootIfRequired: request.body.rebootIfRequired,
            networkIps: request.body.network,
          },
          { requestedBy: request.ip },
        );
      } catch (err) {
        return sendDeviceError(reply, err);
      }
    },
  );
};
