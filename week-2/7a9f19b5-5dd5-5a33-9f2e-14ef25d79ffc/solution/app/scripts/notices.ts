// Writes THIRD_PARTY_NOTICES.md: every package in the lockfile (shipped and build-only) with its version, licence and
// copyright line, then the bundled fonts with the full SIL Open Font License text, then the app's own media.
// Run from the app root after `npm ci`: node --experimental-strip-types scripts/notices.ts
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface LockEntry {
  version?: string;
  license?: string;
}

const root = process.cwd();
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as { packages: Record<string, LockEntry> };

function shippedNames(): Set<string> {
  const tree = JSON.parse(
    execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], { cwd: root, encoding: "utf8" }),
  ) as { dependencies?: Record<string, { dependencies?: object }> };
  const names = new Set<string>();
  const walk = (node: { dependencies?: Record<string, { dependencies?: object }> }) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (names.has(name)) continue;
      names.add(name);
      walk(child as { dependencies?: Record<string, { dependencies?: object }> });
    }
  };
  walk(tree);
  return names;
}

function copyright(directory: string): string {
  if (!existsSync(directory)) return "";
  const file = readdirSync(directory).find((name) => /^(licen[cs]e|copying)/i.test(name));
  if (!file) return "";
  const line = readFileSync(join(directory, file), "utf8")
    .split(/\r?\n/)
    .find((text) => /copyright/i.test(text) && /\d{4}|\(c\)|©/i.test(text));
  return line?.trim().replace(/\|/g, "\\|") ?? "";
}

const shipped = shippedNames();
const rows = Object.entries(lock.packages)
  .filter(([path]) => path.startsWith("node_modules/"))
  .map(([path, entry]) => {
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const manifestPath = join(root, path, "package.json");
    const manifest = existsSync(manifestPath)
      ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { license?: string; author?: string | { name?: string } })
      : {};
    const author = typeof manifest.author === "string" ? manifest.author : manifest.author?.name;
    return {
      name,
      version: entry.version ?? "",
      licence: manifest.license ?? entry.license ?? "",
      scope: shipped.has(name) ? "shipped" : "build",
      copyright: copyright(join(root, path)) || (author ? `Copyright ${author}` : ""),
    };
  })
  .sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "shipped" ? -1 : 1));

const fonts = [
  { family: "Instrument Serif", files: "src/client/fonts/instrument-serif-*.woff2", licence: "licences/OFL-instrument-serif.txt" },
  { family: "Inter Tight", files: "src/client/fonts/inter-tight-*.woff2", licence: "licences/OFL-inter-tight.txt" },
  { family: "JetBrains Mono", files: "src/client/fonts/jetbrains-mono-*.woff2", licence: "licences/OFL-jetbrains-mono.txt" },
];

const unique = new Map(rows.map((row) => [`${row.name}@${row.version}`, row]));
const lines = [
  "# Third-party notices",
  "",
  "Lightfall ships the packages marked `shipped` (the production dependency tree, `npm ls --omit=dev --all`).",
  "Packages marked `build` are used only to compile and bundle the app.",
  "",
  "## Packages",
  "",
  "| Package | Version | Licence | Scope | Copyright |",
  "|---|---|---|---|---|",
  ...[...unique.values()].map((r) => `| ${r.name} | ${r.version} | ${r.licence} | ${r.scope} | ${r.copyright} |`),
  "",
  "## Bundled fonts",
  "",
  "Self-hosted from the Fontsource builds (Latin and Latin Extended subsets), each under the SIL Open Font License 1.1.",
  "",
  ...fonts.flatMap((font) => {
    const text = readFileSync(join(root, font.licence), "utf8").trim();
    return [`### ${font.family}`, "", `Files: \`${font.files}\`. Licence: SIL Open Font License 1.1 (OFL-1.1).`, "", "```text", text, "```", ""];
  }),
  "## Media",
  "",
  "| File | Licence | Source |",
  "|---|---|---|",
  "| src/client/favicon.svg | original | drawn for this app |",
  "",
  "Icons are lucide-react components (ISC, listed above). The fitting models, light cones, pools, room and line",
  "drawings are built in code for this app; no model, image or copy files are downloaded or bundled.",
  "",
];
writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), lines.join("\n"));
console.log(`${unique.size} packages, ${fonts.length} font families`);
