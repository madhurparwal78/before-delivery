// Bundles the server (Node, ESM, with its libraries inlined, so dist/ runs without node_modules) and the
// browser app, and copies the static files into dist/public. No source maps are emitted.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // pg loads its optional native binding only on request; Shedline never requests it.
  external: ["pg-native"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.ts" },
  outdir: "dist/public",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  external: ["/fonts/*"],
  logLevel: "warning",
});

await cp("public", "dist/public", { recursive: true });
