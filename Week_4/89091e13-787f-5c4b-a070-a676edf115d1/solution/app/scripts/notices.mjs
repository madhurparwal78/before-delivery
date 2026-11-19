import { readFile, writeFile } from "node:fs/promises";

/** Writes THIRD_PARTY_NOTICES.md from package-lock.json and the installed packages (run after `npm ci`). */
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const entries = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (path === "" || info.link) continue;
  const manifest = await readFile(`${path}/package.json`, "utf8").then(JSON.parse, () => null);
  if (!manifest) continue;
  const licence = typeof manifest.license === "string" ? manifest.license : (manifest.license?.type ?? "UNKNOWN");
  let copyright = "";
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "License"]) {
    const text = await readFile(`${path}/${name}`, "utf8").catch(() => "");
    copyright = text.split("\n").find((line) => /copyright/i.test(line))?.trim() ?? "";
    if (copyright) break;
  }
  entries.push({ name: manifest.name, version: manifest.version, licence, copyright, dev: Boolean(info.dev) });
}
entries.sort((a, b) => a.name.localeCompare(b.name));
const rows = (list) => list.map((e) => `| ${e.name} | ${e.version} | ${e.licence} | ${e.copyright.replace(/\|/g, "/")} |`).join("\n");
const header = "| Package | Version | Licence | Copyright |\n|---|---|---|---|";
await writeFile(
  "THIRD_PARTY_NOTICES.md",
  `# Third-party notices

Fernsquare ships no font files and no binary media: type uses system font stacks, every picture is drawn in code and every icon is inline SVG.

## Shipped packages (production dependency tree)

${header}
${rows(entries.filter((e) => !e.dev))}

## Build-time packages (not shipped)

${header}
${rows(entries.filter((e) => e.dev))}
`,
);
