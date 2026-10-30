import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger, requestContext } from './logger.js';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);

export const notFoundRoute: RequestHandler = (req, _res, next) =>
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));

/** One error shape for every failure: { error: { code, message, details?, requestId } }. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = requestContext.getStore()?.requestId;
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = 'A record with these values already exists';
    } else if (err.code === 'P2025' || err.code === 'P2003') {
      status = err.code === 'P2025' ? 404 : 400;
      code = err.code === 'P2025' ? 'NOT_FOUND' : 'INVALID_REFERENCE';
      message = err.code === 'P2025' ? 'Record not found' : 'Referenced record does not exist';
    }
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  }

  const logFields = { err, status, code, method: req.method, path: req.path };
  if (status >= 500) logger.error(logFields, 'request failed');
  else logger.warn({ status, code, method: req.method, path: req.path, details }, 'request rejected');

  res.status(status).json({ error: { code, message, details, requestId } });
};
