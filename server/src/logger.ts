import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { config } from './config.js';

/** Holds the request ID for the request being handled, so every log line carries it. */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

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
      return ctx ? { requestId: ctx.requestId } : {};
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
