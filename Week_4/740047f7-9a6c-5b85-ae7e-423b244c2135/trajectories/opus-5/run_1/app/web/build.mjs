import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const out = "dist";
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/fonts`, { recursive: true });

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  outfile: `${out}/pensight.js`,
  legalComments: "none",
});

const weights = ["300", "400", "500"];
const faces = [
  ["inter", "@fontsource/inter/files/inter-latin"],
  ["inter-tight", "@fontsource/inter-tight/files/inter-tight-latin"],
];
for (const [family, prefix] of faces) {
  for (const weight of weights) {
    await cp(
      `node_modules/${prefix}-${weight}-normal.woff2`,
      `${out}/fonts/${family}-${weight}.woff2`,
    );
  }
}

await cp("public/index.html", `${out}/index.html`);
const css = await readFile("public/styles.css", "utf8");
await writeFile(`${out}/styles.css`, css);
