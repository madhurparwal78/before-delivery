// Resolves src/tsconfig.json (extend chains included) so esbuild honours the
// compilerOptions used by tsc.
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

export async function loadTsconfig(root) {
  const file = join(root, "src/tsconfig.json");
  const compilerOptions = await readChain(file);
  return { compilerOptions };
}

async function readChain(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const own = { ...(raw.compilerOptions ?? {}) };
  if (own.extends) {
    const parent = normalize(join(dirname(file), own.extends));
    const inherited = await readChain(parent);
    for (const [key, value] of Object.entries(inherited)) {
      if (!(key in own)) own[key] = value;
    }
  }
  delete own.extends;
  delete own.baseUrl;
  delete own.paths;
  return own;
}
