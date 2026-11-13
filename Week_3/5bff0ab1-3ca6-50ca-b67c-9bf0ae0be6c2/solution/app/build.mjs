import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });

// the server: one bundle; the 3D scene runs in the browser only, so it and three stay out of it
await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  jsx: "automatic",
  jsxImportSource: "preact",
  loader: { ".css": "empty" },
  plugins: [{ name: "browser-only", setup: (b) => b.onResolve({ filter: /\/scene\.js$/ }, (a) => ({ path: a.path, external: true })) }],
});

// the browser: hashed script and style, the scene as its own chunk
const result = await build({
  entryPoints: { main: "src/client/main.tsx" },
  outdir: "dist/public/assets",
  entryNames: "[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  jsxImportSource: "preact",
  metafile: true,
  external: ["/fonts/*"],
  legalComments: "none",
});
const outputs = Object.keys(result.metafile.outputs);
const entry = (ext) => outputs.find((o) => o.includes("/main-") && o.endsWith(ext))?.split("/").pop();
await writeFile("dist/manifest.json", JSON.stringify({ js: entry(".js"), css: entry(".css") }));
await cp("public/fonts", "dist/public/fonts", { recursive: true });
