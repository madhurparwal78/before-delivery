import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

/** The one build script: server, browser client, CSS and fonts. */
const outdir = 'dist';

fs.rmSync(path.resolve(outdir), { recursive: true, force: true });
fs.mkdirSync(path.resolve(outdir, 'client/assets'), { recursive: true });

// Server: bundle to CJS-free ESM, keeping packages external that need Node.
await esbuild.build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: `${outdir}/server/main.js`,
  packages: 'external',
  sourcemap: false,
});

// Client: one entry, hashed asset names.
const result = await esbuild.build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  outdir: `${outdir}/client/assets`,
  entryNames: 'app-[hash]',
  metafile: true,
  sourcemap: false,
  minify: true,
});

const entry = Object.keys(result.metafile.outputs).find((name) => name.endsWith('.js'));
if (entry === undefined) throw new Error('no client bundle produced');

const cssSource = fs.readFileSync('src/client/app.css', 'utf-8');
fs.writeFileSync(`${outdir}/client/assets/app.css`, cssSource);
for (const font of ['work-sans-var.woff2', 'sometype-mono-var.woff2']) {
  fs.copyFileSync(`assets/${font}`, `${outdir}/client/assets/${font}`);
}

const hashedCss = 'app.css';
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gatecut</title>
<link rel="stylesheet" href="/assets/${hashedCss}">
</head>
<body>
<div id="root"></div>
<script type="module" src="/assets/${path.basename(entry)}"></script>
</body>
</html>`;
fs.writeFileSync(`${outdir}/client/index.html`, html);
console.log(`built client ${path.basename(entry)}`);
