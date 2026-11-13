// Generates THIRD_PARTY_NOTICES.md from the installed production tree.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const out = execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], { cwd: root, encoding: "utf8" });
const tree = JSON.parse(out);

const pkgs = {};
function walk(deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    pkgs[name] = info.version ?? "?";
    walk(info.dependencies);
  }
}
walk(tree.dependencies);

const rows = [];
const allowed = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"]);
for (const name of Object.keys(pkgs).sort()) {
  const metaPath = path.join(root, "node_modules", name, "package.json");
  if (!fs.existsSync(metaPath)) continue; // optional peers that are not installed ship nothing
  let license = "UNKNOWN";
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const l = meta.license;
    if (typeof l === "string") license = l;
    else if (Array.isArray(l)) license = l.map((x) => (typeof x === "string" ? x : x.type)).join(" OR ");
    else if (meta.licenses) license = JSON.stringify(meta.licenses);
  } catch {
    license = "NOT FOUND";
  }
  const ok = license.split(/ OR |\+/).some((part) => allowed.has(part.trim()));
  rows.push({ name, version: pkgs[name], license, ok });
}

const fontLines = [
  ["Darker Grotesque", "OFL-1.1 (SIL Open Font License 1.1)"],
  ["Lexend", "OFL-1.1 (SIL Open Font License 1.1)"],
];
const iconLines = [
  ["Lucide Icons", "ISC"],
];

let md = "# Third-party notices\n\n";
md += "Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is listed below with its licence.\n\n";
md += "| Package | Version | Licence |\n|---|---|---|\n";
for (const r of rows) {
  md += `| ${r.name} | ${r.version} | ${r.license} |\n`;
}
md += "\n## Fonts\n\n";
md += "| Font | Licence |\n|---|---|\n";
for (const [name, license] of fontLines) md += `| ${name} | ${license} |\n`;
md += "\n## Icons\n\n";
md += "| Icon set | Licence |\n|---|---|\n";
for (const [name, license] of iconLines) md += `| ${name} | ${license} |\n`;

fs.writeFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), md);

const bad = rows.filter((r) => !r.ok);
console.log(`listed ${rows.length} packages; ${bad.length} with a licence outside the allowed set`);
for (const r of bad) console.log("  ", r.name, r.license);
