import { build } from "esbuild";
import { rm, mkdir, cp } from "node:fs/promises";

const outdir = "dist";

async function buildFrontend() {
  await rm(`${outdir}/public`, { recursive: true, force: true });
  await mkdir(`${outdir}/public`, { recursive: true });
  const result = await build({
    entryPoints: ["src/frontend/main.tsx"],
    publicPath: "/",
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    outdir: `${outdir}/public`,
    splitting: true,
    entryNames: "[name]",
    chunkNames: "chunks/[name]-[hash]",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
    sourcemap: false,
    metafile: true,
    legalComments: "none",
    logLevel: "warning",
  });
  if (result.errors.length > 0) process.exit(1);
  // The kernel worker ships as a classic script: module workers fail to load under
  // cross-origin isolation in some Chromium builds, and a classic worker keeps I,I
  // working through the shared interrupt flag.
  await build({
    entryPoints: ["src/kernel/worker.ts"],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2022",
    outfile: `${outdir}/public/worker.js`,
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
  });
}

async function compileServer() {
  await build({
    entryPoints: ["src/server/main.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: `${outdir}/server/main.js`,
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    external: ["pg"],
  });
}

const FONT_SETS = {
  inter: ["inter-latin-400-normal.woff2", "inter-latin-400-italic.woff2", "inter-latin-700-normal.woff2"],
  "source-sans-3": ["source-sans-3-latin-400-normal.woff2", "source-sans-3-latin-400-italic.woff2", "source-sans-3-latin-600-normal.woff2", "source-sans-3-latin-700-normal.woff2"],
  "fira-code": ["fira-code-latin-400-normal.woff2"],
};

async function copyStatic() {
  await cp("src/frontend/index.html", `${outdir}/public/index.html`);
  await mkdir(`${outdir}/public/fonts`, { recursive: true });
  for (const [pkg, files] of Object.entries(FONT_SETS)) {
    for (const file of files) {
      await cp(`node_modules/@fontsource/${pkg}/files/${file}`, `${outdir}/public/fonts/${file}`);
    }
  }
  await cp("node_modules/temml/dist/Temml-Local.css", `${outdir}/public/fonts/Temml-Local.css`);
  await cp("node_modules/temml/dist/Temml.woff2", `${outdir}/public/fonts/Temml.woff2`);
}

await Promise.all([buildFrontend(), compileServer()]);
await copyStatic();
console.log("build complete");
