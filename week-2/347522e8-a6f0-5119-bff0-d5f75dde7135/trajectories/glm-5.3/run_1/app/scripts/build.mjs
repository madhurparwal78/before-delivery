import * as fs from "node:fs";
import { build } from "esbuild";

const shared = {
  bundle: true,
  sourcemap: false,
  logLevel: "info",
  target: "node22",
  format: "esm",
};

await build({
  ...shared,
  entryPoints: ["server/main.ts"],
  outfile: "dist/main.js",
  platform: "node",
  external: ["pg", "pg-protocol", "bcryptjs", "nodemailer", "minio", "pdfkit"],
});

await build({
  ...shared,
  entryPoints: ["client/main.ts"],
  outfile: "public/app.js",
  platform: "browser",
  minify: true,
  legalComments: "none",
});

fs.copyFileSync("public-src/style.css", "public/style.css");
fs.copyFileSync("public-src/index.html", "public/index.html");
fs.mkdirSync("public/fonts", { recursive: true });
for (const font of fs.readdirSync("public-src/fonts")) {
  fs.copyFileSync(`public-src/fonts/${font}`, `public/fonts/${font}`);
}

