// Copies the self-hosted OFL font files out of the @fontsource dev packages into
// public/fonts so the built app serves them from its own origin (IF-05).
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "fonts");

// Both the `latin` and `latin-ext` subsets are needed: `latin` carries ASCII and
// the degree, multiplication and middle-dot signs, `latin-ext` the macron vowels
// in names such as Totara and Pohutukawa.
const WANTED = [
  ["instrument-serif", ["instrument-serif-latin-400-normal", "instrument-serif-latin-ext-400-normal"]],
  [
    "inter-tight",
    [
      "inter-tight-latin-400-normal",
      "inter-tight-latin-500-normal",
      "inter-tight-latin-600-normal",
      "inter-tight-latin-ext-400-normal",
      "inter-tight-latin-ext-500-normal",
      "inter-tight-latin-ext-600-normal",
    ],
  ],
  [
    "jetbrains-mono",
    [
      "jetbrains-mono-latin-400-normal",
      "jetbrains-mono-latin-500-normal",
      "jetbrains-mono-latin-ext-400-normal",
      "jetbrains-mono-latin-ext-500-normal",
    ],
  ],
];

await mkdir(out, { recursive: true });

for (const [pkg, bases] of WANTED) {
  const dir = join(root, "node_modules", "@fontsource", pkg, "files");
  const available = await readdir(dir);
  for (const base of bases) {
    for (const ext of ["woff2", "woff"]) {
      const name = `${base}.${ext}`;
      if (!available.includes(name)) throw new Error(`missing font file ${pkg}/${name}`);
      await copyFile(join(dir, name), join(out, name));
    }
  }
  await copyFile(join(root, "node_modules", "@fontsource", pkg, "LICENSE"), join(out, `${pkg}.LICENSE.txt`));
}

console.log(`fonts: copied into ${out}`);
