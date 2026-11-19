// Strips TypeScript annotations from the browser modules so they run as
// plain ES modules. Interfaces and type-only constructs are removed.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'public/js';
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.js')) continue;
  const path = join(dir, name);
  let src = readFileSync(path, 'utf8');
  if (!/[:(]<[A-Za-z]|interface |: string|: number|: boolean/.test(src)) continue;

  let out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/^interface /.test(line)) {
      // Skip the interface block.
      while (i < lines.length && !/^\}/.test(lines[i])) i++;
      continue;
    }
    out.push(line);
  }
  src = out.join('\n');

  // Remove type annotations from function signatures and declarations.
  src = src.replace(/\(([^)]*)\)\s*:\s*Promise<[^>]+>/g, '($1)');
  src = src.replace(/\(([^)]*)\)\s*:\s*[A-Za-z<>\[\] |,]+\s*\{/g, '($1) {');
  src = src.replace(/const (\w+)(\s*)=(.*?):\s*[A-Za-z<>\[\] |,]+;/g, 'const $1$2= $3;');
  src = src.replace(/let (\w+)(\s*)=(.*?):\s*[A-Za-z<>\[\] |,]+;/g, 'let $1$2= $3;');
  src = src.replace(/:(?: Promise<[^>]+>|HTMLElement|HTMLElement\[\>|string(?:\[\])?|number(?:\[\])?|boolean|void|Keyframe\[\]|unknown(?:\[\])?|Record<string, unknown>|Record<string, string>|Array<[^>]+>)(?=[,)=;])/g, '');
  src = src.replace(/as never\b/g, '');
  src = src.replace(/as [A-Za-z<>\[\] |]+(?=[;)])/g, '');
  src = src.replace(/\bexport type \{[^}]*\};/g, '');
  writeFileSync(path, src);
  console.log('stripped', name);
}
