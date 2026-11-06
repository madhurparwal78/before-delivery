/**
 * Prints the production dependency tree with each package's licence, as
 * THIRD_PARTY_NOTICES.md must list it (IF-02), and checks every licence against
 * the allowed set (IF-03).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"]);

const tree = JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], { encoding: "utf8" }));

const found = new Map();
function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (info.version && !found.has(`${name}@${info.version}`)) {
      let licence = "UNKNOWN";
      let repository = "";
      try {
        const manifest = JSON.parse(readFileSync(join("node_modules", name, "package.json"), "utf8"));
        const raw = manifest.license ?? manifest.licenses;
        licence = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((l) => l.type).join(" OR ") : "UNKNOWN";
        repository = typeof manifest.repository === "string" ? manifest.repository : (manifest.repository?.url ?? "");
      } catch {
        licence = "UNKNOWN";
      }
      found.set(`${name}@${info.version}`, { name, version: info.version, licence, repository });
    }
    walk(info);
  }
}
walk(tree);

const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
let bad = 0;
for (const row of rows) {
  const ok = ALLOWED.has(row.licence);
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "BAD "} ${row.name}@${row.version}  ${row.licence}`);
}
console.log(`\n${rows.length} shipped packages, ${bad} outside the allowed licences`);
console.log(JSON.stringify(rows, null, 1));
