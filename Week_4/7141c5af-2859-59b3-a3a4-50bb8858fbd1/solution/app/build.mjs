import { mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

const clientEntries = { public: "web/public/main.ts", desk: "web/desk/main.tsx", client: "web/client/main.tsx" };

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/assets", { recursive: true });

await build({
  entryPoints: ["server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
});

const entryPoints = [
  ...Object.entries(clientEntries).map(([out, file]) => ({ out, in: file })),
  { out: "base", in: "web/shared/base.css" },
];

if (entryPoints.length > 0) {
  await build({
    entryPoints,
    outdir: "dist/assets",
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "esm",
    jsx: "automatic",
    jsxImportSource: "preact",
    minify: true,
    assetNames: "[name]-[hash]",
    loader: { ".woff2": "file", ".woff": "file" },
  });
}
