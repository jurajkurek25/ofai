import pino from 'pino';
import { config } from '../config/config';

export const logger = pino(
  config.app.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
        level: 'debug',
      }
    : {
        level: 'info',
      }
);
