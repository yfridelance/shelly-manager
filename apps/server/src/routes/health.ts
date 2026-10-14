import { Type } from 'typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/health',
    { schema: { response: { 200: Type.Object({ status: Type.Literal('ok') }) } } },
    async () => ({ status: 'ok' as const }),
  );
};
