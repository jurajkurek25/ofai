import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { logger } from '../utils/logger';
import { webhookRoutes } from './routes/webhook';
import { adminRoutes } from './routes/admin';

// Augment FastifyRequest with rawBody
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
  });

  // Parse JSON as Buffer so we can do HMAC verification in the webhook route
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done) => {
      req.rawBody = body;
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (e) {
        done(e as Error, undefined);
      }
    }
  );

  await app.register(fastifyCors, { origin: false });

  await app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  await app.register(fastifyStatic, {
    root: path.resolve(process.cwd(), 'admin'),
    prefix: '/admin-ui/',
  });

  await app.register(webhookRoutes);
  await app.register(adminRoutes);

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  app.setErrorHandler((error, _request, reply) => {
    logger.error({ err: error }, 'Unhandled error');
    reply.code(500).send({ error: 'Internal server error' });
  });

  return app;
}
