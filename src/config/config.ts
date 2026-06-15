import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  meta: z.object({
    appId: z.string().min(1),
    appSecret: z.string().min(1),
    accessToken: z.string().min(1),
    verifyToken: z.string().min(1),
    instagramAccountId: z.string().min(1),
    apiVersion: z.string().default('v20.0'),
  }),
  grok: z.object({
    apiKey: z.string().min(1),
    model: z.string().default('grok-3'),
    baseUrl: z.string().default('https://api.x.ai/v1'),
  }),
  app: z.object({
    port: z.number().default(3000),
    nodeEnv: z.enum(['development', 'production', 'test']).default('production'),
    adminSecret: z.string().min(16),
  }),
  polling: z.object({
    enabled: z.boolean().default(false),
    intervalSeconds: z.number().default(30),
  }),
  limits: z.object({
    maxRepliesPerUserPerHour: z.number().default(10),
  }),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const raw = {
    meta: {
      appId: process.env.META_APP_ID ?? '',
      appSecret: process.env.META_APP_SECRET ?? '',
      accessToken: process.env.META_ACCESS_TOKEN ?? '',
      verifyToken: process.env.META_VERIFY_TOKEN ?? '',
      instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID ?? '',
      apiVersion: process.env.META_API_VERSION ?? 'v20.0',
    },
    grok: {
      apiKey: process.env.GROK_API_KEY ?? '',
      model: process.env.GROK_MODEL ?? 'grok-3',
      baseUrl: process.env.GROK_BASE_URL ?? 'https://api.x.ai/v1',
    },
    app: {
      port: parseInt(process.env.PORT ?? '3000', 10),
      nodeEnv: (process.env.NODE_ENV ?? 'production') as 'development' | 'production' | 'test',
      adminSecret: process.env.ADMIN_SECRET ?? '',
    },
    polling: {
      enabled: process.env.ENABLE_POLLING === 'true',
      intervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS ?? '30', 10),
    },
    limits: {
      maxRepliesPerUserPerHour: parseInt(process.env.MAX_REPLIES_PER_USER_PER_HOUR ?? '10', 10),
    },
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    console.error('❌ Invalid configuration:', result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
