import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = process.env.BUILD_OUT ?? "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/client/assets`, { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: `${out}/server.js`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

const client = await build({
  entryPoints: ["src/client/main.tsx"],
  outdir: `${out}/client/assets`,
  entryNames: "app-[hash]",
  bundle: true,
  minify: true,
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  format: "esm",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  external: ["/fonts/*"],
});

const outputs = Object.keys(client.metafile.outputs).map((p) => p.slice(p.indexOf("client/") + "client/".length));
const js = outputs.find((p) => p.endsWith(".js"));
const css = outputs.find((p) => p.endsWith(".css"));
cpSync("public/fonts", `${out}/client/fonts`, { recursive: true });
const template = readFileSync("src/client/index.html", "utf8");
writeFileSync(
  `${out}/client/index.html`,
  template.replace("%CSS%", css ? `<link rel="stylesheet" href="/${css}">` : "").replace("%JS%", `<script type="module" src="/${js}"></script>`),
);
