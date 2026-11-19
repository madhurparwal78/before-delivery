import { build } from "esbuild";
import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public/assets", { recursive: true });
await mkdir("dist/public/fonts", { recursive: true });

await build({
  entryPoints: ["src/server/server.ts"], outfile: "dist/server.js", bundle: true, platform: "node", format: "esm",
  target: "node22", packages: "external", sourcemap: false, logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.tsx" }, outdir: "dist/public/assets", bundle: true, format: "esm", target: "es2022",
  jsx: "automatic", jsxImportSource: "preact", minify: true, sourcemap: false, logLevel: "warning", loader: { ".css": "css" },
  define: { "process.env.NODE_ENV": '"production"' },
  external: ["/fonts/*"],
});

await cp("public", "dist/public", { recursive: true });
const html = await readFile("src/client/index.html", "utf8");
await writeFile("dist/public/index.html", html);
