// One-off vendoring of the OFL-1.1 fonts that ship with the app.
// Run with: node scripts/fetch-fonts.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const families = [
  { slug: 'libre-franklin', query: 'Libre+Franklin:wght@400..700' },
  { slug: 'source-serif-4', query: 'Source+Serif+4:wght@400..600' },
  { slug: 'noto-sans-arabic', query: 'Noto+Sans+Arabic:wght@400..700' },
];

await mkdir(new URL('../public/fonts/', import.meta.url), { recursive: true });

let css = '';
for (const family of families) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${family.query}`, {
    headers: { 'user-agent': UA },
  });
  let text = await res.text();
  const urls = [...new Set(text.match(/https:\/\/[^)]+\.woff2/g) ?? [])];
  let index = 0;
  for (const url of urls) {
    const name = `${family.slug}-${index++}.woff2`;
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(new URL(`../public/fonts/${name}`, import.meta.url), bytes);
    text = text.split(url).join(`/fonts/${name}`);
  }
  css += `${text}\n`;
}

await writeFile(new URL('../public/fonts/fonts.css', import.meta.url), css, 'utf8');
console.log('fonts written');
