import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { config } from '../../config/config';
import { logger } from '../../utils/logger';
import { igClient } from '../../services/instagram';
import { grokClient } from '../../services/grok';
import { conversationService } from '../../services/conversation';
import { isSpam, containsSensitiveRequest, sanitizeForLog } from '../../utils/spam';

interface WebhookVerifyQuery {
  'hub.mode': string;
  'hub.verify_token': string;
  'hub.challenge': string;
}

interface MessagingEntry {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{ type: string }>;
  };
}

interface WebhookBody {
  object: string;
  entry: Array<{
    id: string;
    time: number;
    messaging?: MessagingEntry[];
    changes?: Array<{ field: string; value: unknown }>;
  }>;
}

function verifySignature(rawBody: Buffer, signature: string): boolean {
  const expected = `sha256=${crypto
    .createHmac('sha256', config.meta.appSecret)
    .update(rawBody)
    .digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function handleIncomingMessage(senderId: string, messageId: string, text: string): Promise<void> {
  // Dedup
  if (conversationService.isMessageProcessed(messageId)) return;
  conversationService.markMessageProcessed(messageId);

  conversationService.getOrCreateUser(senderId);

  if (conversationService.isBlocked(senderId)) {
    logger.debug({ senderId }, 'Skipping blocked user');
    return;
  }

  if (!conversationService.checkRateLimit(senderId)) {
    logger.warn({ senderId }, 'Rate limit reached, skipping reply');
    return;
  }

  if (isSpam(text)) {
    logger.info({ senderId, text: sanitizeForLog(text) }, 'Spam detected, ignoring');
    return;
  }

  // Record inbound message
  conversationService.addMessage(senderId, 'user', text, messageId);

  let reply: string;

  // Check for manual override first
  const override = conversationService.getPendingOverride(senderId);
  if (override) {
    reply = override;
    logger.info({ senderId }, 'Using manual override');
  } else if (containsSensitiveRequest(text)) {
    reply = "hey, i appreciate the message but that's not something i can help with 🙏 feel free to ask about my content though!";
  } else {
    const history = conversationService.getHistory(senderId);
    reply = await grokClient.generateReply(history, text);
  }

  await igClient.sendMessage(senderId, reply);
  conversationService.addMessage(senderId, 'assistant', reply);

  logger.info({ senderId, replyLength: reply.length }, 'Reply sent');
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Webhook verification (GET)
  fastify.get<{ Querystring: WebhookVerifyQuery }>(
    '/webhook',
    async (request: FastifyRequest<{ Querystring: WebhookVerifyQuery }>, reply: FastifyReply) => {
      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = request.query;

      if (mode === 'subscribe' && token === config.meta.verifyToken) {
        logger.info('Webhook verified by Meta');
        return reply.send(challenge);
      }

      logger.warn({ mode, token }, 'Webhook verification failed');
      return reply.code(403).send({ error: 'Forbidden' });
    }
  );

  // Incoming events (POST)
  fastify.post(
    '/webhook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;

      if (!signature || !rawBody || !verifySignature(rawBody, signature)) {
        logger.warn('Invalid webhook signature');
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      // Respond immediately to Meta (must be < 20 s)
      reply.code(200).send({ status: 'ok' });

      const body = request.body as WebhookBody;
      if (body.object !== 'instagram') return;

      for (const entry of body.entry ?? []) {
        for (const event of entry.messaging ?? []) {
          const senderId = event.sender.id;
          const text = event.message?.text;
          const mid = event.message?.mid;

          // Skip messages from the bot's own account
          if (senderId === config.meta.instagramAccountId) continue;
          if (!text || !mid) continue;

          handleIncomingMessage(senderId, mid, text).catch((err) => {
            logger.error({ err, senderId }, 'Error handling incoming message');
          });
        }
      }
    }
  );
}
