import {readdir, readFile} from 'node:fs/promises';
/** Execute the same versioned SQL files that production migration applies. */
export async function applyTestMigrations(database: {exec: (sql: string) => Promise<unknown>}) {
  const directory = new URL('../../db/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await database.exec(await readFile(new URL(name, directory), 'utf8'));
  }
}
