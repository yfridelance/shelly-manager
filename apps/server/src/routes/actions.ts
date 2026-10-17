import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../db/database.js';
import { listActions, type ActionListRow } from '../db/actions.js';
import { normalizeMac } from '../shelly/mac.js';

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);

export const ActionSchema = Type.Object({
  id: Type.Integer(),
  mac: Type.String(),
  deviceName: Nullable(Type.String()),
  action: Type.String(),
  requestedAt: Type.String(),
  requestedBy: Nullable(Type.String()),
  finishedAt: Nullable(Type.String()),
  result: Nullable(Type.Union([Type.Literal('ok'), Type.Literal('error')])),
  errorCode: Nullable(Type.String()),
  error: Nullable(Type.String()),
  details: Type.Unknown(),
});

function toActionDto(row: ActionListRow) {
  return {
    id: row.id,
    mac: row.mac,
    deviceName: row.device_name,
    action: row.action,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by,
    finishedAt: row.finished_at,
    result: row.result,
    errorCode: row.error_code,
    error: row.error,
    details: row.details ? (JSON.parse(row.details) as unknown) : null,
  };
}

export const actionRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/actions',
    {
      schema: {
        querystring: Type.Object({
          mac: Type.Optional(Type.String({ maxLength: 32 })),
          site: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
        }),
        response: { 200: Type.Array(ActionSchema), 400: Type.Object({ error: Type.String(), message: Type.String() }) },
      },
    },
    async (request, reply) => {
      let mac: string | undefined;
      if (request.query.mac) {
        try {
          mac = normalizeMac(request.query.mac);
        } catch {
          return reply.code(400).send({ error: 'invalid_mac', message: `Ungültige MAC-Adresse: ${request.query.mac}` });
        }
      }
      return listActions(db, { mac, siteId: request.query.site, limit: request.query.limit }).map(toActionDto);
    },
  );
};
