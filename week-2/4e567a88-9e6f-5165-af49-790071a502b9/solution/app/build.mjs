// Bundles the server and the browser app into dist/. The server serves only dist/public.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "public"), { recursive: true });

await build({
  entryPoints: [join(root, "src/server/main.ts")],
  outfile: join(out, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});

await build({
  entryPoints: [join(root, "src/client/main.tsx")],
  outfile: join(out, "public/app.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  jsx: "automatic",
  jsxImportSource: "preact",
  logLevel: "warning",
});

cpSync(join(root, "src/client/app.css"), join(out, "public/app.css"));
cpSync(join(root, "public/fonts"), join(out, "public/fonts"), { recursive: true });
writeFileSync(join(out, "public/index.html"), readFileSync(join(root, "src/client/index.html")));
