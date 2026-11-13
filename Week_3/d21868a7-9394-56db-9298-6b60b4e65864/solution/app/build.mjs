import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/client", { recursive: true });

await build({
  entryPoints: ["server/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  outfile: "dist/server.mjs",
  logLevel: "warning",
});

await build({
  entryPoints: { app: "client/main.tsx" },
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome120", "firefox121", "safari17"],
  outdir: "dist/client/assets",
  entryNames: "[name]-[hash]",
  assetNames: "[name]-[hash]",
  loader: { ".woff2": "file" },
  minify: true,
  metafile: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
}).then(async (result) => {
  const outputs = Object.keys(result.metafile.outputs);
  const script = outputs.find((file) => file.endsWith(".js"));
  const style = outputs.find((file) => file.endsWith(".css"));
  // Preloading the bundled fonts lets the first paint use them, so text does not reflow when they arrive.
  const fonts = outputs
    .filter((file) => file.endsWith(".woff2"))
    .map((file) => `<link rel="preload" href="/${file.replace("dist/client/", "")}" as="font" type="font/woff2" crossorigin />`)
    .join("\n    ");
  const { readFile, writeFile } = await import("node:fs/promises");
  const html = (await readFile("client/index.html", "utf8"))
    .replace("%FONTS%", fonts)
    .replace("%SCRIPT%", "/" + script.replace("dist/client/", ""))
    .replace("%STYLE%", "/" + style.replace("dist/client/", ""));
  await writeFile("dist/client/index.html", html);
});

await copyFile("client/favicon.svg", "dist/client/favicon.svg");
