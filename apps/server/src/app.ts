import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { AppConfig } from './config.js';
import type { Db } from './db/database.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config: Pick<AppConfig, 'staticDir' | 'logLevel'>;
  db: Db;
}

export async function buildApp({ config, db }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Device credentials must never reach the logs.
      redact: { paths: ['req.headers.authorization', '*.password', '*.credentials'], censor: '[redacted]' },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('db', db);
  app.addHook('onClose', async () => {
    db.close();
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
    },
    { prefix: '/api' },
  );

  if (config.staticDir) {
    await app.register(fastifyStatic, { root: path.resolve(config.staticDir) });
  }

  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    const isApi = url === '/api' || url.startsWith('/api/');
    if (config.staticDir && !isApi && (request.method === 'GET' || request.method === 'HEAD')) {
      // SPA fallback: let the Angular router handle unknown paths.
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found', message: `Route ${request.method} ${url} not found` });
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}
