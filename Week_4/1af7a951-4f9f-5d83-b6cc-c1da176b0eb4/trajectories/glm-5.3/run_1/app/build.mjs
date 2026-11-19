// Build script: type-checks and compiles the server and the browser bundle,
// then writes styles, fonts and index.html into dist.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

rmSync(join(dist, 'assets'), { recursive: true, force: true });
rmSync(join(dist, 'server'), { recursive: true, force: true });
rmSync(join(dist, 'shared'), { recursive: true, force: true });

execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.server.json'], { stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.browser.json'], { stdio: 'inherit' });

mkdirSync(join(dist, 'assets', 'fonts'), { recursive: true });
copyFileSync(join(root, 'assets/styles.css'), join(dist, 'assets/styles.css'));
for (const f of readdirSync(join(root, 'assets/fonts'))) {
  if (f.endsWith('.woff2')) copyFileSync(join(root, 'assets/fonts', f), join(dist, 'assets/fonts', f));
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lanternfish</title>
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
<div id="app"></div>
<script src="/assets/app.js" type="module"></script>
</body>
</html>
`;
writeFileSync(join(dist, 'index.html'), html);
console.log('build complete');
