import cron from 'node-cron';
import { config } from '../config/config';
import { igClient } from '../services/instagram';
import { grokClient } from '../services/grok';
import { conversationService } from '../services/conversation';
import { isSpam, containsSensitiveRequest, sanitizeForLog } from '../utils/spam';
import { logger } from '../utils/logger';

async function pollConversations(): Promise<void> {
  logger.debug('Polling Instagram conversations...');
  const conversations = await igClient.getConversations();

  for (const conv of conversations) {
    const messages = await igClient.getMessages(conv.id);

    // Process messages in chronological order
    for (const msg of messages.reverse()) {
      const senderId = msg.from.id;
      const text = msg.message?.trim();
      const mid = msg.id;

      if (!text || !mid) continue;
      if (senderId === config.meta.instagramAccountId) continue;
      if (conversationService.isMessageProcessed(mid)) continue;

      conversationService.markMessageProcessed(mid);
      conversationService.getOrCreateUser(senderId, msg.from.username);

      if (conversationService.isBlocked(senderId)) continue;
      if (!conversationService.checkRateLimit(senderId)) continue;
      if (isSpam(text)) {
        logger.info({ senderId, text: sanitizeForLog(text) }, 'Spam detected (poll)');
        continue;
      }

      conversationService.addMessage(senderId, 'user', text, mid);

      let reply: string;
      const override = conversationService.getPendingOverride(senderId);

      if (override) {
        reply = override;
      } else if (containsSensitiveRequest(text)) {
        reply = "hey, i appreciate the message but that's not something i can help with 🙏";
      } else {
        const history = conversationService.getHistory(senderId);
        reply = await grokClient.generateReply(history, text);
      }

      await igClient.sendMessage(senderId, reply);
      conversationService.addMessage(senderId, 'assistant', reply);
      logger.info({ senderId }, 'Polling: reply sent');
    }
  }
}

export function startPoller(): void {
  const interval = Math.max(config.polling.intervalSeconds, 15);
  logger.info({ interval }, 'Starting polling job');

  // Convert seconds to a cron expression (minimum 15 s)
  const cronExpr = `*/${interval} * * * * *`;

  cron.schedule(cronExpr, () => {
    pollConversations().catch((err) => logger.error({ err }, 'Poller error'));
  });
}
