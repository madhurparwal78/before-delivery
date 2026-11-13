// `node build.mjs` builds both halves; `node build.mjs server` or `node build.mjs client` rebuilds one without touching the other.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const only = process.argv[2];

async function server() {
  await rm("dist/server", { recursive: true, force: true });
  await build({
    entryPoints: ["src/server/main.ts"],
    outfile: "dist/server/main.js",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
  });
}

async function client() {
  await rm("dist/public", { recursive: true, force: true });
  await mkdir("dist/public", { recursive: true });
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
  await cp("public", "dist/public", { recursive: true });
  await writeFile("dist/manifest.json", JSON.stringify({ js: entry(".js"), css: entry(".css") }));
}

await mkdir("dist", { recursive: true });
if (only !== "client") await server();
if (only !== "server") await client();
