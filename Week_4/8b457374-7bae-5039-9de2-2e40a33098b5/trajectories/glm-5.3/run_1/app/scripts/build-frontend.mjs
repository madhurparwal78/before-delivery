// Builds the browser modules into public/js as plain ES modules.
import { build } from "esbuild";
import { copyFile, mkdir, readdir, rename, access } from "node:fs/promises";

// The Jost font files ship with the app and are served from its own origin.
await mkdir("public/js", { recursive: true });
await mkdir("public/fonts", { recursive: true });
for (const weight of ["400", "500", "700"]) {
  await copyFile(
    `node_modules/@fontsource/jost/files/jost-latin-${weight}-normal.woff2`,
    `public/fonts/jost-latin-${weight}-normal.woff2`,
  );
}

const entries = [
  { in: "src/frontend/home.ts", out: "home" },
  { in: "src/frontend/campaign.ts", out: "campaign" },
  { in: "src/frontend/campaigns-list.ts", out: "campaigns-list" },
  { in: "src/frontend/studio.ts", out: "studio" },
  { in: "src/frontend/editor.ts", out: "editor" },
  { in: "src/frontend/pledges.ts", out: "pledges" },
  { in: "src/frontend/fix.ts", out: "fix" },
  { in: "src/frontend/not-found.ts", out: "not-found" },
];

await mkdir("public/js", { recursive: true });

await build({
  entryPoints: [
    ...entries.map((entry) => entry.in),
    "src/frontend/api.ts",
    "src/frontend/plate-fill.ts",
  ],
  outdir: "public/js",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "info",
});

// The pages import module names by file; rename the entry chunks to match.
const renames = new Map(
  entries.map((entry) => [`${entry.in.split("/").pop().replace(".ts", "")}.js`, `${entry.out}.js`]),
);
const files = await readdir("public/js");
for (const file of files) {
  const target = renames.get(file);
  if (target !== undefined && target !== file) {
    try {
      await access(`public/js/${target}`);
      continue;
    } catch {
      await rename(`public/js/${file}`, `public/js/${target}`);
    }
  }
}

