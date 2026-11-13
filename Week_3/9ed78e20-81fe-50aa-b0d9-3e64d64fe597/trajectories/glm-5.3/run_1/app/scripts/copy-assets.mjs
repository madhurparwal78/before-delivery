import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dest = join(to, entry);
    if (statSync(src).isDirectory()) copyDir(src, dest);
    else cpSync(src, dest);
  }
}

// SQL files read at runtime by the server.
copyDir(join(root, 'src/db'), join(root, 'dist/db'));
// Static assets served from /assets.
copyDir(join(root, 'src/assets'), join(root, 'dist/assets'));
