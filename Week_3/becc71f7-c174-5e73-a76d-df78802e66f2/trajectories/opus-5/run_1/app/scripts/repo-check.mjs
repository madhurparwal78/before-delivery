// Working-rules checks: the run manifest, licences, fonts, credentials and the boundary.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const root = '/app';
let passed = 0;
let failed = 0;
const ok = (label, condition, detail = '') => {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.log(`FAIL ${label} ${detail}`);
  }
};

const SKIP = new Set(['node_modules', '.git', 'dist', '.cache']);

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else files.push(path);
  }
  return files;
}

// IF-01
const manifest = JSON.parse(await readFile(join(root, 'run.json'), 'utf8'));
ok('IF-01 run.json schema', manifest._schema === 'run-manifest-v1', manifest._schema);
for (const key of ['install', 'build', 'serve']) {
  ok(`IF-01 run.json ${key} is a string command`, typeof manifest[key] === 'string' && manifest[key].length > 0);
}

// IF-02 and IF-03
const notices = await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const tree = JSON.parse(
  (await import('node:child_process')).execFileSync(
    'npm',
    ['ls', '--omit=dev', '--all', '--json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  ),
);
const shipped = new Set();
(function collect(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.extraneous === true) continue;
    if (entry.version !== undefined) shipped.add(name);
    collect(entry);
  }
})(tree);
for (const name of shipped) {
  ok(`IF-02 ${name} is listed in the notices`, notices.includes(`\`${name}\``));
}
const PERMISSIVE = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);
for (const name of shipped) {
  const pkg = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
  ok(`IF-03 ${name} is permissive`, PERMISSIVE.has(licence), licence);
}

// IF-04
const fonts = await readdir(join(root, 'public/fonts'));
ok('IF-04 Familjen Grotesk is shipped', fonts.some((f) => f.startsWith('familjen-grotesk') && f.endsWith('.woff2')));
ok('IF-04 Hanken Grotesk is shipped', fonts.some((f) => f.startsWith('hanken-grotesk') && f.endsWith('.woff2')));
ok('IF-04 the OFL notice for Familjen Grotesk is shipped', fonts.includes('OFL-Familjen-Grotesk.txt'));
ok('IF-04 the OFL notice for Hanken Grotesk is shipped', fonts.includes('OFL-Hanken-Grotesk.txt'));
for (const name of ['OFL-Familjen-Grotesk.txt', 'OFL-Hanken-Grotesk.txt']) {
  const text = await readFile(join(root, 'public/fonts', name), 'utf8');
  ok(`IF-04 ${name} is the SIL OFL`, text.includes('SIL OPEN FONT LICENSE Version 1.1'));
}

const files = await walk(root);

// IF-04: no Inter font file or reference
ok(
  'IF-04 no Inter font file is shipped',
  !files.some((file) => /inter/i.test(file) && ['.woff2', '.woff', '.ttf', '.otf'].includes(extname(file))),
);
const INTER_WORDS = /\b(Inter|Inter Tight|Inter Variable)\b/;
const referencingInter = [];
for (const file of files) {
  if (!['.ts', '.tsx', '.css', '.html', '.json', '.md'].includes(extname(file))) continue;
  const text = await readFile(file, 'utf8');
  if (INTER_WORDS.test(text)) referencingInter.push(file);
}
ok('IF-04 no Inter reference is shipped', referencingInter.length === 0, referencingInter.join(' '));

// IF-05: no credential value appears in any file
const SECRETS = [
  process.env.S3_ACCESS_KEY_ID,
  process.env.S3_SECRET_ACCESS_KEY,
  new URL(process.env.DATABASE_URL).password,
].filter((value) => typeof value === 'string' && value.length > 0);
const leaks = [];
for (const file of files) {
  if (['.woff2', '.png', '.jpg'].includes(extname(file))) continue;
  const text = await readFile(file, 'utf8');
  for (const secret of SECRETS) {
    if (text.includes(secret)) leaks.push(`${file} holds a credential`);
  }
}
ok('IF-05 no credential value appears under /app', leaks.length === 0, leaks.join(' '));

