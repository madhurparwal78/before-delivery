// Build: copy fonts/icons, bundle the client, compile the server with tsc.
import { mkdirSync, copyFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const out = "dist/client";
mkdirSync(out + "/fonts", { recursive: true });
mkdirSync(out + "/icons", { recursive: true });

const fonts = [
  ["@fontsource/archivo", "archivo"],
  ["@fontsource/public-sans", "public-sans"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono"],
];
for (const [pkg, dir] of fonts) {
  const p = join("node_modules", pkg, "files");
  if (!existsSync(p)) throw new Error(`missing font package ${pkg}`);
  for (const f of readdirSync(p)) {
    if (f.endsWith(".woff2") && /latin-(400|500|600|700)-normal/.test(f)) {
      copyFileSync(join(p, f), join(out, "fonts", `${dir}-${f}`));
    }
  }
}

// Server: tsc emit to dist/server, keeping module structure.
mkdirSync("dist/server", { recursive: true });
// Client bundle.

const lucide = join("node_modules", "lucide-static", "icons");
if (!existsSync(lucide)) throw new Error("missing lucide-static");
const needed = [
  "chevron-left", "chevron-right", "calendar", "clock", "credit-card",
  "log-out", "download", "file-text", "upload", "check", "x",
  "timer", "flame", "circle-alert", "printer", "search", "columns-3", "book-open", "paperclip",
];
const have = needed.filter(n => existsSync(join(lucide, n + ".svg")));
for (const n of have) copyFileSync(join(lucide, n + ".svg"), join(out, "icons", n + ".svg"));
writeFileSync(join(out, "icons", "list.json"), JSON.stringify(have));

// Server: tsc emit to dist/server, keeping module structure.
mkdirSync("dist/server", { recursive: true });
execFileSync("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });

// Client bundle.
execFileSync("node_modules/.bin/esbuild", ["src/client/main.ts", "--bundle", "--outfile=dist/client/app.js",
  "--format=iife", "--target=es2022", "--minify", "--log-level=error"], { stdio: "inherit" });
if (existsSync("src/client/app.css")) {
  copyFileSync("src/client/app.css", "dist/client/app.css");
  copyFileSync("src/client/binder.css", "dist/client/binder.css");
  copyFileSync("src/client/index.html", "dist/client/index.html");
}
console.log("build done");

