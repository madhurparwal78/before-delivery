/**
 * Writes THIRD_PARTY_NOTICES.md from the lockfile: every shipped package, the
 * two shipped typefaces and the icon set, with its version and licence.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

async function packageLicence(name) {
  const manifest = JSON.parse(
    await readFile(join(ROOT, 'node_modules', name, 'package.json'), 'utf8'),
  );
  const licence =
    typeof manifest.license === 'string'
      ? manifest.license
      : Array.isArray(manifest.licenses)
        ? manifest.licenses.map((entry) => entry.type).join(' OR ')
        : (manifest.license?.type ?? 'UNKNOWN');
  return { version: manifest.version, licence };
}

/** The lockfile's non-dev packages, leaving out ones the install skipped. */
async function shippedPackages() {
  const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
  const installed = new Set();
  const walk = async (directory, prefix) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('@')) {
        await walk(join(directory, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (entry.name === '.bin') continue;
      installed.add(`${prefix}${entry.name}`);
    }
  };
  await walk(join(ROOT, 'node_modules'), '');

  const shipped = new Map();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === '') continue;
    if (entry.dev === true) continue;
    const name = path.replace(/^.*node_modules\//, '');
    if (!installed.has(name)) continue;
    shipped.set(name, entry.version);
  }
  return shipped;
}

const EXTRA_ASSETS = [
  {
    name: 'Instrument Serif',
    kind: 'Typeface',
    version: 'shipped by @fontsource/instrument-serif',
    licence: 'OFL-1.1',
    note: 'Display typeface, served by the app from its own assets.',
  },
  {
    name: 'Hanken Grotesk',
    kind: 'Typeface',
    version: 'shipped by @fontsource/hanken-grotesk',
    licence: 'OFL-1.1',
    note: 'Body typeface, served by the app from its own assets.',
  },
  {
    name: 'Lucide',
    kind: 'Icon set',
    version: 'shipped by lucide-react',
    licence: 'ISC',
    note: 'The only icon set in the interface.',
  },
];

const packages = await shippedPackages();
const rows = [];
for (const [name, lockVersion] of [...packages].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const details = await packageLicence(name).catch(() => null);
  rows.push({
    name,
    version: details?.version ?? lockVersion,
    licence: details?.licence ?? 'UNKNOWN',
  });
}

const lines = [
  '# Third-party notices',
  '',
  'Plumbline ships the packages, typefaces and icon set below. Nothing else is',
  'served to the browser and nothing is fetched from a third-party host at runtime.',
  '',
  '## Packages',
  '',
  'Every non-development package in `package-lock.json` that the install placed in',
  '`node_modules`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Typefaces and icons',
  '',
  '| Asset | Kind | Version | Licence | Notes |',
  '| --- | --- | --- | --- | --- |',
  ...EXTRA_ASSETS.map(
    (asset) =>
      `| ${asset.name} | ${asset.kind} | ${asset.version} | ${asset.licence} | ${asset.note} |`,
  ),
  '',
  '## Images',
  '',
  'Every render, site photo, drawing sheet and case-study cover in the app is drawn',
  'by the app itself from code in `src/server/services/procedural.ts`. No',
  'third-party image is shipped.',
  '',
];

await writeFile(join(ROOT, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`, 'utf8');

const licences = new Set(rows.map((row) => row.licence));
process.stdout.write(`${rows.length} shipped packages\nlicences: ${[...licences].sort().join(', ')}\n`);
