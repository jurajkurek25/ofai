import axios, { AxiosError } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';

const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;

export interface IGMessage {
  id: string;
  message: string;
  from: { id: string; username?: string };
  created_time: string;
}

export interface IGConversation {
  id: string;
  participants: { data: Array<{ id: string; username?: string }> };
  updated_time: string;
}

export class InstagramClient {
  private readonly token = config.meta.accessToken;
  private readonly accountId = config.meta.instagramAccountId;

  private get params() {
    return { access_token: this.token };
  }

  async sendMessage(recipientId: string, message: string): Promise<void> {
    try {
      await axios.post(
        `${BASE}/me/messages`,
        {
          recipient: { id: recipientId },
          message: { text: message },
          messaging_type: 'RESPONSE',
        },
        { params: this.params, timeout: 15_000 }
      );
      logger.debug({ recipientId }, 'Message sent via Instagram API');
    } catch (err) {
      if (err instanceof AxiosError) {
        logger.error({ status: err.response?.status, data: err.response?.data }, 'Instagram send error');
        throw new Error(`Instagram API send error: ${err.response?.status}`);
      }
      throw err;
    }
  }

  async getConversations(): Promise<IGConversation[]> {
    try {
      const res = await axios.get<{ data: IGConversation[] }>(
        `${BASE}/${this.accountId}/conversations`,
        {
          params: {
            ...this.params,
            platform: 'instagram',
            fields: 'id,participants,updated_time',
          },
          timeout: 15_000,
        }
      );
      return res.data.data ?? [];
    } catch (err) {
      if (err instanceof AxiosError) {
        logger.error({ status: err.response?.status, data: err.response?.data }, 'getConversations error');
      }
      return [];
    }
  }

  async getMessages(conversationId: string): Promise<IGMessage[]> {
    try {
      const res = await axios.get<{ data: IGMessage[] }>(
        `${BASE}/${conversationId}/messages`,
        {
          params: {
            ...this.params,
            fields: 'id,message,from,created_time',
          },
          timeout: 15_000,
        }
      );
      return res.data.data ?? [];
    } catch (err) {
      if (err instanceof AxiosError) {
        logger.error({ conversationId, status: err.response?.status }, 'getMessages error');
      }
      return [];
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    try {
      await axios.post(
        `${BASE}/me/messages`,
        { recipient: { id: messageId }, sender_action: 'mark_seen' },
        { params: this.params, timeout: 10_000 }
      );
    } catch {
      // non-critical — don't propagate
    }
  }
}

export const igClient = new InstagramClient();
