import { rm, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await rm(path.join(root, 'public', 'assets'), { recursive: true, force: true });
await rm(path.join(root, 'dist'), { recursive: true, force: true });

const depNames = Object.keys(pkg.dependencies);
const typeDepNames = Object.keys(pkg.devDependencies);

const clientResult = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/main.tsx'],
  outdir: 'public/assets',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  sourcemap: false,
  legalComments: 'none',
  minify: true,
  publicPath: '/assets',
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  write: true,
  entryNames: '[name]-[hash]',
  chunkNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
});

const clientOutputs = clientResult.metafile
  ? Object.keys(clientResult.metafile.outputs)
  : [];

const entryOutput = clientOutputs.find((file) => /^public\/assets\/main-[A-Z0-9]+\.js$/.test(file));
const cssOutput = clientOutputs.find((file) => /^public\/assets\/main-[A-Z0-9]+\.css$/.test(file));
if (!entryOutput || !cssOutput) {
  throw new Error('could not find the hashed client entry and stylesheet in the build output');
}
const entryAsset = `/${entryOutput.replace(/^public\//, '')}`;
const cssAsset = `/${cssOutput.replace(/^public\//, '')}`;
const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Halyard Hall Box Office</title>
  <link rel="stylesheet" href="${cssAsset}">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${entryAsset}"></script>
</body>
</html>
`;
await writeFile(path.join(root, 'public', 'index.html'), indexHtml);

const serverResult = await build({
  absWorkingDir: root,
  entryPoints: ['src/server/main.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  minify: false,
  packages: 'external',
  define: { 'process.env.NODE_ENV': '"production"' },
  outExtension: { '.js': '.mjs' },
});

await writeFile(
  path.join(root, 'dist', 'build-manifest.json'),
  JSON.stringify({ clientOutputs, generatedAt: new Date().toISOString() }, null, 2),
);

const notices = await generateNotices();
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices);
console.log(`build: ${clientOutputs.length} client assets, server bundle written, notices written`);

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(root, rel), 'utf8'));
}

async function licenseFileText(name) {
  const dir = path.join(root, 'node_modules', name);
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING', 'COPYING.txt'];
  for (const file of candidates) {
    try {
      return { file, text: await readFile(path.join(dir, file), 'utf8') };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function collectProdDeps() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const tree = JSON.parse(stdout);
  const seen = new Map();
  const walk = (node) => {
    for (const [name, info] of Object.entries(node.dependencies ?? {})) {
      if (seen.has(name)) continue;
      seen.set(name, { name, version: info.version ?? '?', license: 'UNKNOWN' });
      walk(info);
    }
  };
  walk(tree);
  for (const [name, entry] of seen) {
    try {
      const modulePkg = await readJson(path.join('node_modules', name, 'package.json'));
      entry.version = modulePkg.version ?? entry.version;
      entry.license = licenseOf(modulePkg);
    } catch {
      /* the package is an optional dependency that is not installed on this platform */
      seen.delete(name);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function licenseOf(modulePkg) {
  const license = modulePkg.license;
  if (typeof license === 'string') return license;
  if (Array.isArray(license)) return license.join(' OR ');
  if (license && typeof license === 'object' && license.type) return String(license.type);
  return 'UNKNOWN';
}

async function readJsonSafe(rel) {
  try {
    return await readJson(rel);
  } catch {
    return null;
  }
}

async function generateNotices() {
  const lines = [
    '# Third-party notices',
    '',
    'Halyard Seatwise bundles the following third-party packages (the production dependency tree of `npm ls --omit=dev --all`) and the bundled fonts below. Each entry lists its name, version and licence.',
    '',
  ];
  const prodRows = await collectProdDeps();
  lines.push('## Shipped packages', '');
  lines.push('| Package | Version | Licence |');
  lines.push('|---|---|---|');
  for (const row of prodRows) {
    lines.push(`| ${row.name} | ${row.version} | ${row.license} |`);
  }
  lines.push('');
  const fontRows = [];
  for (const name of depNames) {
    if (!name.startsWith('@fontsource/')) continue;
    const modulePkg = await readJson(path.join('node_modules', name, 'package.json'));
    const family = name
      .split('/')[1]
      .split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' ');
    fontRows.push({ name: family, version: modulePkg.version, license: licenseOf(modulePkg), source: name });
  }
  lines.push('## Bundled fonts', '');
  lines.push('| Font | Version | Package | Licence |');
  lines.push('|---|---|---|---|');
  for (const row of fontRows) {
    lines.push(`| ${row.name} | ${row.version} | ${row.source} | ${row.license} |`);
  }
  lines.push('');
  lines.push('Licence texts of the bundled packages follow.', '');
  for (const row of prodRows) {
    const licenseFile = await licenseFileText(row.name);
    lines.push(`### ${row.name} ${row.version}`, '');
    if (licenseFile) {
      lines.push('```text', licenseFile.text.trimEnd(), '```', '');
    } else {
      lines.push(`Licensed under ${row.license}.`, '');
    }
  }
  for (const row of fontRows) {
    const modulePkg = await readJson(path.join('node_modules', row.source, 'package.json'));
    const author = typeof modulePkg.author === 'object' && modulePkg.author ? modulePkg.author.name : 'Google Fonts';
    lines.push(`### ${row.name} (font files) ${row.version}`, '');
    lines.push(`© ${author}. The font files are licensed under ${row.license}.`, '');
  }
  return lines.join('\n') + '\n';
}
