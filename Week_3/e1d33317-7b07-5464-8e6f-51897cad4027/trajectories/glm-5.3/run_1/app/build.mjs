import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname);

// typecheck first
execSync('npx tsc --noEmit -p tsconfig.json', { stdio: 'inherit', cwd: root });

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

// copy font files into dist/client/fonts
const fontsOut = path.join(root, 'dist/client/fonts');
fs.mkdirSync(fontsOut, { recursive: true });
const fontPackages = [
  { pkg: '@fontsource/bravura', prefix: 'bravura' },
  { pkg: '@fontsource/fraunces', prefix: 'fraunces' },
  { pkg: '@fontsource/ibm-plex-sans', prefix: 'ibm-plex-sans' },
  { pkg: '@fontsource/ibm-plex-mono', prefix: 'ibm-plex-mono' },
];
const wanted = [
  'bravura-latin-400-normal.woff2',
  'fraunces-latin-400-normal.woff2',
  'fraunces-latin-600-normal.woff2',
  'fraunces-latin-400-italic.woff2',
  'ibm-plex-sans-latin-400-normal.woff2',
  'ibm-plex-sans-latin-500-normal.woff2',
  'ibm-plex-sans-latin-600-normal.woff2',
  'ibm-plex-mono-latin-400-normal.woff2',
];
for (const name of wanted) {
  const pkg = fontPackages.find((f) => name.startsWith(f.prefix));
  if (!pkg) continue;
  const src = path.join(root, 'node_modules', pkg.pkg, 'files', name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(fontsOut, name));
}

// 2. build the server ( bundles nothing external; pg and ws stay external )
await esbuild.build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: path.join(root, 'dist'),
  outbase: path.join(root, 'src'),
  external: ['pg', 'pg-protocol', 'pg-cloudflare', 'pg-connection-string', 'pg-pool', 'ws'],
  packages: 'external',
  sourcemap: false,
});

// 3. build the client app
const clientResult = await esbuild.build({
  entryPoints: [path.join(root, 'src/client/main.tsx')],
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'esm',
  outdir: path.join(root, 'dist/client'),
  minify: true,
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  sourcemap: false,
  legalComments: 'none',
});
if (clientResult.errors.length > 0) {
  console.error(clientResult.errors);
  process.exit(1);
}

// 4. copy the shell and stylesheet
fs.copyFileSync(path.join(root, 'src/client/index.html'), path.join(root, 'dist/client/index.html'));
fs.copyFileSync(path.join(root, 'src/client/styles.css'), path.join(root, 'dist/client/app.css'));

console.log('build complete');
