import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests use a separate database. Locally: `npm run db:local`; in CI: a Postgres service.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://relay:relay@localhost:5433/relay_test',
      GEMINI_API_KEY: '',
      LOG_LEVEL: 'silent',
    },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
  },
});
