import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

mkdirSync(join(root, 'build/server/server/public'), { recursive: true });
cpSync(join(root, 'build/client'), join(root, 'build/server/server/public/client'), { recursive: true });
cpSync(join(root, 'public'), join(root, 'build/server/server/public'), { recursive: true });
console.log('assets copied:', existsSync(join(root, 'build/server/server/public/client/index.html')));
