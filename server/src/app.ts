import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { errorHandler, notFoundRoute } from './errors.js';
import { logger, requestContext } from './logger.js';
import { api } from './routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Correlation ID: reuse the caller's x-request-id if sane, else make one; echo it back.
  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', requestId);
    requestContext.run({ requestId }, next);
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => res.getHeader('x-request-id') as string,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      // Keep access lines short: method, url, status, time. Bodies are never logged.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', api);
  app.use('/api', notFoundRoute);

  // In production the same service serves the built React app.
  const webDist = config.WEB_DIST ?? path.resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
