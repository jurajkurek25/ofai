import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtAuth } from '../../middleware/jwtAuth';
import { generateAvatar, listImages, deleteImage } from '../../services/imageService';
import { getPersona } from '../../services/personaService';
import { findById } from '../../services/userService';

interface GenerateBody {
  persona_id: number;
  style: string;
  is_nsfw?: boolean;
}

interface ListQuery {
  page?: string;
  page_size?: string;
}

export async function imageRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: jwtAuth };

  // POST /api/images/generate
  fastify.post<{ Body: GenerateBody }>(
    '/api/images/generate',
    auth,
    async (request: FastifyRequest<{ Body: GenerateBody }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { persona_id, style, is_nsfw } = request.body;

      if (!persona_id || !style) {
        return reply.code(400).send({ error: 'persona_id and style are required' });
      }

      const user = findById(userId);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const persona = getPersona(persona_id, userId);
      if (!persona) return reply.code(404).send({ error: 'Persona not found' });

      try {
        const image = await generateAvatar(userId, user.plan, persona, style, is_nsfw ?? false);
        return reply.code(201).send({ image });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Image generation failed';
        return reply.code(400).send({ error: msg });
      }
    }
  );

  // GET /api/images
  fastify.get<{ Querystring: ListQuery }>(
    '/api/images',
    auth,
    async (request: FastifyRequest<{ Querystring: ListQuery }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const page = parseInt(request.query.page ?? '1', 10);
      const pageSize = parseInt(request.query.page_size ?? '20', 10);

      const { images, total } = listImages(userId, page, Math.min(pageSize, 50));
      return reply.send({ images, total, page, page_size: Math.min(pageSize, 50) });
    }
  );

  // DELETE /api/images/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/images/:id',
    auth,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        deleteImage(parseInt(request.params.id, 10), request.user!.userId);
        return reply.send({ success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        return reply.code(404).send({ error: msg });
      }
    }
  );
}
