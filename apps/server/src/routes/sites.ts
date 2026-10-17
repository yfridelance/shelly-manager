import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Db } from '../db/database.js';
import { SiteError, createSite, deleteSite, getSite, listSites, updateSite } from '../db/sites.js';

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);

export const SiteSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  description: Nullable(Type.String()),
  createdAt: Type.String(),
  deviceCount: Type.Integer(),
  templateCount: Type.Integer(),
});

const SiteBody = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 100 }), description: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))) },
  { additionalProperties: false },
);
const ErrorBody = Type.Object({ error: Type.String(), message: Type.String() });
const IdParams = Type.Object({ id: Type.Integer() });

const SITE_ERROR_TEXT: Record<SiteError['code'], (name: string) => string> = {
  name_taken: (name) => `Der Name «${name}» ist schon vergeben.`,
  site_not_empty: () => 'Der Standort enthält noch Geräte oder Templates. Zuerst verschieben oder löschen.',
  last_site: () => 'Der letzte Standort kann nicht gelöscht werden.',
};

/** Sites (houses, customers): separate inventories, templates and logs in one installation. */
export const siteRoutes: FastifyPluginAsyncTypebox<{ db: Db; now: () => string }> = async (app, { db, now }) => {
  const notFound = { error: 'site_not_found', message: 'Standort nicht gefunden.' };

  app.get('/sites', { schema: { response: { 200: Type.Array(SiteSchema) } } }, async () => listSites(db));

  app.post('/sites', { schema: { body: SiteBody, response: { 201: SiteSchema, 409: ErrorBody } } }, async (request, reply) => {
    const name = request.body.name.trim();
    try {
      return reply.code(201).send(createSite(db, { name, description: request.body.description?.trim() || null }, now()));
    } catch (err) {
      if (err instanceof SiteError) return reply.code(409).send({ error: err.code, message: SITE_ERROR_TEXT[err.code](name) });
      throw err;
    }
  });

  app.put(
    '/sites/:id',
    { schema: { params: IdParams, body: SiteBody, response: { 200: SiteSchema, 404: ErrorBody, 409: ErrorBody } } },
    async (request, reply) => {
      const name = request.body.name.trim();
      try {
        const site = updateSite(db, request.params.id, { name, description: request.body.description?.trim() || null });
        return site ?? reply.code(404).send(notFound);
      } catch (err) {
        if (err instanceof SiteError) return reply.code(409).send({ error: err.code, message: SITE_ERROR_TEXT[err.code](name) });
        throw err;
      }
    },
  );

  app.delete('/sites/:id', { schema: { params: IdParams, response: { 204: Type.Null(), 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) => {
    try {
      return deleteSite(db, request.params.id) ? reply.code(204).send(null) : reply.code(404).send(notFound);
    } catch (err) {
      if (err instanceof SiteError) return reply.code(409).send({ error: err.code, message: SITE_ERROR_TEXT[err.code]('') });
      throw err;
    }
  });

  app.get('/sites/:id', { schema: { params: IdParams, response: { 200: SiteSchema, 404: ErrorBody } } }, async (request, reply) => {
    return getSite(db, request.params.id) ?? reply.code(404).send(notFound);
  });
};

/** `?site=` query parameter shared by list endpoints (absent = all sites). */
export const SiteQuery = Type.Object({ site: Type.Optional(Type.Integer({ minimum: 1 })) });
