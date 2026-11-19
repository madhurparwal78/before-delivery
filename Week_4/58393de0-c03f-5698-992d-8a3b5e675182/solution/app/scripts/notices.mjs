// Regenerates THIRD_PARTY_NOTICES.md from the installed dependency trees (run after any dependency change).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const tree = (omitDev) => {
  const args = ["ls", "--all", "--json", "--long", ...(omitDev ? ["--omit=dev"] : [])];
  let out = "";
  try {
    out = execFileSync("npm", args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    out = error.stdout;
  }
  return JSON.parse(out);
};

const flatten = (root) => {
  const found = new Map();
  const walk = (node) => {
    for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
      if (!dep.version || !dep.path || !existsSync(dep.path)) continue;
      const key = `${name}@${dep.version}`;
      if (found.has(key)) continue;
      found.set(key, { name, version: dep.version, path: dep.path, license: dep.license ?? dep.licenses });
      walk(dep);
    }
  };
  walk(root);
  return found;
};

const licenceOf = (entry) => {
  const raw = entry.license ?? JSON.parse(readFileSync(join(entry.path, "package.json"), "utf8")).license;
  if (Array.isArray(raw)) return raw.map((l) => (typeof l === "string" ? l : l.type)).join(" OR ");
  return typeof raw === "object" && raw ? raw.type : String(raw ?? "UNKNOWN");
};

const copyrightOf = (dir) => {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  if (!file) return "see package metadata";
  const line = readFileSync(join(dir, file), "utf8").split("\n").find((l) => /copyright/i.test(l));
  return line ? line.trim().replace(/\|/g, "/") : "see package metadata";
};

const rows = (map) => [...map.values()]
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  .map((e) => `| ${e.name} | ${e.version} | ${licenceOf(e)} | ${copyrightOf(e.path)} |`)
  .join("\n");

const runtime = flatten(tree(true));
const all = flatten(tree(false));
const buildOnly = new Map([...all].filter(([key]) => !runtime.has(key)));
const header = "| Package | Version | Licence | Copyright |\n|---|---|---|---|";
const ofl = readFileSync("node_modules/@fontsource/fira-sans/LICENSE", "utf8").trim();
const manifold = readFileSync("third_party/manifold/LICENSE", "utf8").split("\n").slice(0, 3).join("\n").trim();

writeFileSync("THIRD_PARTY_NOTICES.md", `# Third-party notices

Quarkyard ships the packages, font and vendored library below. Each is under a licence on the project's allow-list
(MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, BlueOak-1.0.0, CC0-1.0; fonts OFL-1.1).
Regenerate with \`npm run notices\`.

## Shipped packages (production dependency tree, \`npm ls --omit=dev --all\`)

${header}
${rows(runtime)}

## Vendored library

| Library | Version | Licence | Files |
|---|---|---|---|
| Manifold (manifold-3d), compiled to WebAssembly | 3.5.4 | Apache-2.0 | \`third_party/manifold/manifold.js\`, \`third_party/manifold/manifold.wasm\` |

Copyright the Manifold authors; the Apache License 2.0 text is in \`third_party/manifold/LICENSE\`.
Lucide icons (\`lucide-react\`, ISC) are inlined as SVG; Fira Sans is served from this app.

## Font licence: Fira Sans (SIL Open Font License 1.1)

\`\`\`
${ofl}
\`\`\`

## Build tooling (development dependencies, not shipped in the served app)

${header}
${rows(buildOnly)}
`);
console.log(`runtime ${runtime.size}, build-only ${buildOnly.size}`);
