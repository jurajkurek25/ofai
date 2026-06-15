import axios, { AxiosError } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { getSystemPrompt } from '../prompts/systemPrompt';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const CONTEXT_WINDOW = 10; // number of past messages to include for context

export class GrokClient {
  private readonly http = axios.create({
    baseURL: config.grok.baseUrl,
    headers: {
      Authorization: `Bearer ${config.grok.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });

  async generateReply(history: ChatMessage[], userMessage: string): Promise<string> {
    const recentHistory = history.slice(-CONTEXT_WINDOW);

    const messages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt() },
      ...recentHistory,
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await this.http.post<{
        choices: Array<{ message: { content: string } }>;
      }>('/chat/completions', {
        model: config.grok.model,
        messages,
        temperature: 0.85,
        max_tokens: 300,
        top_p: 0.95,
      });

      const reply = response.data.choices[0]?.message?.content?.trim();
      if (!reply) throw new Error('Empty response from Grok API');
      return reply;
    } catch (err) {
      if (err instanceof AxiosError) {
        logger.error({ status: err.response?.status, data: err.response?.data }, 'Grok API error');
        throw new Error(`Grok API error: ${err.response?.status ?? 'network'}`);
      }
      throw err;
    }
  }
}

export const grokClient = new GrokClient();
