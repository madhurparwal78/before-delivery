#!/usr/bin/env node
/** Serve: apply the schema, seed, then run the compiled server. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('dist-server/main.js')) {
  console.error('The build output is missing. Run npm run build first.');
  process.exit(1);
}
const child = spawn(process.execPath, ['dist-server/main.js'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
