// Runs a throwaway Postgres on localhost:5433 for development and tests (no Docker needed).
// Usage: npm run db:local   (Ctrl+C to stop). DATABASE_URL=postgresql://relay:relay@localhost:5433/relay
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const dir = new URL('../.pgdata', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'relay',
  password: 'relay',
  port: 5433,
  persistent: true,
});

const fresh = !existsSync(dir);
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase('relay');
  await pg.createDatabase('relay_test');
}
console.log('Postgres ready on localhost:5433 (databases: relay, relay_test). Ctrl+C to stop.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
