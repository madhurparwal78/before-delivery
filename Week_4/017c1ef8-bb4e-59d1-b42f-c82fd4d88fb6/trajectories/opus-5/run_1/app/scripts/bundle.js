/* Bundles the browser client and copies static assets into dist/public. */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist', 'public');

fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true });

esbuild
  .build({
    entryPoints: [path.join(root, 'src', 'client', 'main.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['chrome120', 'firefox120', 'safari17'],
    outfile: path.join(outDir, 'app.js'),
    logLevel: 'info',
  })
  .then(() => {
    fs.copyFileSync(path.join(root, 'src', 'client', 'styles.css'), path.join(outDir, 'app.css'));
    const fontSrc = path.join(root, 'assets', 'fonts');
    for (const file of fs.readdirSync(fontSrc)) {
      if (!file.endsWith('.woff2')) continue;
      fs.copyFileSync(path.join(fontSrc, file), path.join(outDir, 'fonts', file));
    }
    fs.copyFileSync(
      path.join(root, 'src', 'server', 'schema.sql'),
      path.join(root, 'dist', 'server', 'schema.sql'),
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
