// Regenerates THIRD_PARTY_NOTICES.md from package-lock.json and the installed packages.
// Run with `npm run notices` after `npm ci`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const FALLBACK = { "@esbuild": "Copyright (c) 2020 Evan Wallace (esbuild)", "@types": "Copyright (c) Microsoft Corporation (DefinitelyTyped)" };

function copyright(name) {
  const dir = path.join(root, "node_modules", name);
  for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"]) {
    const full = path.join(dir, file);
    if (!existsSync(full)) continue;
    const line = readFileSync(full, "utf8").split("\n").find((entry) => /^\s*copyright/i.test(entry));
    if (line) return line.trim();
  }
  const manifest = path.join(dir, "package.json");
  if (existsSync(manifest)) {
    const author = JSON.parse(readFileSync(manifest, "utf8")).author;
    if (author) return `Copyright ${typeof author === "string" ? author : author.name}`;
  }
  return FALLBACK[name.split("/")[0]] ?? `Copyright the ${name} authors`;
}

const rows = Object.entries(lock.packages)
  .filter(([key]) => key !== "")
  .map(([key, value]) => ({ name: key.replace(/^.*node_modules\//, ""), version: value.version, licence: value.license, scope: value.dev ? "build" : "shipped" }))
  .sort((a, b) => a.name.localeCompare(b.name));

const fonts = [
  ["Fraunces", "public/fonts/fraunces-latin-wght-normal.woff2", "Copyright 2020 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces)", "public/fonts/OFL-Fraunces.txt"],
  ["Atkinson Hyperlegible", "public/fonts/atkinson-hyperlegible-latin-400-normal.woff2, public/fonts/atkinson-hyperlegible-latin-700-normal.woff2", "Copyright 2020 Braille Institute of America, Inc.", "public/fonts/OFL-Atkinson-Hyperlegible.txt"],
];

const out = [
  "# Third-party notices",
  "",
  "Every package in the lockfile, with its version, licence and copyright line. \"shipped\" packages are the production dependency tree (`npm ls --omit=dev --all`); \"build\" packages are used only to compile the app.",
  "",
  "| Package | Version | Licence | Used as | Copyright |",
  "|---|---|---|---|---|",
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} | ${row.scope} | ${copyright(row.name)} |`),
  "",
  "## Typefaces",
  "",
  "Both typefaces are self-hosted as woff2 and are licensed under the SIL Open Font License, Version 1.1.",
  "",
  ...fonts.flatMap(([name, files, line, licence]) => [`### ${name}`, "", `- Files: ${files}`, `- Licence: SIL Open Font License 1.1`, `- ${line}`, `- Source: Fontsource (https://fontsource.org), from the Google Fonts release`, `- Full licence text: ${licence}`, ""]),
  "## Media",
  "",
  "The coaster mark, the check and cross marks and the chevron are drawn inline as SVG for this app (licence: original). No other image, audio or video ships.",
  "",
  "## SIL Open Font License, Version 1.1",
  "",
  "```",
  readFileSync(path.join(root, "public/fonts/OFL-Fraunces.txt"), "utf8").trim(),
  "```",
  "",
];
writeFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), out.join("\n"));
