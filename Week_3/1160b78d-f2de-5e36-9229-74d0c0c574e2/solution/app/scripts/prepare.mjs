// Copies the browser modules and the bundled fonts out of the installed production
// packages into web/. It runs first in `build` and reads nothing but node_modules.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FONTS, VENDOR_MODULES } from "./fonts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules");
const web = join(root, "web");

function need(path) {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing: run the install step first`);
  }
  return path;
}

mkdirSync(join(web, "vendor"), { recursive: true });
mkdirSync(join(web, "fonts"), { recursive: true });

// The source map comment is dropped: the map is not shipped.
for (const [from, to] of VENDOR_MODULES) {
  const source = readFileSync(need(join(modules, from)), "utf8");
  writeFileSync(join(web, "vendor", to), source.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, "\n"));
}

const licences = [];
for (const { family, pkg, files } of FONTS) {
  for (const file of files) {
    copyFileSync(need(join(modules, pkg, "files", `${file}.woff2`)), join(web, "fonts", `${file}.woff2`));
  }
  const manifest = JSON.parse(readFileSync(need(join(modules, pkg, "package.json")), "utf8"));
  const text = readFileSync(need(join(modules, pkg, "LICENSE")), "utf8").trim();
  licences.push(`${family} (npm ${manifest.name} ${manifest.version}, ${manifest.license})\n\n${text}\n`);
}
writeFileSync(join(web, "fonts", "OFL.txt"), licences.join("\n\n----------------------------------------\n\n"));
