// Writes THIRD_PARTY_NOTICES.md from the Go modules the program imports, the production
// npm tree and the bundled fonts. Run it from the app root after the install step and
// again whenever dependencies change: node scripts/notices.mjs
// It exits with an error when a licence is not one of the allowed ones.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FONTS } from "./fonts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const bsd = (clauses) => `BSD-${clauses}-Clause`;
const ALLOWED = new Set(["MIT", "Apache-2.0", "BSD", bsd(2), bsd(3), "ISC", "MPL-2.0", "OFL-1.1"]);
const TEXTS = [
  ["Apache-2.0", ["apache license", "version 2.0"]],
  ["MPL-2.0", ["mozilla public license", "2.0"]],
  [bsd(3), ["redistribution and use in source and binary forms", "neither the name"]],
  [bsd(2), ["redistribution and use in source and binary forms"]],
  ["ISC", ["permission to use, copy, modify, and/or distribute this software"]],
  ["MIT", ["permission is hereby granted, free of charge"]],
];

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function licenceFiles(dir) {
  return readdirSync(dir)
    .filter((name) => /^(un)?licen[cs]e|^copying/i.test(name))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8").trim() }));
}

// The phrases the verifier looks for, as it looks for them.
function identify(text) {
  const flat = text.toLowerCase().split(/\s+/).join(" ");
  return TEXTS.find(([, phrases]) => phrases.every((p) => flat.includes(p)))?.[0] ?? "";
}

// A looser reading, to name a licence the strict phrases miss.
function identifyLoose(text) {
  const flat = text.toLowerCase().split(/\s+/).join(" ");
  if (flat.includes("permission to use, copy, modify, and distribute this software for any purpose")) {
    return "ISC";
  }
  return "";
}

function copyright(text) {
  const line = text.split("\n").map((l) => l.trim()).find((l) => /^copyright\s+(\(c\)\s*|©\s*)?\d{4}/i.test(l)) ?? "";
  return line.replace(/\s+[A-Za-z]+-Italic\[wght\]\.ttf:.*$/, "");
}

const problems = [];
const checkAllowed = (name, licence) => {
  const ids = licence.split(/\s+OR\s+|\s+AND\s+|[()/]/).map((s) => s.trim()).filter(Boolean);
  if (!ids.some((id) => ALLOWED.has(id))) {
    problems.push(`${name}: licence "${licence}" is not allowed`);
  }
};

// Go modules reached by the program.
const goRows = new Map();
for (const line of run("go", ["list", "-deps", "-f", "{{with .Module}}{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}{{end}}", "./..."]).split("\n")) {
  const [path, version, dir] = line.split("\t");
  if (path && dir) {
    goRows.set(path, { name: path, version, dir });
  }
}
const goModules = [...goRows.values()].sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
  const files = licenceFiles(m.dir);
  let licence = [...new Set(files.map((f) => identify(f.text)).filter(Boolean))].join(" OR ");
  if (!licence) {
    licence = [...new Set(files.map((f) => identifyLoose(f.text)).filter(Boolean))].join(" OR ");
    problems.push(`${m.name} ${m.version}: the verifier's phrase matching does not recognise the licence text in ${m.dir}${licence ? ` (it reads as ${licence})` : ""}`);
  } else {
    checkAllowed(m.name, licence);
  }
  return { ...m, licence, files, copyright: files.map((f) => copyright(f.text)).find(Boolean) ?? "" };
});

// Production npm packages.
const tree = JSON.parse(run("npm", ["ls", "--omit=dev", "--all", "--json", "--long"]));
const npmRows = new Map();
(function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (dep.version && dep.path && !npmRows.has(`${name}@${dep.version}`)) {
      const manifest = JSON.parse(readFileSync(join(dep.path, "package.json"), "utf8"));
      const licence = typeof manifest.license === "string" ? manifest.license : manifest.license?.type ?? "";
      checkAllowed(name, licence);
      const files = licenceFiles(dep.path);
      const author = typeof manifest.author === "string" ? manifest.author.replace(/\s*<.*>$/, "") : manifest.author?.name ?? "";
      const holder = files.map((f) => copyright(f.text)).find(Boolean) ?? (author ? `Copyright ${author}` : "");
      npmRows.set(`${name}@${dep.version}`, { name, version: dep.version, licence, files, copyright: holder });
      walk(dep);
    }
  }
})(tree);
const npmPackages = [...npmRows.values()].sort((a, b) => a.name.localeCompare(b.name));

// Fonts.
const fonts = FONTS.map(({ family, pkg, files }) => {
  const dir = join(root, "node_modules", pkg);
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const licenceText = licenceFiles(dir)[0].text;
  return { family, pkg, version: manifest.version, licence: manifest.license, files, copyright: copyright(licenceText), text: licenceText };
});
for (const f of fonts) {
  checkAllowed(f.family, f.licence);
}

const out = [];
out.push("# Third-party notices", "");
out.push("Switchlamp ships the Go modules, npm packages and fonts listed here. Each entry gives the name, version, licence and copyright line; the licence texts follow the tables. Every licence is one of MIT, Apache-2.0, BSD, ISC, MPL-2.0 or OFL-1.1.", "");

out.push("## Go modules", "", "| Module | Version | Licence | Copyright |", "| --- | --- | --- | --- |");
for (const m of goModules) {
  out.push(`| ${m.name} | ${m.version} | ${m.licence} | ${m.copyright} |`);
}

out.push("", "## npm packages (production tree)", "", "| Package | Version | Licence | Copyright |", "| --- | --- | --- | --- |");
for (const p of npmPackages) {
  out.push(`| ${p.name} | ${p.version} | ${p.licence} | ${p.copyright} |`);
}

out.push("", "## Fonts", "", "The fonts are installed from their npm packages, copied into `web/fonts` at build time and served by the app itself.", "");
out.push("| Font | Package | Version | Licence | Copyright | Files |", "| --- | --- | --- | --- | --- | --- |");
for (const f of fonts) {
  out.push(`| ${f.family} | ${f.pkg} | ${f.version} | ${f.licence} | ${f.copyright} | ${f.files.map((x) => `${x}.woff2`).join(", ")} |`);
}

out.push("", "## Images", "", "The three plates `web/img/dusk.jpg`, `web/img/night.jpg` and `web/img/signin.jpg` are original: drawn by `cmd/plates`, a seeded procedural renderer that runs during the build. No stock image, photograph or third-party artwork is used.", "");

out.push("## Licence texts", "");
for (const m of goModules) {
  for (const f of m.files) {
    out.push(`### ${m.name} ${m.version} (${f.name})`, "", "```text", f.text, "```", "");
  }
}
for (const p of npmPackages) {
  for (const f of p.files) {
    out.push(`### ${p.name} ${p.version} (${f.name})`, "", "```text", f.text, "```", "");
  }
}
for (const f of fonts) {
  out.push(`### ${f.family}, ${f.pkg} ${f.version} (SIL Open Font License 1.1)`, "", "```text", f.text, "```", "");
}

writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), `${out.join("\n").trimEnd()}\n`);
console.log(`${goModules.length} Go modules, ${npmPackages.length} npm packages, ${fonts.length} fonts`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
