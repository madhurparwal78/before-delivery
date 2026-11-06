import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPublic = join(root, "dist", "public");

rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(join(outPublic, "fonts"), { recursive: true });

execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});

await esbuild.build({
  entryPoints: [join(root, "src", "client", "main.ts"), join(root, "src", "client", "styles.css")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2022"],
  outdir: join(outPublic, "assets"),
  entryNames: "[name]",
  splitting: true,
  external: ["/fonts/*"],
  loader: { ".css": "css" },
  logLevel: "info",
});

const fonts: Array<[string, string]> = [
  ["@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-400-normal.woff2", "bricolage-400.woff2"],
  ["@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2", "bricolage-700.woff2"],
  ["@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", "plex-sans-400.woff2"],
  ["@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", "plex-sans-600.woff2"],
  ["@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", "plex-mono-400.woff2"],
  ["@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2", "plex-mono-600.woff2"],
];
for (const [from, to] of fonts) {
  cpSync(join(root, "node_modules", from), join(outPublic, "fonts", to));
}
