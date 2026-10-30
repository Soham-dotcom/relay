import { execSync } from 'node:child_process';

/** Brings the test database schema up to date before any test runs. */
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://relay:relay@localhost:5433/relay_test' },
  });
}
