// Copies the bundled open-licence font files out of the packages fetched during
// install into the asset directory the server embeds. Nothing is fetched here.
import { mkdir, copyFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "internal", "web", "static", "fonts");

const wanted = [
  ["@fontsource/darker-grotesque", "darker-grotesque-latin-400-normal.woff2"],
  ["@fontsource/darker-grotesque", "darker-grotesque-latin-600-normal.woff2"],
  ["@fontsource/darker-grotesque", "darker-grotesque-latin-700-normal.woff2"],
  ["@fontsource/lexend", "lexend-latin-400-normal.woff2"],
  ["@fontsource/lexend", "lexend-latin-500-normal.woff2"],
  ["@fontsource/lexend", "lexend-latin-700-normal.woff2"],
  ["@fontsource/chivo-mono", "chivo-mono-latin-400-normal.woff2"],
];

await mkdir(out, { recursive: true });
for (const [pkg, file] of wanted) {
  const from = join(root, "node_modules", pkg, "files", file);
  await copyFile(from, join(out, file));
}
const copied = await readdir(out);
console.log(`fonts: ${copied.length} files in internal/web/static/fonts`);
