import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
const publicOut = path.join(out, 'public');

const fonts = [
  ['@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2', 'archivo-latin.woff2'],
  ['@fontsource-variable/archivo/files/archivo-latin-ext-standard-normal.woff2', 'archivo-latin-ext.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'plex-400-latin.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-400-normal.woff2', 'plex-400-latin-ext.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'plex-600-latin.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-600-normal.woff2', 'plex-600-latin-ext.woff2'],
];

const latin =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

const fontCss = `@font-face {
  font-family: 'Archivo Display';
  font-style: normal;
  font-display: block;
  font-weight: 100 900;
  font-stretch: 62% 125%;
  src: url(./fonts/archivo-latin.woff2) format('woff2-variations');
  unicode-range: ${latin};
}
@font-face {
  font-family: 'Archivo Display';
  font-style: normal;
  font-display: block;
  font-weight: 100 900;
  font-stretch: 62% 125%;
  src: url(./fonts/archivo-latin-ext.woff2) format('woff2-variations');
}
@font-face {
  font-family: 'Plex Body';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(./fonts/plex-400-latin.woff2) format('woff2');
  unicode-range: ${latin};
}
@font-face {
  font-family: 'Plex Body';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(./fonts/plex-400-latin-ext.woff2) format('woff2');
}
@font-face {
  font-family: 'Plex Body';
  font-style: normal;
  font-display: swap;
  font-weight: 600;
  src: url(./fonts/plex-600-latin.woff2) format('woff2');
  unicode-range: ${latin};
}
@font-face {
  font-family: 'Plex Body';
  font-style: normal;
  font-display: swap;
  font-weight: 600;
  src: url(./fonts/plex-600-latin-ext.woff2) format('woff2');
}
`;

execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
});

await rm(out, { recursive: true, force: true });
await mkdir(path.join(publicOut, 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outfile: path.join(out, 'server/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['better-sqlite3'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

await build({
  entryPoints: [path.join(root, 'src/client/main.ts')],
  outfile: path.join(publicOut, 'app.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  sourcemap: false,
});

await cp(path.join(root, 'src/client/index.html'), path.join(publicOut, 'index.html'));
await cp(path.join(root, 'src/client/styles.css'), path.join(publicOut, 'styles.css'));
await writeFile(path.join(publicOut, 'fonts.css'), fontCss);
for (const [from, to] of fonts) {
  await cp(path.join(root, 'node_modules', from), path.join(publicOut, 'fonts', to));
}

console.log('build complete');
