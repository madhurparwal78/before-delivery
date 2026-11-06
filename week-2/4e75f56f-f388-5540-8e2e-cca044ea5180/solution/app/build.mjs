import { build } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";

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

const client = await build({
  entryPoints: { app: "src/client/main.tsx" },
  outdir: "dist/public/assets",
  entryNames: "[name]-[hash]",
  chunkNames: "[name]-[hash]",
  bundle: true,
  splitting: true,
  minify: true,
  external: ["/fonts/*"],
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "preact",
  metafile: true,
  logLevel: "warning",
});

const [entry, output] = Object.entries(client.metafile.outputs).find(([, out]) => out.entryPoint === "src/client/main.tsx");
const script = entry.replace("dist/public", "");
const style = output.cssBundle.replace("dist/public", "");
const shell = (await readFile("src/client/index.html", "utf8"))
  .replace("%STYLE%", style)
  .replace("%SCRIPT%", script);
await writeFile("dist/public/index.html", shell);
await cp("public/fonts", "dist/public/fonts", { recursive: true });
console.log(`built ${script} ${style}`);
