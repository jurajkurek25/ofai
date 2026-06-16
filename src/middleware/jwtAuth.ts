import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../services/auth';

export async function jwtAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }

  request.user = payload;
}
