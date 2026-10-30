// Bundles the server (with its PostgreSQL client) and the browser app into dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/public/assets/fonts", { recursive: true });

await build({
  entryPoints: ["server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["pg-native"],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});

await build({
  entryPoints: { app: "client/main.tsx" },
  outdir: "dist/public/assets",
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  jsxImportSource: "preact",
  chunkNames: "chunks/[name]-[hash]",
  logLevel: "warning",
});

cpSync("client/styles.css", "dist/public/assets/app.css");
cpSync("public/fonts", "dist/public/assets/fonts", { recursive: true });
cpSync("server/viewer.html", "dist/viewer.html");
