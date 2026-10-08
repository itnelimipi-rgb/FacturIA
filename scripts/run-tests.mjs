import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync(new URL('../tests/', import.meta.url)).filter(name => /\.test\.(ts|js|mjs)$/.test(name)).sort().map(name => `tests/${name}`);
if (!files.length) throw new Error('No hay pruebas reales para ejecutar');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {stdio: 'inherit'});
process.exit(result.status ?? 1);
