import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const outdir = new URL("../dist/", import.meta.url);
await rm(outdir, { recursive: true, force: true });
await mkdir(new URL("public/", outdir), { recursive: true });

await build({
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

const client = await build({
  entryPoints: ["src/client/main.tsx"],
  outdir: "dist/public/assets",
  entryNames: "[name]-[hash]",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  metafile: true,
  jsx: "automatic",
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": '"production"' },
});

const outputs = Object.keys(client.metafile.outputs).map((path) => path.replace(/^dist\/public/, ""));
const script = outputs.find((path) => path.endsWith(".js"));
const styles = outputs.find((path) => path.endsWith(".css"));
const html = (await readFile("src/client/index.html", "utf8")).replace("<!--script-->", `<script type="module" src="${script}"></script>`).replace("<!--styles-->", `<link rel="stylesheet" href="${styles}">`);
await writeFile(new URL("public/index.html", outdir), html);
await cp("public/fonts", "dist/public/fonts", { recursive: true });
