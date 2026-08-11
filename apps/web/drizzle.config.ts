import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config. `generate` creates SQL migrations from the schema WITHOUT
 * a database connection (offline). `migrate` / `push` need DATABASE_URL.
 */
export default {
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://biina:biina@localhost:5432/biina',
  },
  strict: true,
  verbose: true,
} satisfies Config;
