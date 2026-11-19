import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';

const result = spawnSync('npx', ['tsc', '-p', 'tsconfig.client.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

// The seed reads the schema at runtime, so it ships beside the compiled server.
mkdirSync('dist/server', { recursive: true });
copyFileSync('src/server/schema.sql', 'dist/server/schema.sql');