const SEEDED_PASSWORDS = [
  'ourlet-owner-2027',
  'ourlet-noor-2027',
  'ourlet-jules-2027',
  'ourlet-ines-2027',
];
const seedFile = await readFile(join(root, 'src/server/seed.ts'), 'utf8');
for (const password of SEEDED_PASSWORDS) {
  ok(`IF-05 the published seed password ${password} is in the seed`, seedFile.includes(password));
}

// IF-06: no other datastore
const FORBIDDEN = ['sqlite', 'better-sqlite3', 'redis', 'ioredis', 'level', 'lowdb', 'nedb', 'mongodb'];
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const declared = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
for (const name of FORBIDDEN) {
  ok(`IF-06 no ${name} dependency`, !declared.includes(name));
}
ok(
  'IF-06 the app uses Postgres, MinIO and Mailpit alone',
  [...shipped].every((name) => !FORBIDDEN.some((bad) => name.includes(bad))),
);

// IF-07: application source is TypeScript
const sourceFiles = files.filter((file) => file.startsWith(join(root, 'src/')));
ok(
  'IF-07 every source file is TypeScript',
  sourceFiles.every((file) => ['.ts', '.tsx'].includes(extname(file))),
  sourceFiles.filter((file) => !['.ts', '.tsx'].includes(extname(file))).join(' '),
);
ok('IF-07 there is source to speak of', sourceFiles.length > 40, String(sourceFiles.length));

// The server boundary: nothing outside the published endpoints is served.
const base = process.env.CHECK_URL ?? 'http://127.0.0.1:4188';
for (const path of [
  '/run.json',
  '/package.json',
  '/package-lock.json',
  '/tsconfig.json',
  '/src/server/main.ts',
  '/src/client/main.tsx',
  '/dist/server.js',
  '/.env',
  '/THIRD_PARTY_NOTICES.md',
  '/../run.json',
  '/app.js/../../run.json',
]) {
  const response = await fetch(`${base}${path}`).catch(() => null);
  if (response === null) {
    ok(`the boundary refuses ${path}`, true);
    continue;
  }
  const type = response.headers.get('content-type') ?? '';
  ok(
    `the boundary never serves ${path}`,
    response.status === 404 || type.startsWith('text/html'),
    `${response.status} ${type}`,
  );
}
for (const path of ['/app.js', '/app.css', '/fonts/hanken-grotesk-latin.woff2']) {
  const response = await fetch(`${base}${path}`);
  ok(`the app serves ${path} itself`, response.status === 200, String(response.status));
}

// Same origin only: no cross-origin headers.
const shell = await fetch(`${base}/`);
for (const header of [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
]) {
  ok(`no ${header} header`, shell.headers.get(header) === null, String(shell.headers.get(header)));
}
const html = await shell.text();
ok(
  'every script, style and font loads from the app itself',
  ![...html.matchAll(/(?:src|href)="([^"]+)"/g)].some((match) => /^https?:\/\//.test(match[1])),
  html,
);

// The fonts and the stylesheet are the only shipped front-end assets.
const distPublic = await readdir(join(root, 'dist/public'));
ok(
  'the built assets are the app, its stylesheet and the fonts',
  distPublic.sort().join(',') === 'app.css,app.js,fonts',
  distPublic.join(','),
);
const builtCss = await readFile(join(root, 'dist/public/app.css'), 'utf8');
ok('the stylesheet names both typefaces', builtCss.includes('Familjen Grotesk') && builtCss.includes('Hanken Grotesk'));

await stat(join(root, 'AGENTS.md'))
  .then(() => ok('AGENTS.md is present', true))
  .catch(() => ok('AGENTS.md is present', false));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
