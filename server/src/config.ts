import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Optional on purpose: without a key the app still works, AI features report "unavailable".
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-001'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_FILE: z.string().default('logs/app.log'),
  WEB_DIST: z.string().optional(),
  // Signs login tokens. Must be set (and secret) in production; a fixed value is fine locally.
  JWT_SECRET: z.string().min(16).optional(),
  JWT_TTL: z.string().default('8h'),
});

const parsed = schema
  .refine((c) => c.NODE_ENV !== 'production' || Boolean(c.JWT_SECRET), { message: 'JWT_SECRET is required in production', path: ['JWT_SECRET'] })
  .safeParse(process.env);
if (!parsed.success) {
  // Fail fast at boot with a readable message instead of a crash deep inside a request.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const jwtSecret = config.JWT_SECRET ?? 'local-dev-secret-not-for-production';
export const aiEnabled = Boolean(config.GEMINI_API_KEY);
