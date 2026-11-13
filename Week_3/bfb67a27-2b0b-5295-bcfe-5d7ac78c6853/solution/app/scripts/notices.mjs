import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const allowed = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0']);
const production = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], { cwd: root, encoding: 'utf8' }));
const all = JSON.parse(execFileSync('npm', ['ls', '--all', '--json', '--long'], { cwd: root, encoding: 'utf8' }));
const runtime = new Set();
const packages = new Map();
function walk(node, isRuntime) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (child.extraneous === true || typeof child.version !== 'string' || !child.path) continue;
    const key = `${name}@${child.version}`;
    if (isRuntime) runtime.add(key);
    packages.set(key, { name, version: child.version, path: child.path });
    walk(child, isRuntime);
  }
}
walk(production, true);
walk(all, false);
const rows = [];
for (const [key, entry] of [...packages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const manifest = JSON.parse(await readFile(join(entry.path, 'package.json'), 'utf8'));
  const licence = manifest.license;
  if (!allowed.has(licence)) throw new Error(`Disallowed licence: ${key}: ${licence}`);
  const files = (await readdir(entry.path)).filter(name => /^(licen[cs]e|copying|copyright)/i.test(name));
  const copyrights = new Set();
  for (const file of files) {
    const text = await readFile(join(entry.path, file), 'utf8');
    for (const line of text.split('\n')) if (/copyright.*\S/i.test(line)) copyrights.add(line.trim().replaceAll('|', '\\|'));
  }
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  const copyright = [...copyrights].join('; ') || `Copyright the ${entry.name} contributors${author ? ` (${author})` : ''}; distributed under ${licence}`;
  rows.push(`| ${entry.name} | ${entry.version} | ${licence} | ${runtime.has(key) ? 'runtime' : 'build'} | ${copyright} |`);
}
const fonts = await Promise.all(['OFL-Big-Shoulders-Display.txt', 'OFL-IBM-Plex-Sans.txt'].map(file => readFile(join(root, 'public/fonts', file), 'utf8')));
const content = [
  '# Third-party notices', '',
  'Every installed runtime and build dependency, including transitive dependencies, is listed below. Runtime membership comes from `npm ls --omit=dev --all --json`; build membership comes from `npm ls --all --json`.', '',
  '| Package | Version | Licence | Use | Copyright |', '|---|---|---|---|---|', ...rows, '',
  '## Fonts', '',
  'Big Shoulders Display — OFL-1.1. Copyright 2019 The Big Shoulders Project Authors. Source: https://github.com/google/fonts/tree/main/ofl/bigshouldersdisplay. Local file: public/fonts/big-shoulders-display-latin.woff2.', '',
  fonts[0], '',
  'IBM Plex Sans — OFL-1.1. Copyright © 2017 IBM Corp. Source: https://github.com/google/fonts/tree/main/ofl/ibmplexsans. Local file: public/fonts/ibm-plex-sans-latin.woff2.', '',
  fonts[1], '',
  '## Lucide icons — ISC', '',
  'Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.', '',
  'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.', '',
  'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.', '',
  'Source: https://lucide.dev/license. Inline SVG paths live in src/client/dom.ts. The favicon combines an original paper ground with the Lucide camera glyph (ISC).', '',
];
await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), content.join('\n'));
process.stdout.write(`Wrote notices for ${rows.length} packages\n`);
