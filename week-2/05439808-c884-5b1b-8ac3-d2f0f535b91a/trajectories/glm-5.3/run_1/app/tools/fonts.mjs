// Downloads the OFL-licensed webfonts (Fraunces, Atkinson Hyperlegible, JetBrains Mono)
// and writes src/client/fonts.css. Run once at authoring time; the woff2 files are committed.
import { mkdir, writeFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FAMILIES = [
  { family: 'Fraunces', weights: [400, 600, 700] },
  { family: 'Atkinson Hyperlegible', weights: [400, 700] },
  { family: 'JetBrains Mono', weights: [400, 600, 700] },
];

async function getCss(family, weights) {
  const q = `https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}:wght@${weights.join(';')}&display=swap`;
  const res = await fetch(q, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`css2 ${family}: ${res.status}`);
  return res.text();
}

function parseFaces(css) {
  const faces = [];
  const re = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const block = m[1];
    const pick = (prop) => {
      const p = block.match(new RegExp(`${prop}:\\s*([^;]+);`));
      return p ? p[1].trim() : null;
    };
    faces.push({
      family: (pick('font-family') || '').replaceAll("'", ''),
      weight: pick('font-weight'),
      url: (block.match(/url\((https:[^)]+)\)/) || [])[1],
      unicodeRange: pick('unicode-range') || '',
    });
  }
  return faces;
}

const slug = (s) => s.toLowerCase().replaceAll(' ', '-');
const out = [];
for (const { family, weights } of FAMILIES) {
  const css = await getCss(family, weights);
  for (const face of parseFaces(css)) {
    if (!face.url) continue;
    if (!face.unicodeRange.includes('U+0000-00FF')) continue; // latin subset only
    const file = `${slug(face.family)}-${face.weight}.woff2`;
    const res = await fetch(face.url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`font ${file}: ${res.status}`);
    await writeFile(`assets/fonts/${file}`, Buffer.from(await res.arrayBuffer()));
    out.push(
      `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${face.weight};font-display:swap;src:url('/assets/fonts/${file}') format('woff2');}`
    );
    console.log('saved', file);
  }
}
await writeFile('src/client/fonts.css', out.join('\n') + '\n');
console.log('wrote src/client/fonts.css');
