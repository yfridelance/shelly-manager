import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../db/database.js';
import { buildCsvExport, buildJsonExport } from '../export/inventory-export.js';
import { SiteQuery } from './sites.js';

export const exportRoutes: FastifyPluginAsyncTypebox<{ db: Db; now?: () => string }> = async (app, { db, now }) => {
  const timestamp = () => (now ? now() : new Date().toISOString());
  const fileName = (ext: string) => `shelly-inventar-${timestamp().slice(0, 10)}.${ext}`;

  app.get(
    '/export.json',
    {
      schema: {
        querystring: Type.Object({
          snapshots: Type.Optional(Type.Union([Type.Literal('latest'), Type.Literal('all')])),
          site: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
      },
    },
    async (request, reply) => {
      const body = buildJsonExport(db, { allSnapshots: request.query.snapshots === 'all', now: timestamp(), siteId: request.query.site });
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${fileName('json')}"`)
        .send(JSON.stringify(body, null, 2));
    },
  );

  app.get(
    '/export.csv',
    {
      schema: {
        querystring: Type.Object({
          ...SiteQuery.properties,
          // UI language for headers and labels; unknown languages fall back to German.
          lang: Type.Optional(Type.String({ pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$' })),
        }),
      },
    },
    async (request, reply) =>
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${fileName('csv')}"`)
        .send(buildCsvExport(db, request.query.site, request.query.lang)),
  );
};
