// Build helper: compiles the browser modules, copies fonts and the schema.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
execSync('npx tsc -p web/tsconfig.json', { stdio: 'inherit', cwd: root });

mkdirSync(join(root, 'public', 'fonts'), { recursive: true });
cpSync(join(root, 'web', 'fonts'), join(root, 'public', 'fonts'), { recursive: true });
cpSync(join(root, 'src', 'server', 'schema.sql'), join(root, 'dist', 'server', 'schema.sql'));
console.log('assets built');
