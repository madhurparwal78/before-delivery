// Highwater build: compiles the TypeScript sources into dist/ and copies the
// public client bundle. Uses the TypeScript compiler API (Apache-2.0).
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const src = join(root, 'server');
const client = join(root, 'client');

const listFiles = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'public', 'assets'), { recursive: true });

const files = listFiles(src).concat(listFiles(client));

const compileOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  declaration: false,
  sourceMap: false,
  esModuleInterop: true,
  skipLibCheck: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
};

const host = ts.createCompilerHost(compileOptions);
const program = ts.createProgram(files, compileOptions, host);

const report = (d) => {
  const file = d.file ? relative(root, d.file.fileName) : '(config)';
  const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
  console.error(`error TS ${pos ? `${file}:${pos.line + 1}:${pos.character + 1}` : file}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
};

let failed = false;
for (const d of program.getOptionsDiagnostics().concat(program.getSyntacticDiagnostics(), program.getSemanticDiagnostics())) {
  if (d.category !== ts.DiagnosticCategory.Error) continue;
  failed = true;
  report(d);
}
if (failed) process.exit(1);

program.emit(undefined, (fileName, text) => {
  // TS passes output names like /app/app/client/app.js or client/app.js
  // depending on the common source root it computes; normalise to the part
  // after the project root and route client files to the public assets.
  const normalised = fileName.split('\\').join('/');
  const rootMarker = '/app/';
  const withinProject = normalised.includes(rootMarker) ? normalised.slice(normalised.indexOf(rootMarker) + rootMarker.length) : normalised;
  const isClient = withinProject.startsWith('client/');
  const relativeToClientOrServer = isClient ? withinProject.slice('client/'.length) : withinProject.replace(/^server\//, '');
  const outPath = isClient
    ? join(dist, 'public', 'assets', relativeToClientOrServer)
    : join(dist, relativeToClientOrServer);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
});

cpSync(join(client, 'styles.css'), join(dist, 'public', 'assets', 'styles.css'));
cpSync(join(client, 'shell.html'), join(dist, 'public', 'index.html'));
for (const name of ['finder.html', 'hold.html', 'console.html', 'shared.html']) {
  cpSync(join(client, 'shell.html'), join(dist, 'public', name));
}
cpSync(join(client, 'assets'), join(dist, 'public', 'assets'), { recursive: true });
console.log(`build complete: ${files.length} modules compiled`);
