import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname;
const tsc = path.join(root, 'tools', 'typescript', 'lib', 'tsc');

const compile = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.json')]);
if (compile.status !== 0) {
  process.stdout.write(compile.stdout ?? '');
  process.stderr.write(compile.stderr ?? '');
  throw new Error('type check failed');
}

// Bundle the client into one ES module, in dependency order, with import rewrites.
const ordered = [];
const seen = new Set();
const refs = new Map();

function walk(file) {
  const resolved = path.resolve(file);
  if (seen.has(resolved)) return refs.get(resolved);
  seen.add(resolved);
  const ref = `mod${refs.size}`;
  refs.set(resolved, ref);

  let source = fs.readFileSync(resolved, 'utf8');
  const dir = path.dirname(resolved);
  const localImports = [];

  source = source.replace(/import type \{[^}]*\} from '(?:\.\.?\/[^']+)';\n?/g, '');
  source = source.replace(/import \* as (\w+) from '(\.\.?\/[^']+)';/g, (_m, name, relative) => {
    localImports.push({ name, file: path.resolve(dir, relative) });
    return '';
  });
  source = source.replace(/import \{([^}]+)\} from '(\.\.?\/[^']+)';/g, (_m, names, relative) => {
    localImports.push({ names, file: path.resolve(dir, relative) });
    return '';
  });

  const resolvedImports = localImports.map((item) => ({ ...item, ref: walk(item.file) }));

  const prelude = resolvedImports
    .map((item) => {
      if (item.name !== undefined) {
        return `const ${item.name} = ${item.ref};`;
      }
      const parts = item.names.split(',').map((part) => part.trim()).filter(Boolean);
      return parts
        .map((part) => {
          const [imported, local] = part.split(' as ').map((piece) => piece.trim());
          const target = local ?? imported;
          return `const ${target} = ${item.ref}.${imported};`;
        })
        .join('\n');
    })
    .join('\n');

  // Emitted after dependencies, so a module's own code can read them at load time.
  ordered.push({ ref, prelude, source });
  return ref;
}

function transformModule(source, ref) {
  let output = source;
  // Exported declarations become properties of the module's namespace object.
  output = output.replace(/export function (\w+)/g, (_m, name) => `function ${name}`);
  output = output.replace(/export async function (\w+)/g, (_m, name) => `async function ${name}`);
  output = output.replace(/export const (\w+) =/g, (_m, name) => `const ${name} =`);
  output = output.replace(/export let (\w+) =/g, (_m, name) => `let ${name} =`);
  output = output.replace(/export type ([\s\S]*?);\n?/g, '');
  output = output.replace(/export interface ([\s\S]*?)\n\}\n?/g, '');
  output = output.replace(/export enum (\w+)/g, (_m, name) => `enum ${name}`);
  return output;
}

function collectNames(source) {
  const names = [];
  for (const match of source.matchAll(/export (?:async )?function (\w+)/g)) names.push(match[1]);
  for (const match of source.matchAll(/export const (\w+)/g)) names.push(match[1]);
  for (const match of source.matchAll(/export let (\w+)/g)) names.push(match[1]);
  return names;
}

walk(path.join(root, 'dist', 'client', 'app.js'));

const bundle = ordered
  .map((mod) => {
    const names = collectNames(mod.source);
    const exports = names.map((name) => `${name},`).join('\n');
    return `const ${mod.ref} = (() => {\n${mod.prelude}\n${transformModule(mod.source, mod.ref)}\nreturn { ${exports} };\n})();`;
  })
  .join('\n');

fs.mkdirSync(path.join(root, 'dist', 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'public', 'app.js'), bundle);
fs.cpSync(path.join(root, 'public'), path.join(root, 'dist', 'public'), { recursive: true });
console.log('build done');
