import { app } from './src/app.js';
import { env } from './src/config/env.js';
import { connectDatabase, disconnectDatabase } from './src/config/database.js';
import { logger } from './src/config/logger.js';
import { cleanupExpiredUploads } from './src/services/cleanup.service.js';
import { resumePendingUploads } from './src/services/youtube.service.js';

let server;
try {
  await connectDatabase();
  server = app.listen(env.port, () => logger.info({ port: env.port, environment: env.nodeEnv }, `Mihad AI listening at ${env.appUrl}`));
  cleanupExpiredUploads().catch((error) => logger.warn({ err: error }, 'Upload cleanup skipped'));
  resumePendingUploads().then((count) => count && logger.info({ count }, 'Recovered queued uploads')).catch((error) => logger.warn({ err: error }, 'Upload recovery skipped'));
  setInterval(() => cleanupExpiredUploads().catch(() => {}), 60 * 60 * 1000).unref();
} catch (error) {
  logger.fatal({ err: error }, 'Application failed to start');
  process.exit(1);
}

async function shutdown(signal) {
  logger.info({ signal }, 'Graceful shutdown started');
  server?.close(async () => {
    await disconnectDatabase().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => logger.error({ err: error }, 'Unhandled rejection'));
