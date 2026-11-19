/**
 * Writes THIRD_PARTY_NOTICES.md from the production dependency tree, and fails
 * when a shipped package is not under an allowed licence.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "Zlib",
]);

const BUNDLED_FONTS = [
  { name: "Fraunces", licence: "SIL OFL 1.1", file: "public/fonts/Fraunces-OFL.txt" },
  { name: "IBM Plex Sans", licence: "SIL OFL 1.1", file: "public/fonts/IBM-Plex-OFL.txt" },
  { name: "IBM Plex Mono", licence: "SIL OFL 1.1", file: "public/fonts/IBM-Plex-OFL.txt" },
];

const BUNDLED_ICONS = [{ name: "Lucide", licence: "ISC" }];

/** Returns null when the package is not actually installed, so is not shipped. */
function licenceOf(name) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join("node_modules", name, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const raw = manifest.license ?? manifest.licenses;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((entry) => entry.type ?? entry).join(" OR ");
  if (raw && typeof raw === "object") return raw.type ?? "UNKNOWN";
  return "UNKNOWN";
}

/** An OR expression passes when one option is allowed; AND needs every part. */
function licenceAllowed(expression) {
  const text = expression.replace(/[()]/g, " ").trim();
  if (/\bAND\b/i.test(text)) {
    return text
      .split(/\bAND\b/i)
      .every((part) => part.split(/\bOR\b/i).some((option) => ALLOWED.has(option.trim())));
  }
  return text.split(/\bOR\b/i).some((option) => ALLOWED.has(option.trim()));
}

function collect(node, into) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    const licence = licenceOf(name);
    if (licence === null) continue;
    const version = child.version ?? "unknown";
    const key = `${name}@${version}`;
    if (!into.has(key)) {
      into.set(key, { name, version, licence });
      collect(child, into);
    }
  }
  return into;
}

const tree = JSON.parse(
  execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);

const packages = [...collect(tree, new Map()).values()].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
);

const offenders = packages.filter((entry) => !licenceAllowed(entry.licence));

const lines = [
  "# Third-party notices",
  "",
  "Spanwise ships the packages, fonts and icons listed here. Every shipped",
  "package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or",
  "Zlib, and every bundled font is licensed SIL OFL 1.1.",
  "",
  "## Shipped packages",
  "",
  "The production dependency tree, from `npm ls --omit=dev --all --json`.",
  "",
  "| Package | Version | Licence |",
  "| --- | --- | --- |",
  ...packages.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} |`),
  "",
  "## Bundled fonts",
  "",
  "Self-hosted from `public/fonts`; no font is fetched at runtime.",
  "",
  "| Font | Licence | Licence text |",
  "| --- | --- | --- |",
  ...BUNDLED_FONTS.map((font) => `| ${font.name} | ${font.licence} | \`${font.file}\` |`),
  "",
  "## Bundled icons",
  "",
  "| Icons | Licence |",
  "| --- | --- |",
  ...BUNDLED_ICONS.map((icon) => `| ${icon.name} (glyph paths inlined in \`src/web/components/icons.tsx\`) | ${icon.licence} |`),
  "",
];

writeFileSync("THIRD_PARTY_NOTICES.md", `${lines.join("\n")}`);
console.log(`Wrote THIRD_PARTY_NOTICES.md with ${packages.length} shipped packages.`);

if (offenders.length > 0) {
  console.error("Disallowed licences:");
  for (const entry of offenders) console.error(`  ${entry.name}@${entry.version}: ${entry.licence}`);
  process.exit(1);
}
