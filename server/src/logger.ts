import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { config } from './config.js';

/** Holds the request ID (and, once signed in, the user) so every log line carries them. */
export const requestContext = new AsyncLocalStorage<{ requestId: string; userId?: string }>();

const streams: pino.StreamEntry[] = [
  { level: config.LOG_LEVEL as pino.Level, stream: process.stdout },
];
if (config.LOG_LEVEL !== 'silent') {
  streams.push({
    level: config.LOG_LEVEL as pino.Level,
    stream: pino.destination({ dest: config.LOG_FILE, mkdir: true, sync: false }),
  });
}

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    base: { service: 'relay-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Attach the current request ID to every line logged inside a request.
    mixin() {
      const ctx = requestContext.getStore();
      if (!ctx) return {};
      return ctx.userId ? { requestId: ctx.requestId, userId: ctx.userId } : { requestId: ctx.requestId };
    },
    // Never write secrets: auth headers, cookies, API keys, connection strings.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        '*.apiKey',
        '*.GEMINI_API_KEY',
        '*.DATABASE_URL',
        '*.password',
      ],
      censor: '[REDACTED]',
    },
  },
  pino.multistream(streams),
);
