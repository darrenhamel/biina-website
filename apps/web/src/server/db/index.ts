import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Lazy database singleton.
 *
 * The client is created on first use, NOT at import time, so importing this
 * module (e.g. during `next build`) never opens a connection and never requires
 * DATABASE_URL to be present at build time. Connections happen only at request
 * time, on the server. Credentials live only in the server environment.
 */

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _client: ReturnType<typeof postgres> | null = null;
let _db: DB | null = null;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and start Postgres (docker compose up -d).',
    );
  }
  return url;
}

export function getDb(): DB {
  if (!_db) {
    _client = postgres(connectionString(), { max: 10 });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export { schema };
