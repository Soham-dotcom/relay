import { config, aiEnabled } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { createApp } from './app.js';

const server = createApp().listen(config.PORT, () => {
  logger.info({ event: 'server.started', port: config.PORT, ai: aiEnabled ? config.GEMINI_MODEL : 'disabled' }, 'Relay API listening');
});

const shutdown = (signal: string) => {
  logger.info({ event: 'server.stopping', signal }, 'shutting down');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
