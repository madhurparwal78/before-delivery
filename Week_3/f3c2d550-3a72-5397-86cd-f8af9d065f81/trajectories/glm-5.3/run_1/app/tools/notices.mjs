// Generates THIRD_PARTY_NOTICES.md from the installed production dependency tree.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD)$/;

const tree = JSON.parse(execSync("npm ls --omit=dev --all --json").toString());
const seen = new Map();
function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    const key = dep.version ? `${name}@${dep.version}` : null;
    if (!key || seen.has(key)) continue;
    let license = "?";
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), "node_modules", name, "package.json"), "utf8"));
      license = String(pkg.license ?? "?");
    } catch { /* package.json unreadable; leave as ? */ }
    seen.set(key, license);
    walk(dep);
  }
}
walk(tree);

const bad = [...seen.entries()].filter(([, l]) => !ALLOWED.test(l));
if (bad.length > 0) {
  console.error("Non-conforming production licences:\n" + bad.map(([k, l]) => `  ${k} (${l})`).join("\n"));
  process.exit(1);
}

const lines = [
  "# Third-party notices",
  "",
  "## Production dependencies",
  "",
  ...[...seen.keys()].sort().map((k) => `- ${k} — ${seen.get(k)}`),
  "",
  "## Fonts",
  "",
  "- Host Grotesk (Space Grotesk variable font, self-hosted as public/host-grotesk.ttf) — SIL Open Font License 1.1, source: https://github.com/floriankarsten/space-grotesk. The licence file is shipped as public/host-grotesk-OFL.txt.",
  "",
  "## Demo photographs",
  "",
  "- Desk radio, Pocket calculator, Enamel kettle — drawn for this product and released as CC0 1.0.",
  "",
];

writeFileSync(join(process.cwd(), "THIRD_PARTY_NOTICES.md"), lines.join("\n") + "\n");
console.log(`THIRD_PARTY_NOTICES.md written (${seen.size} production packages).`);
