import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const FONTS = [
  "atkinson-hyperlegible-400.woff2",
  "atkinson-hyperlegible-700.woff2",
  "fraunces-400.woff2",
  "fraunces-600.woff2",
];

const LOADER = `
const moduleFactories = {};
const moduleCache = {};
function resolveModule(id) {
  if (moduleCache[id] !== undefined) return moduleCache[id];
  const factory = moduleFactories[id];
  if (factory === undefined) throw new Error("missing module " + id);
  const exports = {};
  moduleCache[id] = exports;
  factory((dep) => resolveModule(dep), exports);
  return exports;
}
const define = (id, factory) => { moduleFactories[id] = factory; };
`;

async function main() {
  await mkdir(join(ROOT, "public", "assets", "fonts"), { recursive: true });
  for (const file of FONTS) {
    await copyFile(join(ROOT, "public-src", "fonts", file), join(ROOT, "public", "assets", "fonts", file));
  }
  await copyFile(join(ROOT, "public-src", "styles", "main.css"), join(ROOT, "public", "assets", "main.css"));
  const cssPath = join(ROOT, "public", "assets", "main.css");
  const css = await readFile(cssPath, "utf8");
  const inlined = css.replace(
    /url\(\.\.\/assets\/fonts\/([^)'"]+?\.woff2)\)/g,
    (_match, file) => `url(fonts/${file})`,
  );
  await writeFile(cssPath, inlined);

  const bundlePath = join(ROOT, "public", "assets", "bundle.js");
  const bundle = await readFile(bundlePath, "utf8");
  const withLoader = `(function () {\n${LOADER}\n${bundle}\nresolveModule("bootstrap");\n})();\n`;
  await writeFile(join(ROOT, "public", "assets", "app.js"), withLoader);
  await rm(bundlePath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
