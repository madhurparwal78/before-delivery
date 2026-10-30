#!/usr/bin/env node
/**
 * Regenerates THIRD_PARTY_NOTICES.md from the production dependency tree, the
 * bundled fonts and the bundled icons, refusing any licence outside the
 * allowed set. Run: node scripts/notices.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";

const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"]);

const tree = JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

const packages = [];
const seen = new Set();
function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (seen.has(name) || info.version === undefined) continue;
    seen.add(name);
    packages.push({ name, version: info.version, licence: licenceOf(name) });
    walk(info);
  }
}
function licenceOf(name) {
  const manifest = `node_modules/${name}/package.json`;
  if (!existsSync(manifest)) return "";
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  const licence = pkg.license ?? pkg.licenses ?? "";
  if (typeof licence === "string") return licence.replace(/\s*\(.*$/, "").trim();
  if (Array.isArray(licence)) {
    return licence.map((entry) => (typeof entry === "string" ? entry : entry.type)).join(" OR ");
  }
  if (typeof licence === "object" && licence.type) return licence.type;
  return "";
}

walk(tree);
packages.sort((a, b) => a.name.localeCompare(b.name));

const bad = packages.filter((pkg) => !pkg.licence.split(" OR ").some((part) => ALLOWED.has(part)));
if (bad.length > 0) {
  console.error("Disallowed or missing licences:", bad.map((pkg) => `${pkg.name}@${pkg.version}=${pkg.licence || "?"}`).join(", "));
  process.exit(1);
}

const fonts = readdirSync("src/public/fonts").filter((name) => name.endsWith(".woff2"));
const icons = readdirSync("src/public/icons").filter((name) => name.endsWith(".svg"));

const lines = [];
lines.push("# Third-party notices");
lines.push("");
lines.push("Swarmline Bloom Desk ships the following open-source packages, fonts and icons.");
lines.push("");
lines.push("## Shipped packages");
lines.push("");
lines.push("The production dependency tree reported by `npm ls --omit=dev --all --json`.");
lines.push("");
lines.push("| Package | Version | Licence |");
lines.push("| --- | --- | --- |");
for (const pkg of packages) {
  lines.push(`| ${pkg.name} | ${pkg.version} | ${pkg.licence} |`);
}
lines.push("");
lines.push("## Bundled fonts");
lines.push("");
lines.push("Each font is served by the app itself and licensed under the SIL Open Font");
lines.push("License 1.1; the licence texts ship in `src/public/fonts/licences`.");
lines.push("");
for (const font of fonts) {
  const family = font.startsWith("young-serif") ? "Young Serif"
    : font.startsWith("public-sans") ? "Public Sans"
      : font.startsWith("ibm-plex-mono") ? "IBM Plex Mono" : font;
  lines.push(`- ${font} — ${family}, SIL Open Font License 1.1`);
}
lines.push("");
lines.push("## Bundled icons");
lines.push("");
for (const icon of icons) {
  lines.push(`- ${icon} — Lucide ${lucideVersion()}, ISC License`);
}
lines.push("");

writeFileSync("THIRD_PARTY_NOTICES.md", `${lines.join("\n")}\n`);
console.log(`Wrote THIRD_PARTY_NOTICES.md with ${packages.length} packages, ${fonts.length} fonts, ${icons.length} icons.`);

function lucideVersion() {
  return JSON.parse(readFileSync("node_modules/lucide-static/package.json", "utf8")).version;
}
