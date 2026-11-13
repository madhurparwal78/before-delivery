import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

// SPUR_OUT picks the output directory (default dist); SPUR_BUILD=server skips the browser bundle (used by dev scripts).
const out = process.env.SPUR_OUT ?? "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/public`, { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: `${out}/server.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  loader: { ".sql": "text" },
  sourcemap: false,
  logLevel: "warning",
});

if (process.env.SPUR_BUILD !== "server") {
  await build({
    entryPoints: { app: "src/client/main.tsx" },
    outdir: `${out}/public`,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["chrome120", "firefox120", "safari17"],
    jsx: "automatic",
    jsxImportSource: "preact",
    minify: true,
    sourcemap: false,
    external: ["/fonts/*"],
    logLevel: "warning",
  });
  cpSync("public/fonts", `${out}/public/fonts`, { recursive: true });
}
