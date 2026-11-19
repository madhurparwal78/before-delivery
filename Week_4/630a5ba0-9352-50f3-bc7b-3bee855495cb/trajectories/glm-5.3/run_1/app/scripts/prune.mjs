import fs from 'node:fs';
import path from 'node:path';

// Only the compiler's stray vite.config.js is removed; dist/src-shared is needed at runtime.
const stray = [path.resolve('dist/vite.config.js')];
for (const target of stray) {
  fs.rmSync(target, { force: true });
}
console.log('pruned stray build outputs');
