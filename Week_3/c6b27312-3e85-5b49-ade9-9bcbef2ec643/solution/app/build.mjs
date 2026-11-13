import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: false,
});

await build({
  entryPoints: { app: "src/client/main.tsx" },
  outdir: "dist/public",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  sourcemap: false,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "css" },
  external: ["/fonts/*"],
});

await cp("src/client/index.html", "dist/public/index.html");
await cp("public", "dist/public", { recursive: true });
