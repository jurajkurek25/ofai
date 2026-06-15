import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/config';

export async function adminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.headers.authorization;
  if (!auth || auth !== `Bearer ${config.app.adminSecret}`) {
    await reply.code(401).send({ error: 'Unauthorized' });
  }
}
