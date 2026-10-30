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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast at boot with a readable message instead of a crash deep inside a request.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const aiEnabled = Boolean(config.GEMINI_API_KEY);
