import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');

type FontFace = {
  family: string;
  weight: number;
  file: string;
  range: string;
};

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

const fontSpecs: Array<{ family: string; pkg: string; prefix: string; weights: number[] }> = [
  {
    family: 'Bricolage Grotesque',
    pkg: '@fontsource/bricolage-grotesque',
    prefix: 'bricolage-grotesque',
    weights: [400, 600, 700],
  },
  { family: 'Inter', pkg: '@fontsource/inter', prefix: 'inter', weights: [400, 600] },
  {
    family: 'JetBrains Mono',
    pkg: '@fontsource/jetbrains-mono',
    prefix: 'jetbrains-mono',
    weights: [400, 500],
  },
];

async function copyFonts(): Promise<void> {
  const faces: FontFace[] = [];
  await mkdir(join(publicDir, 'fonts'), { recursive: true });
  for (const spec of fontSpecs) {
    for (const weight of spec.weights) {
      for (const subset of ['latin', 'latin-ext'] as const) {
        const name = `${spec.prefix}-${subset}-${weight}-normal.woff2`;
        await cp(join(root, 'node_modules', spec.pkg, 'files', name), join(publicDir, 'fonts', name));
        faces.push({
          family: spec.family,
          weight,
          file: name,
          range: subset === 'latin' ? LATIN : LATIN_EXT,
        });
      }
    }
  }
  const css = faces
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url('/fonts/${f.file}') format('woff2');unicode-range:${f.range};}`,
    )
    .join('\n');
  await writeFile(join(publicDir, 'fonts.css'), `${css}\n`, 'utf8');
}

function shell(title: string, entry: string, bodyClass: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="earshot-time-zone" content="__EARSHOT_TIME_ZONE__">
<title>${title}</title>
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="${bodyClass}">
<div id="app"></div>
<script type="module" src="/${entry}"></script>
</body>
</html>
`;
}

async function main(): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });

  await build({
    entryPoints: [join(root, 'src/server/index.ts')],
    outfile: join(dist, 'server/index.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: false,
    minify: false,
    packages: 'external',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });

  await build({
    entryPoints: {
      journey: join(root, 'src/client/journey/main.ts'),
      proposal: join(root, 'src/client/proposal/main.ts'),
      console: join(root, 'src/client/console/main.ts'),
      app: join(root, 'src/client/styles/app.css'),
    },
    outdir: publicDir,
    bundle: true,
    splitting: false,
    platform: 'browser',
    target: ['chrome120', 'firefox121', 'safari17'],
    format: 'esm',
    sourcemap: false,
    minify: true,
    loader: { '.css': 'css' },
  });

  await copyFonts();

  await writeFile(
    join(publicDir, 'journey.html'),
    shell('Earshot by Kettlehole Audio', 'journey.js', 'journey-body'),
    'utf8',
  );
  await writeFile(
    join(publicDir, 'proposal.html'),
    shell('Proposal \u2014 Kettlehole Audio', 'proposal.js', 'proposal-body'),
    'utf8',
  );
  await writeFile(
    join(publicDir, 'console.html'),
    shell('Earshot console', 'console.js', 'console-body'),
    'utf8',
  );
  await writeFile(
    join(publicDir, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0d0f0a"/><g fill="#ff6a1f"><rect x="6" y="18" width="4" height="8"/><rect x="12" y="14" width="4" height="12"/><rect x="18" y="10" width="4" height="16"/><rect x="24" y="6" width="2" height="20"/></g></svg>\n`,
    'utf8',
  );

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
  await writeFile(join(dist, 'build-info.json'), JSON.stringify({ version: pkg.version }), 'utf8');
}

await main();
