// Regenerates THIRD_PARTY_NOTICES.md and assets.json from the lockfile and public/fonts. Run by hand after changing dependencies.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const rows = [];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location.startsWith("node_modules/")) continue;
  const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
  const folder = location;
  let copyright = "";
  for (const file of existsSync(folder) ? readdirSync(folder) : []) {
    if (/^(licen[cs]e|copying)/i.test(file)) {
      const line = readFileSync(path.join(folder, file), "utf8").split("\n").find((text) => /copyright/i.test(text));
      if (line) copyright = line.replace(/\|/g, "/").trim();
      break;
    }
  }
  rows.push({ name, version: entry.version, licence: entry.license ?? "see package", copyright, dev: entry.dev === true });
}
rows.sort((a, b) => a.name.localeCompare(b.name));

const fonts = readdirSync("public/fonts").filter((file) => file.endsWith(".woff2")).sort();
const assets = fonts.map((file) => ({
  path: `public/fonts/${file}`,
  sha256: createHash("sha256").update(readFileSync(`public/fonts/${file}`)).digest("hex"),
  source: `https://www.npmjs.com/package/@fontsource-variable/literata (files/${file})`,
  licence: "OFL-1.1",
}));
writeFileSync("assets.json", `${JSON.stringify(assets, null, 2)}\n`);

const out = [];
out.push("# Third-party notices\n");
out.push("Candour Bench ships no runtime dependency: the production dependency tree (`npm ls --omit=dev`) is empty.");
out.push("Every package below is a build-time input that is bundled into `dist/` by Vite and esbuild (the server in `dist/server.cjs`, the page in `dist/client/`), or a type or tooling package used only to build.\n");
out.push("## Font\n");
out.push("| File | Family | Licence | Source |");
out.push("|---|---|---|---|");
out.push("| `public/fonts/literata-*-wght-*.woff2` (latin and latin-ext, normal and italic) | Literata (variable) | OFL-1.1 | https://github.com/googlefonts/literata, packaged by `@fontsource-variable/literata` |\n");
out.push("Literata is bundled as self-hosted WOFF2 files. Its licence is the SIL Open Font License 1.1, reproduced in full below.\n");
out.push("## Icons\n");
out.push("Menu, close, bookmark, star, slider and alert icons are inline SVG from `lucide-react` (ISC), bundled into the page.\n");
out.push("## Drawings\n");
out.push("The lab glassware (pipette rack, flask, centrifuge rotor) and the pay band specimen are drawn by the app as inline SVG: licence `original`.\n");
out.push("## Packages\n");
out.push("| Package | Version | Licence | Copyright | Use |");
out.push("|---|---|---|---|---|");
for (const row of rows) out.push(`| ${row.name} | ${row.version} | ${row.licence} | ${row.copyright} | ${row.dev ? "bundled or build tooling" : "bundled"} |`);
out.push("\n## SIL Open Font License 1.1 (Literata)\n");
out.push("```text");
out.push(readFileSync("public/fonts/LICENSE-Literata-OFL.txt", "utf8").trim());
out.push("```");
writeFileSync("THIRD_PARTY_NOTICES.md", `${out.join("\n")}\n`);
console.log(`${rows.length} packages, ${assets.length} font files`);
