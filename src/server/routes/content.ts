import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtAuth } from '../../middleware/jwtAuth';
import {
  analyzeTrends,
  generateContent,
  listContent,
  deleteContent,
  TrendAnalysis,
} from '../../services/contentService';
import { getPersona, getProductsByPersonaId } from '../../services/personaService';
import { findById } from '../../services/userService';

interface TrendsBody {
  topic?: string;
}

interface GenerateBody {
  persona_id: number;
  content_type: 'post' | 'reel' | 'story';
  trend_data?: TrendAnalysis;
}

interface ListQuery {
  page?: string;
  page_size?: string;
}

export async function contentRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: jwtAuth };

  // POST /api/content/trends
  fastify.post<{ Body: TrendsBody }>(
    '/api/content/trends',
    auth,
    async (request: FastifyRequest<{ Body: TrendsBody }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const user = findById(userId);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const { topic } = request.body ?? {};

      try {
        const analysis = await analyzeTrends(topic);
        return reply.send({ analysis });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Trend analysis failed';
        return reply.code(500).send({ error: msg });
      }
    }
  );

  // POST /api/content/generate
  fastify.post<{ Body: GenerateBody }>(
    '/api/content/generate',
    auth,
    async (request: FastifyRequest<{ Body: GenerateBody }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { persona_id, content_type, trend_data } = request.body;

      if (!persona_id || !content_type) {
        return reply.code(400).send({ error: 'persona_id and content_type are required' });
      }

      if (!['post', 'reel', 'story'].includes(content_type)) {
        return reply.code(400).send({ error: 'content_type must be post, reel, or story' });
      }

      const user = findById(userId);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const persona = getPersona(persona_id, userId);
      if (!persona) return reply.code(404).send({ error: 'Persona not found' });

      const products = getProductsByPersonaId(persona_id);

      try {
        const content = await generateContent(
          userId,
          user.plan,
          persona,
          products,
          trend_data ?? null,
          content_type
        );
        return reply.code(201).send({ content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Content generation failed';
        return reply.code(400).send({ error: msg });
      }
    }
  );

  // GET /api/content
  fastify.get<{ Querystring: ListQuery }>(
    '/api/content',
    auth,
    async (request: FastifyRequest<{ Querystring: ListQuery }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const page = parseInt(request.query.page ?? '1', 10);
      const pageSize = parseInt(request.query.page_size ?? '20', 10);

      const { content, total } = listContent(userId, page, Math.min(pageSize, 50));
      return reply.send({ content, total, page, page_size: Math.min(pageSize, 50) });
    }
  );

  // DELETE /api/content/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/content/:id',
    auth,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        deleteContent(parseInt(request.params.id, 10), request.user!.userId);
        return reply.send({ success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        return reply.code(404).send({ error: msg });
      }
    }
  );
}
