import axios, { AxiosError } from 'axios';
import { db } from '../db/database';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { Persona, Product } from './personaService';
import { getPlanLimits } from './userService';

export interface TrendAnalysis {
  topic: string;
  trends: string[];
  viralPatterns: string[];
  suggestedAngles: string[];
  optimalHashtags: string[];
  summary: string;
}

export interface GeneratedContent {
  id: number;
  user_id: number;
  persona_id: number;
  trend_topic: string | null;
  caption: string;
  hashtags: string;
  image_url: string | null;
  content_type: string;
  platform: string;
  created_at: number;
}

const http = axios.create({
  baseURL: config.grok.baseUrl,
  headers: {
    Authorization: `Bearer ${config.grok.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 60_000,
});

async function callGrok(messages: Array<{ role: string; content: string }>, model = config.grok.model): Promise<string> {
  try {
    const response = await http.post<{ choices: Array<{ message: { content: string } }> }>(
      '/chat/completions',
      { model, messages, temperature: 0.8, max_tokens: 1000 }
    );
    const text = response.data.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty response from Grok');
    return text;
  } catch (err) {
    if (err instanceof AxiosError) {
      logger.error({ status: err.response?.status, data: err.response?.data }, 'Grok content error');
      throw new Error(`Grok API error: ${err.response?.status ?? 'network'}`);
    }
    throw err;
  }
}

export async function analyzeTrends(topic?: string): Promise<TrendAnalysis> {
  const topicStr = topic || 'general Instagram lifestyle and content creator trends';

  const prompt = `You are a social media trend analyst. Analyze current viral trends on Instagram related to: "${topicStr}".

Respond in JSON format with this exact structure:
{
  "topic": "${topicStr}",
  "trends": ["trend1", "trend2", "trend3", "trend4", "trend5"],
  "viralPatterns": ["pattern1", "pattern2", "pattern3"],
  "suggestedAngles": ["angle1", "angle2", "angle3"],
  "optimalHashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5", "#hashtag6", "#hashtag7", "#hashtag8", "#hashtag9", "#hashtag10"],
  "summary": "A brief 2-3 sentence summary of the trend landscape."
}`;

  const raw = await callGrok([{ role: 'user', content: prompt }]);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]) as TrendAnalysis;
  } catch {
    return {
      topic: topicStr,
      trends: ['Authentic behind-the-scenes content', 'Day-in-the-life vlogs', 'Tutorial reels', 'Aesthetic flat lays', 'Relatable humor'],
      viralPatterns: ['Hook in first 2 seconds', 'Clear value proposition', 'Strong CTA'],
      suggestedAngles: ['Personal story angle', 'Educational content', 'Entertainment + value'],
      optimalHashtags: ['#contentcreator', '#instagram', '#lifestyle', '#aesthetic', '#viral', '#fyp', '#trending', '#reels', '#influencer', '#creator'],
      summary: raw.slice(0, 300),
    };
  }
}

export async function generateContent(
  userId: number,
  userPlan: string,
  persona: Persona,
  products: Product[],
  trendData: TrendAnalysis | null,
  contentType: 'post' | 'reel' | 'story'
): Promise<GeneratedContent> {
  const limits = getPlanLimits(userPlan);
  if (!limits.contentGen) {
    throw new Error('Content generation requires a Creator or Pro plan.');
  }

  const trendContext = trendData
    ? `Current trends: ${trendData.trends.slice(0, 3).join(', ')}. Viral patterns: ${trendData.viralPatterns.slice(0, 2).join(', ')}.`
    : 'Create engaging, authentic content.';

  const productMentions = products
    .filter((p) => p.is_active)
    .slice(0, 2)
    .map((p) => `${p.name} ($${p.price})`)
    .join(', ');

  const prompt = `You are a social media content strategist creating content for ${persona.name}, a ${persona.age}-year-old ${persona.nationality} content creator.

Persona personality: ${persona.personality}
Persona tone: ${persona.tone}
Content type: ${contentType}
${trendContext}
${productMentions ? `Products to subtly promote (optional): ${productMentions}` : ''}

Generate an engaging Instagram ${contentType} with:
1. A compelling caption (2-4 sentences, authentic to the persona's voice)
2. 15-20 relevant hashtags

Respond in JSON:
{
  "caption": "The full caption text here...",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3..."
}`;

  const raw = await callGrok([{ role: 'user', content: prompt }]);

  let caption = '';
  let hashtags = '';

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { caption: string; hashtags: string };
      caption = parsed.caption;
      hashtags = parsed.hashtags;
    } else {
      caption = raw.slice(0, 500);
      hashtags = trendData?.optimalHashtags?.join(' ') ?? '#content #creator #instagram';
    }
  } catch {
    caption = raw.slice(0, 500);
    hashtags = trendData?.optimalHashtags?.join(' ') ?? '#content #creator #instagram';
  }

  const result = db
    .prepare(
      `INSERT INTO generated_content (user_id, persona_id, trend_topic, caption, hashtags, content_type)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, persona.id, trendData?.topic ?? null, caption, hashtags, contentType);

  return db
    .prepare('SELECT * FROM generated_content WHERE id = ?')
    .get(result.lastInsertRowid as number) as GeneratedContent;
}

export function listContent(userId: number, page = 1, pageSize = 20): { content: GeneratedContent[]; total: number } {
  const offset = (page - 1) * pageSize;
  const total = (
    db.prepare('SELECT COUNT(*) as cnt FROM generated_content WHERE user_id = ?').get(userId) as { cnt: number }
  ).cnt;
  const content = db
    .prepare('SELECT * FROM generated_content WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(userId, pageSize, offset) as GeneratedContent[];
  return { content, total };
}

export function deleteContent(id: number, userId: number): void {
  const result = db.prepare('DELETE FROM generated_content WHERE id = ? AND user_id = ?').run(id, userId);
  if (result.changes === 0) throw new Error('Content not found');
}
