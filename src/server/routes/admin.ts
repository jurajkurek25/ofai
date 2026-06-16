import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuth } from '../../middleware/auth';
import { conversationService } from '../../services/conversation';
import { igClient } from '../../services/instagram';
import { grokClient } from '../../services/grok';
import { config } from '../../config/config';
import { logger } from '../../utils/logger';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', adminAuth);

  // ── Status / health of connected APIs ────────────────────────────────────
  fastify.get('/admin/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const results: Record<string, { ok: boolean; detail: string }> = {};

    // Test Instagram / Meta API
    try {
      const convs = await igClient.getConversations();
      results.instagram = { ok: true, detail: `Connected — ${convs.length} conversation(s) found` };
    } catch (e: unknown) {
      results.instagram = { ok: false, detail: String(e instanceof Error ? e.message : e) };
    }

    // Test Grok API (tiny prompt)
    try {
      const reply = await grokClient.generateReply([], 'Say "ok" in one word.');
      results.grok = { ok: true, detail: `Connected — model: ${config.grok.model}` };
      void reply;
    } catch (e: unknown) {
      results.grok = { ok: false, detail: String(e instanceof Error ? e.message : e) };
    }

    results.database = { ok: true, detail: 'SQLite running' };

    return reply.send(results);
  });

  // ── Safe config info (no secrets) ────────────────────────────────────────
  fastify.get('/admin/config-info', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      instagramAccountId: config.meta.instagramAccountId,
      metaApiVersion: config.meta.apiVersion,
      grokModel: config.grok.model,
      pollingEnabled: config.polling.enabled,
      pollIntervalSeconds: config.polling.intervalSeconds,
      maxRepliesPerHour: config.limits.maxRepliesPerUserPerHour,
      accessTokenSet: config.meta.accessToken.length > 10,
      webhookTokenSet: config.meta.verifyToken.length > 0,
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  fastify.get('/admin/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(conversationService.getStats());
  });

  // ── Conversations ─────────────────────────────────────────────────────────
  fastify.get('/admin/conversations', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(conversationService.listConversations());
  });

  fastify.get<{ Params: { userId: string } }>(
    '/admin/conversations/:userId',
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      const messages = conversationService.getConversationMessages(request.params.userId);
      return reply.send(messages);
    }
  );

  fastify.post<{ Params: { userId: string } }>(
    '/admin/conversations/:userId/block',
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      conversationService.blockUser(request.params.userId);
      return reply.send({ success: true });
    }
  );

  fastify.post<{ Params: { userId: string } }>(
    '/admin/conversations/:userId/unblock',
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      conversationService.unblockUser(request.params.userId);
      return reply.send({ success: true });
    }
  );

  fastify.post<{ Params: { userId: string }; Body: { message: string } }>(
    '/admin/conversations/:userId/send',
    async (
      request: FastifyRequest<{ Params: { userId: string }; Body: { message: string } }>,
      reply: FastifyReply
    ) => {
      const { userId } = request.params;
      const { message } = request.body;
      if (!message?.trim()) return reply.code(400).send({ error: 'message is required' });

      try {
        await igClient.sendMessage(userId, message);
        conversationService.addMessage(userId, 'assistant', message);
        logger.info({ userId }, 'Manual message sent by admin');
        return reply.send({ success: true });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to send manual message');
        return reply.code(500).send({ error: 'Failed to send message' });
      }
    }
  );

  fastify.post<{ Params: { userId: string }; Body: { message: string } }>(
    '/admin/conversations/:userId/override',
    async (
      request: FastifyRequest<{ Params: { userId: string }; Body: { message: string } }>,
      reply: FastifyReply
    ) => {
      const { userId } = request.params;
      const { message } = request.body;
      if (!message?.trim()) return reply.code(400).send({ error: 'message is required' });

      conversationService.createOverride(userId, message);
      logger.info({ userId }, 'Manual override queued');
      return reply.send({ success: true });
    }
  );
}
