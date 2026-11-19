// Builds the server bundle and the browser bundle into dist/.
import { build } from "esbuild";
import { cp, mkdir, rm, copyFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public/assets", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
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
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

await copyFile("src/client/index.html", "dist/public/index.html");
await cp("public", "dist/public", { recursive: true });
