/**
 * The build: compile the server, bundle the browser layer, and assemble the
 * dist tree that `serve` runs from.
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import esbuild from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      copyDir(path.join(from, entry.name), path.join(to, entry.name));
    } else {
      fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
    }
  }
}

async function main(): Promise<void> {
  rmrf(dist);

  // 1. Compile the server with the project TypeScript compiler.
  cp.execSync(
    `"${process.execPath}" "${path.join(root, 'node_modules/typescript/bin/tsc')}" -p "${path.join(root, 'tsconfig.build.json')}"`,
    { stdio: 'inherit', cwd: root },
  );

  // 2. Bundle the browser layer.
  await esbuild.build({
    entryPoints: [path.join(root, 'src/main-client.ts')],
    bundle: true,
    minify: false,
    format: 'iife',
    target: 'es2022',
    outfile: path.join(dist, 'assets/app.js'),
    legalComments: 'none',
  });

  // 3. Assemble the dist tree: browser assets, fonts, catalogue template.
  copyDir(path.join(root, 'public/assets'), path.join(dist, 'assets'));
  fs.mkdirSync(path.join(dist, 'server/data'), { recursive: true });
  for (const file of fs.readdirSync(path.join(root, 'server/data'))) {
    if (file.endsWith('.xml')) {
      fs.copyFileSync(path.join(root, 'server/data', file), path.join(dist, 'server/data', file));
    }
  }

  process.stdout.write('build complete\n');
}

void main();
