import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const out = "../internal/httpapi/assets";

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp("public", out, { recursive: true });

await build({
  entryPoints: ["src/main.ts", "src/app.css"],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  outdir: out,
  entryNames: "[name]",
  external: ["/assets/*"],
  logLevel: "info",
});
