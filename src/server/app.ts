import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { logger } from '../utils/logger';
import { webhookRoutes } from './routes/webhook';
import { adminRoutes } from './routes/admin';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Capture raw body for HMAC verification
    addContentTypeParser: false,
    bodyLimit: 1_048_576, // 1 MB
  });

  // Store raw body for signature verification
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    function (_req, body, done) {
      try {
        const parsed = JSON.parse(body.toString());
        // Attach raw buffer for later HMAC check
        (parsed as Record<string, unknown>).__rawBody = body;
        done(null, parsed);
      } catch (e) {
        done(e as Error, undefined);
      }
    }
  );

  // Re-attach raw body to request for webhook route
  app.addHook('preHandler', async (request) => {
    const raw = (request.body as Record<string, unknown> | undefined)?.__rawBody as Buffer | undefined;
    if (raw) {
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody = raw;
    }
  });

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

// Fastify request augmentation – needed for rawBody
import type { FastifyRequest } from 'fastify';
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}
