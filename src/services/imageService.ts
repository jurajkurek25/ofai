import axios, { AxiosError } from 'axios';
import { db } from '../db/database';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { Persona } from './personaService';
import { getPlanLimits } from './userService';

export interface GeneratedImage {
  id: number;
  user_id: number;
  persona_id: number;
  style: string;
  prompt: string;
  image_url: string;
  created_at: number;
}

const IMAGE_MODEL = 'grok-2-image-1212';

function buildImagePrompt(persona: Persona, style: string): string {
  const base = persona.avatar_prompt?.trim()
    ? persona.avatar_prompt
    : `${persona.age}-year-old ${persona.nationality} woman, content creator`;

  const styleMap: Record<string, string> = {
    'fashion editorial': 'high fashion editorial photography, studio lighting, vogue magazine style, elegant poses',
    'casual selfie': 'casual selfie photo, natural lighting, authentic candid feel, smartphone photo style',
    outdoor: 'outdoor lifestyle photography, golden hour lighting, natural scenery, vibrant colors',
    glamour: 'glamour photography, professional studio, dramatic lighting, luxury aesthetic',
    artistic: 'artistic portrait photography, creative composition, moody lighting, fine art style',
    custom: style,
  };

  const styleDesc = styleMap[style] ?? style;
  return `${base}, ${styleDesc}, photorealistic, high quality, 4k`;
}

function getMonthlyImageCount(userId: number): number {
  const startOfMonth = Math.floor(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000
  );
  const result = db
    .prepare('SELECT COUNT(*) as cnt FROM generated_images WHERE user_id = ? AND created_at >= ?')
    .get(userId, startOfMonth) as { cnt: number };
  return result.cnt;
}

export async function generateAvatar(
  userId: number,
  userPlan: string,
  persona: Persona,
  style: string,
  isNsfw: boolean
): Promise<GeneratedImage> {
  const limits = getPlanLimits(userPlan);

  if (limits.monthlyImages === 0) {
    throw new Error('Your plan does not include image generation. Upgrade to Creator or Pro.');
  }

  if (isFinite(limits.monthlyImages)) {
    const used = getMonthlyImageCount(userId);
    if (used >= limits.monthlyImages) {
      throw new Error(`Monthly image limit reached (${limits.monthlyImages}). Upgrade to Pro for unlimited.`);
    }
  }

  if (isNsfw && (!persona.is_nsfw_enabled || userPlan === 'free')) {
    throw new Error('NSFW generation requires NSFW enabled on the persona and a paid plan.');
  }

  const prompt = buildImagePrompt(persona, style);

  const http = axios.create({
    baseURL: config.grok.baseUrl,
    headers: {
      Authorization: `Bearer ${config.grok.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60_000,
  });

  try {
    const response = await http.post<{
      data: Array<{ url?: string; b64_json?: string }>;
    }>('/images/generations', {
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      response_format: 'url',
    });

    const imageUrl = response.data.data[0]?.url;
    if (!imageUrl) throw new Error('No image URL returned from API');

    const result = db
      .prepare(
        'INSERT INTO generated_images (user_id, persona_id, style, prompt, image_url) VALUES (?, ?, ?, ?, ?)'
      )
      .run(userId, persona.id, style, prompt, imageUrl);

    return db
      .prepare('SELECT * FROM generated_images WHERE id = ?')
      .get(result.lastInsertRowid as number) as GeneratedImage;
  } catch (err) {
    if (err instanceof AxiosError) {
      logger.error({ status: err.response?.status, data: err.response?.data }, 'Image generation error');
      throw new Error(`Image generation failed: ${err.response?.status ?? 'network error'}`);
    }
    throw err;
  }
}

export function listImages(userId: number, page = 1, pageSize = 20): { images: GeneratedImage[]; total: number } {
  const offset = (page - 1) * pageSize;
  const total = (
    db.prepare('SELECT COUNT(*) as cnt FROM generated_images WHERE user_id = ?').get(userId) as { cnt: number }
  ).cnt;
  const images = db
    .prepare('SELECT * FROM generated_images WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(userId, pageSize, offset) as GeneratedImage[];
  return { images, total };
}

export function deleteImage(id: number, userId: number): void {
  const result = db.prepare('DELETE FROM generated_images WHERE id = ? AND user_id = ?').run(id, userId);
  if (result.changes === 0) throw new Error('Image not found');
}
