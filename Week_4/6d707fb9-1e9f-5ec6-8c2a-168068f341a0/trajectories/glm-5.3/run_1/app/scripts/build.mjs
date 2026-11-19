// Build: typecheck the server, compile it to JS, and build the client with Parcel.
import { execSync } from "node:child_process";
import { mkdirSync, cpSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const entry of readdirSync(path.join(root, "public"))) {
  rmSync(path.join(root, "public", entry), { recursive: true, force: true });
}

console.log("Compiling server…");
execSync("npx tsc -p tsconfig.server.json --outDir dist", {
  stdio: "inherit",
  cwd: root,
});

console.log("Copying schema…");
cpSync(path.join(root, "src/server/db/schema.sql"), path.join(dist, "db/schema.sql"));

console.log("Building client…");
execSync("npx parcel build src/client/index.html --dist-dir public --no-source-maps --public-url /", {
  stdio: "inherit",
  cwd: root,
});

console.log("Done.");
