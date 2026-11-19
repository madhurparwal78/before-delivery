// Copies the woff2 files the brief needs from @fontsource packages into
// src/client/fonts/, so both bundles can reference them as files.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const files = [
  ["@fontsource/bricolage-grotesque", "bricolage-grotesque-latin-400-normal.woff2"],
  ["@fontsource/bricolage-grotesque", "bricolage-grotesque-latin-700-normal.woff2"],
  ["@fontsource/schibsted-grotesk", "schibsted-grotesk-latin-400-normal.woff2"],
  ["@fontsource/schibsted-grotesk", "schibsted-grotesk-latin-500-normal.woff2"],
  ["@fontsource/schibsted-grotesk", "schibsted-grotesk-latin-700-normal.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-500-normal.woff2"],
];
const outDir = "src/client/fonts";
mkdirSync(outDir, { recursive: true });
for (const [pack, f] of files) {
  const src = "node_modules/" + pack + "/files/" + f;
  if (!existsSync(src)) throw new Error("missing " + src);
  copyFileSync(src, outDir + "/" + f);
}
console.log("fonts copied");
