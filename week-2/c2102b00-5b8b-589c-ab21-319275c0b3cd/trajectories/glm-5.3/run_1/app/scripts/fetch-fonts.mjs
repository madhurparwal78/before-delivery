// Downloads Archivo (expanded variable) and IBM Plex Sans woff2 files from Google Fonts.
// Run once; the files are committed under public/fonts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const OUT = join(process.cwd(), "public", "fonts");
mkdirSync(OUT, { recursive: true });

async function grab(cssUrl, familyDir, wantedSubsets) {
  const res = await fetch(cssUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`css fetch ${res.status} for ${cssUrl}`);
  const css = await res.text();
  // Blocks: "/* subset */" precedes each @font-face group.
  const blockRe = /\/\* ([a-z-]+) \*\/\s*@font-face \{([^}]+)\}/g;
  const out = [];
  let m;
  while ((m = blockRe.exec(css)) !== null) {
    const subset = m[1];
    const body = m[2];
    if (!wantedSubsets.includes(subset)) continue;
    const urlM = /src: url\((https:[^)]+)\)/.exec(body);
    const range = /unicode-range: ([^;]+);/.exec(body);
    if (!urlM) continue;
    const fontRes = await fetch(urlM[1], { headers: { "User-Agent": UA } });
    if (!fontRes.ok) throw new Error(`font fetch ${fontRes.status}`);
    const buf = Buffer.from(await fontRes.arrayBuffer());
    const fileM = /\/([A-Za-z0-9_-]+\.woff2)$/.exec(urlM[1]);
    if (!fileM) throw new Error(`no file name in ${urlM[1]}`);
    const file = `${familyDir}-${fileM[1]}`;
    writeFileSync(join(OUT, file), buf);
    const weight = /font-weight: ([^;]+);/.exec(body)?.[1] ?? "400";
    const stretch = /font-stretch: ([^;]+);/.exec(body)?.[1] ?? null;
    out.push({ subset, file, weight, stretch, unicodeRange: range?.[1] ?? null });
  }
  return out;
}

const results = {};
results.archivo = await grab(
  "https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900&display=swap",
  "archivo",
  ["latin", "latin-ext"]
);
results.plex = await grab(
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap",
  "plex",
  ["latin", "latin-ext"]
);
console.log(JSON.stringify(results, null, 1));
