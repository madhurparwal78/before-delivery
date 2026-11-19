import { cpSync, mkdirSync } from "node:fs";

const fonts = [
  ["@fontsource/instrument-serif", "instrument-serif-latin-400-normal.woff2"],
  ["@fontsource/instrument-sans", "instrument-sans-latin-400-normal.woff2"],
  ["@fontsource/instrument-sans", "instrument-sans-latin-500-normal.woff2"],
  ["@fontsource/instrument-sans", "instrument-sans-latin-600-normal.woff2"],
];

mkdirSync("dist/public/fonts", { recursive: true });
for (const [name, file] of fonts) cpSync(`node_modules/${name}/files/${file}`, `dist/public/fonts/${file}`);
cpSync("public/app.css", "dist/public/app.css");
