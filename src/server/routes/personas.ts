import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtAuth } from '../../middleware/jwtAuth';
import {
  createPersona,
  updatePersona,
  deletePersona,
  getPersonas,
  getPersona,
  addProduct,
  updateProduct,
  deleteProduct,
  getProducts,
  buildSystemPrompt,
  PersonaData,
  ProductData,
} from '../../services/personaService';
import { findById, getPlanLimits } from '../../services/userService';

export async function personaRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: jwtAuth };

  // GET /api/personas
  fastify.get('/api/personas', auth, async (request: FastifyRequest, reply: FastifyReply) => {
    const personas = getPersonas(request.user!.userId);
    return reply.send({ personas });
  });

  // POST /api/personas
  fastify.post<{ Body: PersonaData }>(
    '/api/personas',
    auth,
    async (request: FastifyRequest<{ Body: PersonaData }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const user = findById(userId);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const limits = getPlanLimits(user.plan);
      const existing = getPersonas(userId);

      if (isFinite(limits.maxPersonas) && existing.length >= limits.maxPersonas) {
        return reply.code(403).send({
          error: `Your plan allows a maximum of ${limits.maxPersonas} persona(s). Upgrade to create more.`,
        });
      }

      if (!request.body.name) {
        return reply.code(400).send({ error: 'Persona name is required' });
      }

      const persona = createPersona(userId, request.body);
      return reply.code(201).send({ persona });
    }
  );

  // GET /api/personas/:id
  fastify.get<{ Params: { id: string } }>(
    '/api/personas/:id',
    auth,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const persona = getPersona(parseInt(request.params.id, 10), request.user!.userId);
      if (!persona) return reply.code(404).send({ error: 'Persona not found' });

      const products = getProducts(persona.id, request.user!.userId);
      const systemPrompt = buildSystemPrompt(persona, products);
      return reply.send({ persona, products, systemPrompt });
    }
  );

  // PUT /api/personas/:id
  fastify.put<{ Params: { id: string }; Body: PersonaData }>(
    '/api/personas/:id',
    auth,
    async (request: FastifyRequest<{ Params: { id: string }; Body: PersonaData }>, reply: FastifyReply) => {
      try {
        const persona = updatePersona(parseInt(request.params.id, 10), request.user!.userId, request.body);
        return reply.send({ persona });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Update failed';
        return reply.code(404).send({ error: msg });
      }
    }
  );

  // DELETE /api/personas/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/personas/:id',
    auth,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        deletePersona(parseInt(request.params.id, 10), request.user!.userId);
        return reply.send({ success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        return reply.code(404).send({ error: msg });
      }
    }
  );

  // GET /api/personas/:id/products
  fastify.get<{ Params: { id: string } }>(
    '/api/personas/:id/products',
    auth,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const personaId = parseInt(request.params.id, 10);
      const persona = getPersona(personaId, request.user!.userId);
      if (!persona) return reply.code(404).send({ error: 'Persona not found' });

      const products = getProducts(personaId, request.user!.userId);
      return reply.send({ products });
    }
  );

  // POST /api/personas/:id/products
  fastify.post<{ Params: { id: string }; Body: ProductData }>(
    '/api/personas/:id/products',
    auth,
    async (request: FastifyRequest<{ Params: { id: string }; Body: ProductData }>, reply: FastifyReply) => {
      const personaId = parseInt(request.params.id, 10);

      if (!request.body.name || request.body.price === undefined) {
        return reply.code(400).send({ error: 'name and price are required' });
      }

      try {
        const product = addProduct(personaId, request.user!.userId, request.body);
        return reply.code(201).send({ product });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to add product';
        return reply.code(404).send({ error: msg });
      }
    }
  );

  // PUT /api/personas/:id/products/:productId
  fastify.put<{ Params: { id: string; productId: string }; Body: Partial<ProductData> }>(
    '/api/personas/:id/products/:productId',
    auth,
    async (
      request: FastifyRequest<{ Params: { id: string; productId: string }; Body: Partial<ProductData> }>,
      reply: FastifyReply
    ) => {
      try {
        const product = updateProduct(
          parseInt(request.params.productId, 10),
          parseInt(request.params.id, 10),
          request.user!.userId,
          request.body
        );
        return reply.send({ product });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Update failed';
        return reply.code(404).send({ error: msg });
      }
    }
  );

  // DELETE /api/personas/:id/products/:productId
  fastify.delete<{ Params: { id: string; productId: string } }>(
    '/api/personas/:id/products/:productId',
    auth,
    async (
      request: FastifyRequest<{ Params: { id: string; productId: string } }>,
      reply: FastifyReply
    ) => {
      try {
        deleteProduct(parseInt(request.params.productId, 10), request.user!.userId);
        return reply.send({ success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        return reply.code(404).send({ error: msg });
      }
    }
  );
}
