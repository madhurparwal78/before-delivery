// Bundles the server and the browser app into dist/ and copies the static files.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });
await cp("public", "dist/public", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  logLevel: "warning",
});

await build({
  entryPoints: ["src/client/main.tsx"],
  outfile: "dist/public/assets/app.js",
  bundle: true,
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  format: "esm",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
