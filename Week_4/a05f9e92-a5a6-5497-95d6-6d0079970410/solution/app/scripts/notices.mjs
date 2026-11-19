// Regenerates THIRD_PARTY_NOTICES.md from package-lock.json (production and build) and the bundled fonts.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const rows = new Map();
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path.startsWith("node_modules/")) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const key = `${name}@${entry.version}`;
  let copyright = "";
  for (const file of existsSync(path) ? readdirSync(path) : []) {
    if (!/^(licen[cs]e|copying)/i.test(file)) continue;
    const line = readFileSync(join(path, file), "utf8").split("\n").find((l) => /^\s*copyright/i.test(l));
    if (line) copyright = line.trim();
    break;
  }
  if (!copyright && existsSync(join(path, "package.json"))) {
    const author = JSON.parse(readFileSync(join(path, "package.json"), "utf8")).author;
    const who = typeof author === "string" ? author : author?.name;
    if (who) copyright = `Copyright ${who}`;
  }
  if (!copyright && name.startsWith("@esbuild/")) copyright = "Copyright (c) 2020 Evan Wallace";
  if (!copyright && name.startsWith("@typescript/")) copyright = "Copyright (c) Microsoft Corporation";
  const previous = rows.get(key);
  rows.set(key, { name, version: entry.version, licence: entry.license ?? "UNKNOWN", copyright: previous?.copyright || copyright, shipped: (previous?.shipped ?? false) || !entry.dev });
}

const fontLine = (file) => readFileSync(join("public/fonts", file), "utf8").split("\n")[0].trim();
const lines = [
  "# Third-party notices",
  "",
  "Switchyard ships the packages marked `shipped` at run time and builds with the packages marked `build`.",
  "Every licence is MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or, for fonts, OFL-1.1.",
  "",
  "| Package | Version | Licence | Use | Copyright |",
  "|---|---|---|---|---|",
];
for (const row of [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  lines.push(`| ${row.name} | ${row.version} | ${row.licence} | ${row.shipped ? "shipped" : "build"} | ${row.copyright.replace(/\|/g, "/")} |`);
}
lines.push(
  "",
  "## Fonts",
  "",
  "Both fonts are bundled as self-hosted variable woff2 files under `public/fonts/` and served from the app's own origin,",
  "licensed under the SIL Open Font License 1.1 (full text next to each file).",
  "",
  `- **Unbounded** (static 800 and 900, latin subset): ${fontLine("OFL-Unbounded.txt")}. Licence text: \`public/fonts/OFL-Unbounded.txt\`.`,
  `- **Onest** (latin subset): ${fontLine("OFL-Onest.txt")}. Licence text: \`public/fonts/OFL-Onest.txt\`.`,
  "",
  "## Other assets",
  "",
  "The service portraits, outage relay panels and icons are drawn in code for this app (licence `original`).",
  "No other binary assets ship.",
  "",
);
writeFileSync("THIRD_PARTY_NOTICES.md", lines.join("\n"));
