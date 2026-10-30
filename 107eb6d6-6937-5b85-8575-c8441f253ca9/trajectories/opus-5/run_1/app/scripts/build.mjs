import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import nunjucks from 'nunjucks';

const root = fileURLToPath(new URL('..', import.meta.url));
const templatesDir = path.join(root, 'templates');
const assetsDir = path.join(root, 'public', 'assets');

async function templateFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await templateFiles(full)));
    else if (entry.name.endsWith('.njk')) files.push(full);
  }
  return files;
}

const templates = await templateFiles(templatesDir);
for (const file of templates) {
  nunjucks.precompileString(await readFile(file, 'utf8'), { name: path.relative(templatesDir, file) });
}

await mkdir(assetsDir, { recursive: true });
await copyFile(path.join(root, 'node_modules', 'htmx.org', 'dist', 'htmx.min.js'), path.join(assetsDir, 'htmx.min.js'));

const fingerprint = createHash('sha256');
for (const name of ['app.css', 'app.js', 'htmx.min.js']) {
  fingerprint.update(await readFile(path.join(assetsDir, name)));
}
const version = fingerprint.digest('hex').slice(0, 12);
await writeFile(path.join(assetsDir, 'build.json'), `${JSON.stringify({ version }, null, 2)}\n`);

console.log(`build ready: ${templates.length} templates checked, assets stamped ${version}`);
