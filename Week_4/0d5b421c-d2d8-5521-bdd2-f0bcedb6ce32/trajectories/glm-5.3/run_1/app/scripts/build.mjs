/**
 * Build: bundle the client pages with esbuild into public/assets, then bundle the
 * server into a single file. The server serves only built assets and the API.
 */
import { build } from "esbuild";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");

const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
};

// Client pages, minified.
await build({
  ...shared,
  entryPoints: [
    "src/client/home.ts",
    "src/client/book.ts",
    "src/client/waitlist.ts",
    "src/client/offer.ts",
    "src/client/manage.ts",
    "src/client/host-signin.ts",
    "src/client/host.ts",
  ],
  outdir: join(dist, "client/assets"),
  splitting: true,
  chunkNames: "[name]-[hash]",
  minify: true,
});

// Server bundle (single file, node platform, deps kept external).
await build({
  ...shared,
  entryPoints: ["src/server/main.ts"],
  outfile: join(dist, "server/main.js"),
  platform: "node",
  packages: "external",
  minify: false,
});

// Copy static assets next to the built client scripts: everything the pages
// reference lives under /assets, everything else sits at the root.
await rm(join(dist, "client/assets/styles.css"), { force: true });
await rm(join(dist, "client/assets/fonts"), { recursive: true, force: true });
await cp(join(root, "public/styles.css"), join(dist, "client/assets/styles.css"));
await cp(join(root, "public/fonts"), join(dist, "client/assets/fonts"), { recursive: true });
for (const f of ["home.html", "book.html", "waitlist.html", "offer.html", "manage.html", "host-signin.html", "host.html", "notfound.html"]) {
  await cp(join(root, "public", f), join(dist, "client", f));
}

console.log("build complete");
