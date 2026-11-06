import { readFileSync, writeFileSync, existsSync } from "node:fs";

// png-js@2.0.0 is MIT by its shipped LICENSE file but its registry package.json
// omits the license field. Record the fact so tooling can read it.
const manifest = "node_modules/png-js/package.json";
if (existsSync(manifest) && existsSync("node_modules/png-js/LICENSE")) {
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.license === undefined) {
    pkg.license = "MIT";
    writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
  }
}
