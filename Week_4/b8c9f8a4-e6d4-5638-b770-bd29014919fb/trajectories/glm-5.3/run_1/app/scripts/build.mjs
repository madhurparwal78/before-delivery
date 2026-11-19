#!/usr/bin/env node
/** Build: download the Outfit font once, generate assets, compile server and client. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync('public/fonts', { recursive: true });

const fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/Outfit%5Bwght%5D.ttf';
const fontPath = 'public/fonts/outfit.ttf';
if (!fs.existsSync(fontPath)) {
  const reply = await fetch(fontUrl);
  if (!reply.ok) throw new Error(`font download failed: ${reply.status}`);
  fs.writeFileSync(fontPath, Buffer.from(await reply.arrayBuffer()));
  console.log('font downloaded');
} else {
  console.log('font already present');
}

execSync('node scripts/assets.mjs', { stdio: 'inherit' });

// Compile the server to dist-server as ESM.
fs.rmSync('dist-server', { recursive: true, force: true });
execSync('npx tsc -p tsconfig.server.json --outDir dist-server --noEmit false', { stdio: 'inherit' });

// Copy schema.sql next to the compiled server entry.
fs.copyFileSync('src/server/schema.sql', 'dist-server/schema.sql');

// Bundle the client with esbuild if present, else a plain tsc output.
const clientEntry = 'src/client/main.ts';
const outDir = 'dist';
fs.mkdirSync(outDir, { recursive: true });
let bundled = false;
try {
  execSync(`npx esbuild ${clientEntry} --bundle --outfile=${outDir}/main.js --format=esm --target=es2022 --minify`, { stdio: 'inherit' });
  bundled = true;
} catch {
  bundled = false;
}
if (!bundled) {
  console.error('esbuild missing; cannot bundle client');
  process.exit(1);
}

// Styles and shell.
fs.writeFileSync(`${outDir}/styles.css`,
  fs.readFileSync('src/client/styles/base.css') + '\n' + fs.readFileSync('src/client/styles/walkround.css'));
fs.copyFileSync('public/index.html', `${outDir}/index.html`);
for (const file of ['terrain.svg', 'story.svg', 'stage-still.svg']) {
  if (fs.existsSync(`public/${file}`)) fs.copyFileSync(`public/${file}`, `${outDir}/${file}`);
}
fs.mkdirSync(`${outDir}/fonts`, { recursive: true });
fs.copyFileSync(fontPath, `${outDir}/fonts/outfit.ttf`);


console.log('build complete');
