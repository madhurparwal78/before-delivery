import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
mkdirSync(join(root, 'dist', 'public', 'fonts'), { recursive: true });
mkdirSync(join(root, 'dist', 'public', 'assets'), { recursive: true });
cpSync(join(root, 'fonts'), join(root, 'dist', 'public', 'fonts'), { recursive: true });
cpSync(join(root, 'src', 'public'), join(root, 'dist', 'public'), { recursive: true });
cpSync(join(root, 'src', 'db', 'schema.sql'), join(root, 'dist', 'db', 'schema.sql'));
console.log('assets copied');
