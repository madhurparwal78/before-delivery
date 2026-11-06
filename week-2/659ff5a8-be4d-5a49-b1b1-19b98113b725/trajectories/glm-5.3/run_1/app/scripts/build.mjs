// Build: compile server TS, bundle the web client with esbuild, copy assets.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";

mkdirSync("dist/web", { recursive: true });

console.log("Typechecking and compiling server TypeScript...");
execSync("npx tsc -p tsconfig.server.json --noEmit", { stdio: "inherit" });
execSync("npx tsc -p tsconfig.server.json", { stdio: "inherit" });
console.log("Typechecking web client...");
execSync("npx tsc -p tsconfig.web.json", { stdio: "inherit" });

console.log("Bundling web client...");
await build({
  entryPoints: ["src/web/client.tsx"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "dist/web/app.js",
  target: "es2022",
});
console.log("Client bundled.");

copyFileSync("src/web/index.html", "dist/web/index.html");
copyFileSync("src/web/app.css", "dist/web/app.css");
copyFileSync("src/server/schema.sql", "dist/schema.sql");
mkdirSync("dist/web/fonts", { recursive: true });
if (existsSync("public/fonts")) {
  for (const f of readdirSync("public/fonts")) {
    copyFileSync(`public/fonts/${f}`, `dist/web/fonts/${f}`);
  }
}
console.log("Build done.");
