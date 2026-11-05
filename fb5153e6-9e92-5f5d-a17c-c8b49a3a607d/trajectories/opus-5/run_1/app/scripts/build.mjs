import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const publicDir = resolve(dist, 'public');

function tsc(project) {
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', project], {
    cwd: root,
    stdio: 'inherit',
  });
}

await rm(dist, { recursive: true, force: true });

tsc('tsconfig.json');
tsc('tsconfig.client.json');

await mkdir(publicDir, { recursive: true });
await cp(resolve(root, 'assets/fonts'), resolve(publicDir, 'fonts'), { recursive: true });

// The palette lives in one place; the stylesheet gets it as custom properties.
const { palette } = await import(resolve(dist, 'server/shared/palette.js'));
const variables = [
  `  --bone: ${palette.bone};`,
  `  --ink: ${palette.ink};`,
  `  --ink-muted: ${palette.inkMuted};`,
  `  --stone: ${palette.stone};`,
  `  --teal: ${palette.teal};`,
  `  --teal-dark: ${palette.tealDark};`,
  `  --vermilion: ${palette.vermilion};`,
].join('\n');

const css = await readFile(resolve(root, 'assets/app.css'), 'utf8');
await writeFile(resolve(publicDir, 'app.css'), `:root {\n${variables}\n}\n\n${css}`, 'utf8');

process.stdout.write('Build complete.\n');
