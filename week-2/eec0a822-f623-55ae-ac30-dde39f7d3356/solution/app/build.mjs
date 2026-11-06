// Builds the server bundle and the browser bundle into dist/.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public/assets", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["pg-native"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.tsx" },
  outdir: "dist/public/assets",
  bundle: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  jsx: "automatic",
  jsxImportSource: "preact",
  external: ["/fonts/*"],
  logLevel: "warning",
});

await cp("src/client/index.html", "dist/public/index.html");
await cp("public/fonts", "dist/public/fonts", { recursive: true });
