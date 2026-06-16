import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import axios from 'axios';
import { config } from '../../config/config';
import { logger } from '../../utils/logger';
import { igClient } from '../../services/instagram';
import { grokClient } from '../../services/grok';
import { conversationService } from '../../services/conversation';
import { isSpam, containsSensitiveRequest, sanitizeForLog } from '../../utils/spam';
import { db } from '../../db/database';
import { getPersonaById, getProductsByPersonaId, buildSystemPrompt } from '../../services/personaService';

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

interface IGConnection {
  id: number;
  user_id: number;
  ig_account_id: string;
  ig_username: string | null;
  access_token: string;
  persona_id: number | null;
  connected_at: number;
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

async function sendMessageWithToken(
  recipientId: string,
  message: string,
  accessToken: string,
  apiVersion: string
): Promise<void> {
  const base = `https://graph.facebook.com/${apiVersion}`;
  await axios.post(
    `${base}/me/messages`,
    {
      recipient: { id: recipientId },
      message: { text: message },
      messaging_type: 'RESPONSE',
    },
    { params: { access_token: accessToken }, timeout: 15_000 }
  );
}

async function handleIncomingMessage(
  senderId: string,
  messageId: string,
  text: string,
  recipientAccountId: string
): Promise<void> {
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

  conversationService.addMessage(senderId, 'user', text, messageId);

  // Look up which SaaS user owns this IG account and which persona/token to use
  const connection = db
    .prepare('SELECT * FROM instagram_connections WHERE ig_account_id = ?')
    .get(recipientAccountId) as IGConnection | undefined;

  let reply: string;
  let accessToken = config.meta.accessToken;

  const override = conversationService.getPendingOverride(senderId);
  if (override) {
    reply = override;
    logger.info({ senderId }, 'Using manual override');
  } else if (containsSensitiveRequest(text)) {
    reply = "hey, i appreciate the message but that's not something i can help with 🙏 feel free to ask about my content though!";
  } else {
    const history = conversationService.getHistory(senderId);

    if (connection?.persona_id) {
      // Use per-tenant persona and access token
      const persona = getPersonaById(connection.persona_id);
      if (persona) {
        const products = getProductsByPersonaId(persona.id);
        const systemPrompt = buildSystemPrompt(persona, products);
        accessToken = connection.access_token;

        const messages = [
          { role: 'system' as const, content: systemPrompt },
          ...history,
          { role: 'user' as const, content: text },
        ];

        const http = axios.create({
          baseURL: config.grok.baseUrl,
          headers: {
            Authorization: `Bearer ${config.grok.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        });

        const response = await http.post<{ choices: Array<{ message: { content: string } }> }>(
          '/chat/completions',
          {
            model: config.grok.model,
            messages,
            temperature: 0.85,
            max_tokens: 300,
            top_p: 0.95,
          }
        );

        reply = response.data.choices[0]?.message?.content?.trim() ?? '';
        if (!reply) throw new Error('Empty response from Grok API');
      } else {
        reply = await grokClient.generateReply(history, text);
      }
    } else {
      reply = await grokClient.generateReply(history, text);
    }
  }

  // Send using the per-connection access token if available
  if (connection?.access_token) {
    await sendMessageWithToken(senderId, reply, connection.access_token, config.meta.apiVersion);
  } else {
    await igClient.sendMessage(senderId, reply);
  }

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
          const recipientId = event.recipient.id;
          const text = event.message?.text;
          const mid = event.message?.mid;

          // Skip messages from the bot's own account
          if (senderId === config.meta.instagramAccountId) continue;
          if (!text || !mid) continue;

          handleIncomingMessage(senderId, mid, text, recipientId).catch((err) => {
            logger.error({ err, senderId }, 'Error handling incoming message');
          });
        }
      }
    }
  );
}
