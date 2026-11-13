import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';

rmSync('dist/client', { recursive: true, force: true });
mkdirSync('dist/client', { recursive: true });
mkdirSync('dist/public/fonts', { recursive: true });

const files = readdirSync('src/client');
for (const f of files) {
  if (!f.endsWith('.ts') || f === 'core.ts' || f === 'theme.ts') continue;
  const r = await build({
    entryPoints: [`src/client/${f}`],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
    write: false,
    outdir: 'dist/client',
  });
  for (const out of r.outputFiles) {
    const name = out.path.split(/[/\\]/).pop();
    writeFileSync(`dist/client/${name}`, out.text);
  }
}

const fonts = readdirSync('assets/fonts');
for (const f of fonts) {
  copyFileSync(`assets/fonts/${f}`, `dist/public/fonts/${f}`);
}

// Compile the server with tsc into dist
const { spawnSync } = await import('node:child_process');
const tsc = spawnSync('npx', ['tsc'], { stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// Styles served to both server-rendered pages and shells
copyFileSync('src/public/styles.css', 'dist/client/styles.css');

// HTML shells for the editor SPA pages
const css = readFileSync('src/public/styles.css', 'utf8');
const pageMap = {
  signin: 'signin-page', app: 'app-page', editor: 'editor-page',
  redirects: 'redirects-page', analytics: 'analytics-page', team: 'team-page',
  invite: 'invite-page', reader: 'reader-page',
};
for (const [base, bodyClass] of Object.entries(pageMap)) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Galley</title>
<style>
${css}
</style>
</head>
<body class="${bodyClass}">
<div id="root"></div>
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<script src="/client/${base}.js"></script>
</body>
</html>
`;
  writeFileSync(`dist/client/${base}.html`, html);
}
console.log('build complete');

