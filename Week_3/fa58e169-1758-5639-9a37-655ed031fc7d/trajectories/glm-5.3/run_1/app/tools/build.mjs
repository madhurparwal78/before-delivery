import { build } from "esbuild";
import { mkdirSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
mkdirSync("dist/client", { recursive: true });
mkdirSync("dist/server", { recursive: true });

await build({
  entryPoints: ["client/App.tsx"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "dist/client/app.js",
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  logLevel: "warning",
});

await build({
  entryPoints: ["server/main.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "dist/server/main.mjs",
  external: ["pg", "ws", "nodemailer"],
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

copyFileSync("client/index.html", "dist/client/index.html");
copyFileSync("client/styles/app.css", "dist/client/app.css");
mkdirSync("dist/client/fonts", { recursive: true });
for (const font of readdirSync("public/fonts")) {
  copyFileSync(`public/fonts/${font}`, `dist/client/fonts/${font}`);
}
writeFileSync("dist/built.txt", new Date().toISOString());
console.log("built");
