// Compiles src/ to dist/ with .js extensions rewritten for Node ESM.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

spawnSync('npx', ['tsc'], { stdio: 'inherit' });

const root = join(process.cwd(), 'dist');
mkdirSync(root, { recursive: true });

function fix(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) fix(p);
    else if (entry.endsWith('.js')) {
      let text = readFileSync(p, 'utf8');
      text = text.replace(/from '(\.[^']*?)'/g, (m, spec) => (spec.endsWith('.js') ? m : `from '${spec}.js'`));
      writeFileSync(p, text);
    }
  }
}

fix(root);
