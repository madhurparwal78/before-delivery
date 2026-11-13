// Build script: compiles server TypeScript, bundles client TypeScript and CSS,
// and copies the needed lucide icon SVGs into the dist tree.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const dist = join(root, 'dist');

mkdirSync(dist, { recursive: true });

// Compile the server to ESM JavaScript, then fix the extensionless relative
// imports tsc emits so node's ESM loader can resolve them.
execSync(
  `npx tsc -p tsconfig.server.json --outDir dist/server --module esnext --moduleResolution node --target es2022`,
  { cwd: root, stdio: 'inherit' },
);
for (const dir of ['dist/server/server', 'dist/server/domain']) {
  const fix = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        fix(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      let text = readFileSync(full, 'utf8');
      text = text.replace(
        /from '(\.[^']*)'/g,
        (m, p) =>
          p.endsWith('.js') || p.endsWith('.json') || p.startsWith('node:') ? m : `from '${p}.js'`,
      );
      text = text.replace(
        /import '(\.[^']*)'/g,
        (m, p) =>
          p.endsWith('.js') || p.endsWith('.json') || p.startsWith('node:') ? m : `import '${p}.js'`,
      );
      text = text.replace(
        /import\('(\.[^']*)'\)/g,
        (m, p) =>
          p.endsWith('.js') || p.endsWith('.json') || p.startsWith('node:') ? m : `import('${p}.js')`,
      );
      writeFileSync(full, text);
    }
  };
  fix(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
}

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  outfile: join(dist, 'public/app.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Client styles
const css = readFileSync(join(root, 'src/client/styles.css'), 'utf8');
writeFileSync(join(dist, 'public/app.css'), css);

// Lucide icon set: the icons the app uses, written as one JSON file.
const iconNames = JSON.parse(readFileSync(join(root, 'src/client/icons.json'), 'utf8'));
const lucideDir = join(root, 'node_modules/lucide-static/icons');
const icons = {};
for (const name of iconNames) {
  const svg = readFileSync(join(lucideDir, `${name}.svg`), 'utf8');
  icons[name] = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').trim();
}
writeFileSync(join(dist, 'public/icons.json'), JSON.stringify(icons));

cpSync(join(root, 'public'), join(dist, 'public'), { recursive: true });
console.log('build complete');

