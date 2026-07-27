import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from './client.js';

/**
 * Apply SQL migrations at service startup.
 *
 * The SQL files predate Drizzle's journal format, so this small runner keeps a
 * migration ledger of its own. It also avoids relying on the development-only
 * drizzle-kit CLI at production startup.
 */
async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _teacheros_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const alreadyApplied = await pool.query<{ name: string }>(
        'SELECT name FROM _teacheros_migrations WHERE name = $1',
        [file]
      );
      if (alreadyApplied.rowCount) continue;

      const sql = await readFile(join(migrationsDirectory, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _teacheros_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    console.info('Database migrations completed.');
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error('Database migration failed.', error);
  process.exitCode = 1;
});
