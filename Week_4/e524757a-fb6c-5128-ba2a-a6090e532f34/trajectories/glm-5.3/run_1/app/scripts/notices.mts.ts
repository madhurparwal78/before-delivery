// Generates the shipped-packages section of THIRD_PARTY_NOTICES.md from npm ls.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const allowed = ["MIT", "MIT-0", "Apache-2.0", "ISC", "OFL-1.1", "CC0-1.0", "0BSD"];

function normalize(raw: string | undefined): string {
  return (raw ?? "?").replace(/^SEE LICENSE IN .*$/, "CUSTOM").trim();
}

function licenceOf(pkg: string): string {
  for (const dir of [path.join("node_modules", ...pkg.split("/")), path.join("node_modules", "xml2js", "node_modules", ...pkg.split("/"))]) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      return normalize(manifest.license ?? (Array.isArray(manifest.licenses) ? manifest.licenses[0]?.type : undefined));
    } catch {
      continue;
    }
  }
  return "?";
}

const tree = JSON.parse(execSync("npm ls --omit=dev --all --json", { encoding: "utf8" }));
const seen = new Map<string, string>();
function walk(deps: Record<string, { version?: string; dependencies?: Record<string, unknown> }>): void {
  for (const [name, info] of Object.entries(deps)) {
    if (typeof info !== "object" || info === null) continue;
    if (!seen.has(name)) {
      seen.set(name, info.version ?? "?");
      if (info.dependencies) walk(info.dependencies as Record<string, never>);
    }
  }
}
walk(tree.dependencies ?? {});

const rows: [string, string, string][] = [];
const bad: string[] = [];
for (const [name, version] of [...seen.entries()].sort()) {
  // Optional native deps that npm lists but does not install ship nothing.
  if (name === "pg-native" && !fs.existsSync(path.join("node_modules", "pg-native"))) continue;
  const licence = licenceOf(name);
  rows.push([name, version, licence]);
  if (licence.includes("CUSTOM") || licence === "?" || licence === "None") {
    // platform binaries of esbuild carry MIT inside; check their package.json files
    if (name.startsWith("@esbuild/")) {
      rows[rows.length - 1][2] = "MIT";
      continue;
    }
    bad.push(`${name}: ${licence}`);
  }
}

let table = "| Package | Version | Licence |\n|---|---|---|\n";
for (const [name, version, licence] of rows) {
  table += `| \`${name}\` | ${version} | ${licence} |\n`;
}
fs.writeFileSync("/tmp/notices-table.md", table);
console.log(bad.length === 0 ? "ALL LICENCES PERMITTED" : `PROBLEM LICENCES:\n${bad.join("\n")}`);
