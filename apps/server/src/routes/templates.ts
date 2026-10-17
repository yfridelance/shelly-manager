import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../db/database.js';
import { getDevice, listDevices } from '../db/devices.js';
import { getLatestSnapshot } from '../db/snapshots.js';
import {
  TemplateNameTakenError,
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../db/templates.js';
import { isRecord } from '../shelly/http.js';
import { normalizeMac } from '../shelly/mac.js';
import { assignStaticIps, validateNetwork } from '../templates/ip-plan.js';
import { currentStaticIp, planTemplate } from '../templates/planner.js';
import { TemplateSettingsSchema, type TemplateSettings, type WifiInterface } from '../templates/settings.js';
import type { DeviceListRow } from '../db/devices.js';
import { getSite } from '../db/sites.js';
import { SiteQuery } from './sites.js';
import type { ShellyGen } from '../shelly/types.js';

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);

export const TemplateSchema = Type.Object({
  id: Type.Integer(),
  siteId: Type.Integer(),
  name: Type.String(),
  description: Nullable(Type.String()),
  settings: TemplateSettingsSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const PlanItemSchema = Type.Object({
  key: Type.String(),
  status: Type.Union([Type.Literal('change'), Type.Literal('same'), Type.Literal('unsupported')]),
  current: Type.Optional(Type.Unknown()),
  target: Type.Optional(Type.Unknown()),
  reason: Type.Optional(
    Type.Union([
      Type.Literal('generation'),
      Type.Literal('firmware'),
      Type.Literal('password'),
      Type.Literal('inactive'),
      Type.Literal('no_ip'),
      Type.Literal('gateway_cloud'),
    ]),
  ),
});

const TemplateBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
    settings: TemplateSettingsSchema,
    /** Site of the template (only used when creating; default 1). Templates apply to devices of their site. */
    siteId: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

const PreviewSchema = Type.Object({
  mac: Type.String(),
  name: Nullable(Type.String()),
  gen: Type.Integer(),
  state: Type.String(),
  /** Time of the snapshot the preview is based on; null = no config known yet. */
  basedOn: Nullable(Type.String()),
  items: Type.Array(PlanItemSchema),
  /** Planned static IPs per WLAN interface (only for templates with static network settings). */
  assignedIps: Type.Object({ sta: Type.Optional(Type.String()), sta1: Type.Optional(Type.String()) }),
});

const ErrorBody = Type.Object({ error: Type.String(), message: Type.String() });
// Template names are unique per site.
const IdParams = Type.Object({ id: Type.Integer() });

function hasSettings(settings: object): boolean {
  return Object.values(settings).some((group) => group !== undefined && Object.keys(group as object).length > 0);
}

function networkProblem(settings: TemplateSettings): string | undefined {
  for (const iface of ['sta', 'sta1'] as const) {
    const n = settings.network?.[iface];
    const problem = n ? validateNetwork(iface, n) : undefined;
    if (problem) return problem;
  }
  return undefined;
}

const collator = new Intl.Collator('de-CH', { numeric: true, sensitivity: 'base' });

/**
 * Plans static IPs for the given devices (in the order location, name), per WLAN interface.
 * Used IPs are all addresses in the inventory, held by their device's MAC.
 */
export function planIpAssignments(
  db: Db,
  settings: TemplateSettings,
  devices: readonly DeviceListRow[],
  configOf: (mac: string) => unknown,
  reserved: ReadonlyMap<string, string> = new Map(),
): Map<string, Partial<Record<WifiInterface, string>>> {
  const result = new Map<string, Partial<Record<WifiInterface, string>>>();
  const ordered = [...devices].sort(
    (a, b) =>
      collator.compare(a.location ?? '\uffff', b.location ?? '\uffff') ||
      collator.compare(a.name ?? a.device_name ?? `\uffff${a.mac}`, b.name ?? b.device_name ?? `\uffff${b.mac}`),
  );
  const taken = new Map<string, string>(reserved);
  // Addresses are only unique within a site.
  for (const d of listDevices(db, devices[0]?.site_id)) if (d.ip && !taken.has(d.ip)) taken.set(d.ip, d.mac);
  for (const iface of ['sta', 'sta1'] as const) {
    const n = settings.network?.[iface];
    if (n?.mode !== 'static' || !n.ipFrom || !n.netmask) continue;
    const assigned = assignStaticIps(
      ordered.map((d) => ({ mac: d.mac, currentStatic: currentStaticIp(d.gen as ShellyGen, configOf(d.mac), iface) })),
      { ipFrom: n.ipFrom, netmask: n.netmask, gateway: n.gateway },
      taken,
    );
    for (const [mac, ip] of assigned) result.set(mac, { ...result.get(mac), [iface]: ip });
  }
  return result;
}

export const templateRoutes: FastifyPluginAsyncTypebox<{ db: Db; now: () => string }> = async (app, { db, now }) => {
  const notFound = { error: 'not_found', message: 'Template nicht gefunden.' };
  const empty = { error: 'empty_template', message: 'Das Template enthält keine Einstellung.' };
  const taken = (name: string) => ({ error: 'name_taken', message: `Der Name «${name}» ist schon vergeben.` });

  app.get('/templates', { schema: { querystring: SiteQuery, response: { 200: Type.Array(TemplateSchema) } } }, async (request) =>
    listTemplates(db, request.query.site),
  );

  app.get('/templates/:id', { schema: { params: IdParams, response: { 200: TemplateSchema, 404: ErrorBody } } }, async (request, reply) => {
    return getTemplate(db, request.params.id) ?? reply.code(404).send(notFound);
  });

  app.post(
    '/templates',
    { schema: { body: TemplateBody, response: { 201: TemplateSchema, 400: ErrorBody, 409: ErrorBody } } },
    async (request, reply) => {
      const { name, description, settings } = request.body;
      if (!hasSettings(settings)) return reply.code(400).send(empty);
      const netProblem = networkProblem(settings);
      if (netProblem) return reply.code(400).send({ error: 'invalid_network', message: netProblem });
      const siteId = request.body.siteId ?? 1;
      if (!getSite(db, siteId)) return reply.code(400).send({ error: 'site_not_found', message: 'Standort nicht gefunden.' });
      try {
        return reply.code(201).send(createTemplate(db, { name: name.trim(), description: description?.trim() || null, settings, siteId }, now()));
      } catch (err) {
        if (err instanceof TemplateNameTakenError) return reply.code(409).send(taken(name));
        throw err;
      }
    },
  );

  app.put(
    '/templates/:id',
    { schema: { params: IdParams, body: TemplateBody, response: { 200: TemplateSchema, 400: ErrorBody, 404: ErrorBody, 409: ErrorBody } } },
    async (request, reply) => {
      const { name, description, settings } = request.body;
      if (!hasSettings(settings)) return reply.code(400).send(empty);
      const netProblem = networkProblem(settings);
      if (netProblem) return reply.code(400).send({ error: 'invalid_network', message: netProblem });
      try {
        const updated = updateTemplate(db, request.params.id, { name: name.trim(), description: description?.trim() || null, settings }, now());
        return updated ?? reply.code(404).send(notFound);
      } catch (err) {
        if (err instanceof TemplateNameTakenError) return reply.code(409).send(taken(name));
        throw err;
      }
    },
  );

  app.delete('/templates/:id', { schema: { params: IdParams, response: { 204: Type.Null(), 404: ErrorBody } } }, async (request, reply) => {
    return deleteTemplate(db, request.params.id) ? reply.code(204).send(null) : reply.code(404).send(notFound);
  });

  // What the template would change, per device, based on each device's newest snapshot.
  // No device is contacted; applying plans again against a fresh read.
  app.post(
    '/templates/:id/preview',
    {
      schema: {
        params: IdParams,
        body: Type.Object({ macs: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 1000 })) }, { additionalProperties: false }),
        response: { 200: Type.Array(PreviewSchema), 400: ErrorBody, 404: ErrorBody },
      },
      preValidation: async (request) => {
        request.body ??= {};
      },
    },
    async (request, reply) => {
      const template = getTemplate(db, request.params.id);
      if (!template) return reply.code(404).send(notFound);
      let devices;
      try {
        devices = request.body.macs
          ? request.body.macs.flatMap((m) => {
              const d = getDevice(db, normalizeMac(m));
              return d && d.site_id === template.siteId ? [d] : [];
            })
          : listDevices(db, template.siteId).filter((d) => d.state === 'active');
      } catch {
        return reply.code(400).send({ error: 'invalid_mac', message: 'Ungültige MAC-Adresse in der Auswahl.' });
      }
      const configs = new Map(
        devices.map((d) => {
          const snap = getLatestSnapshot(db, d.mac);
          return [d.mac, snap?.config_json ? (JSON.parse(snap.config_json) as unknown) : undefined];
        }),
      );
      const ips = planIpAssignments(db, template.settings, devices, (mac) => configs.get(mac));
      return devices.map((d) => {
        const snap = getLatestSnapshot(db, d.mac);
        const config = snap?.config_json ? (JSON.parse(snap.config_json) as unknown) : undefined;
        const info = snap ? (JSON.parse(snap.info_json) as unknown) : undefined;
        const gen = d.gen as 1 | 2 | 3 | 4;
        const deviceId =
          gen === 1
            ? String((isRecord(config) && isRecord(config['device']) && config['device']['hostname']) || d.mac)
            : String((isRecord(info) && info['id']) || d.mac);
        return {
          mac: d.mac,
          name: d.name ?? d.device_name,
          gen: d.gen,
          state: d.state,
          basedOn: config === undefined ? null : (snap?.taken_at ?? null),
          items:
            config === undefined
              ? []
              : planTemplate(gen, config, template.settings, { deviceId, mac: d.mac, assignedIps: ips.get(d.mac) }).items,
          assignedIps: ips.get(d.mac) ?? {},
        };
      });
    },
  );
};
