/**
 * Resolves the application root, which holds `public/` and the built `dist/web`.
 * Walking up from this module keeps the lookup correct whether the server runs
 * from `src` or from the compiled `dist` tree.
 */

import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

function findAppRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  const { root } = parse(directory);
  while (true) {
    if (existsSync(join(directory, "public", "fonts"))) return directory;
    if (directory === root) throw new Error("could not find the application root (no public/fonts above this module)");
    directory = dirname(directory);
  }
}

export const APP_ROOT = findAppRoot();
export const FONT_DIR = join(APP_ROOT, "public", "fonts");
export const WEB_DIST_DIR = join(APP_ROOT, "dist", "web");
