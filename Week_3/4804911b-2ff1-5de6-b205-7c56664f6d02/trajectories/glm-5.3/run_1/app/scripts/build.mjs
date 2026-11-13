import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

// The client compiles to plain JS with no module imports at runtime: the server
// inlines it into the page, so the browser loads only the app's own origin.
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

// The schema travels with the server so applying it on every serve works.
copyFileSync(join(root, 'src', 'server', 'db', 'schema.sql'), join(dist, 'server', 'db', 'schema.sql'));

// Fonts and icons ship with the app and load from its own origin.
const out = join(dist, 'client', 'assets');
mkdirSync(out, { recursive: true });

function copyFont(pkg, name, styles) {
  const srcDir = join(root, 'node_modules', '@fontsource', pkg, 'files');
  const css = [];
  for (const spec of styles) {
    // bebas-neue ships `<name>-latin-<weight>-normal.woff2`; eb-garamond ships
    // `<name>-latin-<weight>[-italic].woff2`, so try both spellings.
    const candidates = [
      `${name}-latin-${spec}-normal.woff2`,
      `${name}-latin-${spec}.woff2`,
    ];
    const found = candidates.find((f) => existsSync(join(srcDir, f)));
    if (!found) throw new Error(`missing font file ${name} ${spec}`);
    copyFileSync(join(srcDir, found), join(out, found));
    const [weight, style] = spec.split('-');
    const family = pkg === 'bebas-neue' ? 'Bebas Neue' : 'EB Garamond';
    css.push(
      `@font-face{font-family:'${family}';font-style:${style === 'italic' ? 'italic' : 'normal'};font-display:swap;font-weight:${weight};src:url('/assets/${found}') format('woff2');}`
    );
  }
  return css;
}

const fontCss = [
  copyFont('bebas-neue', 'bebas-neue', ['400']),
  copyFont('eb-garamond', 'eb-garamond', ['400', '400-italic', '600', '600-italic']),
].join('\n');
writeFileSync(join(out, 'fonts.css'), fontCss);

// Phosphor icons: the shipped regular weight.
copyFileSync(
  join(root, 'node_modules', '@phosphor-icons', 'web', 'src', 'regular', 'Phosphor.woff2'),
  join(out, 'Phosphor.woff2')
);
const iconCss = readFileSync(join(root, 'node_modules', '@phosphor-icons', 'web', 'src', 'regular', 'style.css'), 'utf8');
writeFileSync(
  join(out, 'icons.css'),
  iconCss.replace(/url\("\.\/Phosphor\.(woff2|woff|ttf)/g, (_m, ext) => `url("/assets/Phosphor.${ext}`)
);

// The app stylesheet, written by hand and shipped as-is.
copyFileSync(join(root, 'src', 'client', 'styles', 'app.css'), join(out, 'app.css'));

// The client is an ES module graph; every file is served from the app's origin.
const clientDir = join(dist, 'client');
for (const f of readdirSync(clientDir)) {
  if (f.endsWith('.js')) copyFileSync(join(clientDir, f), join(out, f));
}
console.log('client assets built');
