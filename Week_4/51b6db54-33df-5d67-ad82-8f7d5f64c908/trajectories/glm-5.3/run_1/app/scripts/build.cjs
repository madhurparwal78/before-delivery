// Builds the client bundle, the server output and typechecks everything.
// Build tooling only: the shipped domain logic is strict TypeScript under src/.
const { execSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } = require('node:fs');
const path = require('node:path');

mkdirSync('public', { recursive: true });
mkdirSync('build', { recursive: true });

// 1. typecheck the whole tree (strict TypeScript for all domain logic)
execSync('npx tsc --noEmit --project tsconfig.check.json', { stdio: 'inherit' });

// 2. run the shared rule self-checks
execSync('npx tsc src/shared/rules.ts src/shared/rules.test.ts --outDir build/check --module nodenext --target es2022 --moduleResolution nodenext --strict --skipLibCheck --verbatimModuleSyntax false --types node', { stdio: 'inherit' });
execSync('node build/check/rules.test.js', { stdio: 'inherit' });

// 3. compile the server to CommonJS for plain node
execSync('npx tsc --project tsconfig.server.json', { stdio: 'inherit' });
// the package is type: module, so the compiled CommonJS output needs its own marker
writeFileSync(path.join('build', 'server', 'package.json'), JSON.stringify({ type: 'commonjs' }));

// 4. transpile the client with tsc, then bundle the emitted JS
rmSync('build/client', { recursive: true, force: true });
execSync('npx tsc --project tsconfig.client.json', { stdio: 'inherit' });
bundleClient();

// 5. copy fonts
for (const font of ['stack-sans-headline.woff2', 'stack-sans-text.woff2']) {
  const src = path.join('fonts', font);
  if (existsSync(src)) copyFileSync(src, path.join('public', font));
}

console.log('build done');

function bundleClient() {
  const entry = path.resolve('build/client/client/main.js');
  const modules = new Map();
  collectModules(entry, new Set(), modules);
  // emit in discovery order so every dependency precedes its importer
  const parts = [];
  for (const [abs, info] of modules) {
    if (abs === entry) continue;
    parts.push(moduleText(abs, info, modules));
  }
  const entryInfo = modules.get(entry);
  if (!entryInfo) throw new Error('entry module missing');
  parts.push(moduleText(entry, entryInfo, modules, true));
  writeFileSync(path.join('public', 'main.js'), parts.join('\n'));
}

function collectModules(file, seen, modules) {
  const abs = path.resolve(file);
  if (seen.has(abs)) return;
  seen.add(abs);
  moduleNameFor(abs);
  const source = readFileSync(abs, 'utf8');
  const deps = [];
  const importLine = /^import\s+(?:\{([^}]*)\}|(\w+)(?:\s*,\s*\{([^}]*)\})?)\s+from\s+'([^']+)';\s*$/;
  const exportFrom = /^export\s+\{([^}]*)\}\s+from\s+'([^']+)';\s*$/;
  for (const line of source.split('\n')) {
    const exFrom = line.match(exportFrom);
    const m = line.match(importLine);
    const spec = exFrom ? exFrom[2] : m ? m[4] : null;
    if (spec && spec.startsWith('.')) deps.push(resolveImport(abs, spec));
  }
  for (const dep of deps) collectModules(dep, seen, modules);
  modules.set(abs, { source, deps });
}

function moduleText(abs, info, modules, isEntry = false) {
  const moduleName = moduleNameFor(abs);
  const lines = info.source.split('\n');
  const out = [];
  const importLine = /^import\s+(?:\{([^}]*)\}|(\w+)(?:\s*,\s*\{([^}]*)\})?)\s+from\s+'([^']+)';\s*$/;
  const exportFrom = /^export\s+\{([^}]*)\}\s+from\s+'([^']+)';\s*$/;
  const usedModules = new Set();
  for (const line of lines) {
    const exFrom = line.match(exportFrom);
    if (exFrom) {
      const target = resolveImport(abs, exFrom[2]);
      const targetName = moduleNameFor(path.resolve(target));
      usedModules.add(targetName);
      const names = exFrom[1].split(',').map((n) => n.trim()).filter(Boolean);
      out.push(names.map((n) => {
        const parts = n.split(/\s+as\s+/);
        const imported = parts[0].trim();
        const local = (parts[1] ?? parts[0]).trim();
        return `const ${local} = ${targetName}.${imported};`;
      }).join('\n'));
      continue;
    }
    const m = line.match(importLine);
    if (m) {
      const target = resolveImport(abs, m[4]);
      const targetName = moduleNameFor(path.resolve(target));
      usedModules.add(targetName);
      if (m[2] !== undefined && m[3] === undefined) {
        out.push(`const ${m[2]} = ${targetName};`);
      } else {
        const nameList = (m[1] ?? m[3] ?? '').trim();
        const names = nameList.split(',').map((n) => n.trim()).filter(Boolean);
        out.push(names.map((n) => {
          const parts = n.split(/\s+as\s+/);
          const imported = parts[0].trim();
          const local = (parts[1] ?? parts[0]).trim();
          return `const ${local} = ${targetName}.${imported};`;
        }).join('\n'));
        if (m[2] !== undefined && m[3] !== undefined) out.push(`const ${m[2]} = ${targetName};`);
      }
      continue;
    }
    if (/^\s*import\s+'[^']+';\s*$/.test(line)) continue;
    const deExport = line
      .replace(/^export\s+async\s+function\s+/, `async function `)
      .replace(/^export\s+function\s+/, `function `)
      .replace(/^export\s+const\s+/, `const `)
      .replace(/^export\s+let\s+/, `let `)
      .replace(/^export\s+class\s+/, `class `)
      .replace(/^export\s+enum\s+/, `enum `)
      .replace(/^export\s+type\s+\{[^}]*\};\s*$/, '')
      .replace(/^export\s+type\s+\w+[^;]*;\s*$/, '');
    out.push(deExport);
  }
  const body = out.join('\n');
  const exports = exportsOf(abs);
  const prologue = [...usedModules].map((n) => `void ${n};`).join('\n');
  if (isEntry) {
    return `${prologue}\n${body}`;
  }
  return `const ${moduleName} = (() => {\n${prologue}\n${body}\nreturn {\n${exports.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(',\n')}\n};\n})();\n`;
}

function exportsOf(file) {
  const source = readFileSync(file, 'utf8');
  const names = [];
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)) names.push(match[1]);
  for (const match of source.matchAll(/^export\s+default\s+(?:async\s+)?(?:function|const|let|class)?\s*(\w+)/gm)) names.push(match[1]);
  return names;
}

function moduleNameFor(abs) {
  const store = globalThis;
  if (!store.__celmateModuleNames) store.__celmateModuleNames = new Map();
  const moduleNames = store.__celmateModuleNames;
  let name = moduleNames.get(abs);
  if (!name) {
    name = '__mod_' + (moduleNames.size + 1) + '_' + path.basename(abs, '.js').replace(/[^a-z0-9_]/gi, '_');
    moduleNames.set(abs, name);
  }
  return name;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) throw new Error(`unexpected external import ${spec} in ${fromFile}`);
  const base = path.join(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`]) {
    if (existsSync(candidate)) return path.resolve(candidate);
  }
  const stripped = base.replace(/\.ts$/, '.js');
  if (existsSync(stripped)) return path.resolve(stripped);
  throw new Error(`cannot resolve ${spec} from ${fromFile}`);
}
