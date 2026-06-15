import 'dotenv/config';
import { config } from './config/config';
import { logger } from './utils/logger';
import { runMigrations } from './db/migrations';
import { buildApp } from './server/app';
import { startPoller } from './jobs/poller';

async function main(): Promise<void> {
  runMigrations();

  const app = await buildApp();

  await app.listen({ port: config.app.port, host: '0.0.0.0' });
  logger.info(`🚀 Server listening on port ${config.app.port}`);
  logger.info(`📸 Webhook URL: http://<your-domain>/webhook`);

  if (config.polling.enabled) {
    startPoller();
  } else {
    logger.info('Polling disabled – using Meta webhook');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
