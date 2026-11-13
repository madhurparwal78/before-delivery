import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const out = execSync("npm ls --omit=dev --all --json", { cwd: "/app", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const tree = JSON.parse(out);
const seen = new Map();
function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (info.version !== undefined && !seen.has(name)) seen.set(name, info.version);
    walk(info);
  }
}
walk(tree);
const allowed = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"]);
const rows = [];
for (const [name, version] of [...seen.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const pkg = JSON.parse(readFileSync(`/app/node_modules/${name}/package.json`, "utf8"));
  const license = typeof pkg.license === "string" ? pkg.license : String(pkg.license ?? "UNKNOWN");
  if (!allowed.has(license)) {
    console.error(`DISALLOWED: ${name}@${version} license ${license}`);
  }
  rows.push(`| ${name} | ${version} | ${license} |`);
}
const text = `# Third-party notices

Roundkeeper ships the following packages, reported by \`npm ls --omit=dev --all --json\`, each with its version and licence.

| Package | Version | Licence |
| --- | --- | --- |
${rows.join("\n")}

## Typefaces

| Typeface | Version | Licence |
| --- | --- | --- |
| Fraunces | 2.014 (static woff2 build served by Google Fonts) | SIL Open Font License 1.1 |
| Atkinson Hyperlegible | 2020 (static woff2 build served by Google Fonts) | SIL Open Font License 1.1 |

Both typefaces are self-hosted as woff2 files under \`public/assets/fonts/\`.
`;
writeFileSync("/app/THIRD_PARTY_NOTICES.md", text);
console.log("wrote THIRD_PARTY_NOTICES.md with", rows.length, "packages");
