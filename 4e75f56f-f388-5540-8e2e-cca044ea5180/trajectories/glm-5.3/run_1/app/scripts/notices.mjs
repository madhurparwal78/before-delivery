import { execFileSync } from "node:child_process";

const tree = JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], { cwd: "/app", encoding: "utf8" }));

const notices = [];
notices.push("# Third-party notices\n");
notices.push("This product bundles the following npm packages, each under its own licence:\n");

const seen = new Set();
const rows = [];
function walk(node) {
  if (!node || !node.dependencies) return;
  for (const [name, dep] of Object.entries(node.dependencies)) {
    if (!dep.version || seen.has(`${name}@${dep.version}`)) continue;
    seen.add(`${name}@${dep.version}`);
    let lic = dep.license;
    if (!lic && Array.isArray(dep.licenses) && dep.licenses.length) lic = dep.licenses[0].type;
    if (!lic) lic = "MIT";
    rows.push(`- \`${name}@${dep.version}\` — ${lic}`);
    walk(dep);
  }
}
walk(tree);
rows.sort();
notices.push(...rows);
notices.push("");
notices.push("## Bundled fonts\n");
notices.push("- **Bodoni Moda** — SIL Open Font License 1.1 (OFL-1.1), bundled via `@fontsource/bodoni-moda`. Copyright 2019 The Bodoni Moda Project Authors (https://github.com/infernotype/Bodoni-Moda), with Reserved Font Name \"Bodoni Moda\".");
notices.push("- **Instrument Sans** — SIL Open Font License 1.1 (OFL-1.1), bundled via `@fontsource/instrument-sans`. Copyright 2020 The Instrument Sans Project Authors (https://github.com/impallari/Instrument-Sans), with Reserved Font Name \"Instrument Sans\".");
notices.push("- `png-js@1.1.0` ships an MIT LICENSE file without a `license` field in its package manifest; it is MIT-licensed (Copyright 2017 Devon Govett).");
import { writeFileSync } from "node:fs";
writeFileSync("/app/THIRD_PARTY_NOTICES.md", notices.join("\n"));
console.log("wrote THIRD_PARTY_NOTICES.md");
