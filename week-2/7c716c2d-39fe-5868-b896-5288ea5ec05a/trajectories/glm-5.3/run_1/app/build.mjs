// Builds the app: type-checks TypeScript, bundles the server and the browser code.
import { execFileSync } from "node:child_process";

try {
  execFileSync(
    process.execPath,
    ["./node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    { stdio: "inherit" }
  );
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: ["src/server/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: "dist/server.js",
    target: ["node22"],
    legalComments: "none",
    logLevel: "warning",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  await esbuild.build({
    entryPoints: ["src/client/main.tsx"],
    bundle: true,
    outfile: "public/assets/app.js",
    minify: true,
    format: "iife",
    target: ["es2020"],
    jsx: "automatic",
    loader: { ".css": "text" },
    legalComments: "none",
    logLevel: "warning",
  });
  console.log("build ok");
} catch (e) {
  console.error(e);
  process.exit(1);
}

