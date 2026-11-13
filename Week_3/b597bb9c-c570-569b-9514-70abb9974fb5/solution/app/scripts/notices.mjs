// Regenerates THIRD_PARTY_NOTICES.md from package-lock.json and the installed packages.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const rows = [];

function licenceOf(manifest) {
  const value = manifest.license ?? manifest.licenses;
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : item.type)).join(" OR ");
  return typeof value === "object" && value ? value.type : (value ?? "UNKNOWN");
}

function copyrightOf(dir) {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE", "License"]) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split("\n").find((text) => /copyright/i.test(text));
    if (line) return line.trim().replace(/\|/g, "/");
  }
  return "see package";
}

for (const [location, info] of Object.entries(lock.packages)) {
  if (!location.startsWith("node_modules/") || info.optional && !existsSync(location)) continue;
  const name = location.replace(/^.*node_modules\//, "");
  const dir = existsSync(location) ? location : null;
  const manifest = dir ? JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) : info;
  rows.push({ name, version: info.version, licence: licenceOf(manifest), scope: info.dev ? "build" : "runtime", copyright: dir ? copyrightOf(dir) : "see package" });
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const ofl = (file) => readFileSync(`web/fonts/${file}`, "utf8").trim();
const lines = [
  "# Third-party notices",
  "",
  "Gatecut ships the packages below. Runtime packages are installed in production or bundled into the browser build; build packages are used only to compile it.",
  "",
  "## Fonts",
  "",
  "| Font | Licence | Source |",
  "|---|---|---|",
  "| Work Sans | OFL-1.1 | web/fonts/WorkSans-Regular-latin.woff2, self-hosted (from the Fontsource build) |",
  "| Sometype Mono | OFL-1.1 | web/fonts/SometypeMono-Regular-latin.woff2, self-hosted (from the Fontsource build) |",
  "",
  "## Icons",
  "",
  "| Icon set | Licence | Source |",
  "|---|---|---|",
  "| Lucide | ISC | lucide-react, inlined as SVG by the bundler |",
  "",
  "## Packages",
  "",
  "| Package | Version | Licence | Scope | Copyright |",
  "|---|---|---|---|---|",
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} | ${row.scope} | ${row.copyright} |`),
  "",
  "## SIL Open Font License 1.1: Work Sans",
  "",
  "```",
  ofl("OFL-WorkSans.txt"),
  "```",
  "",
  "## SIL Open Font License 1.1: Sometype Mono",
  "",
  "```",
  ofl("OFL-SometypeMono.txt"),
  "```",
  "",
];
writeFileSync("THIRD_PARTY_NOTICES.md", lines.join("\n"));
console.log(`${rows.length} packages written`);
