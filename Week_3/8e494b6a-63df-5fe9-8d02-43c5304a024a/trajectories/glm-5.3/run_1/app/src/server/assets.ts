/**
 * The app's static assets: the built front bundle and the bundled font files.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export function assetsDir(): string {
  return path.join(__dirname, "..", "front");
}

export function fontsDir(): string {
  return path.join(process.cwd(), "assets", "fonts");
}

export function appJs(): Buffer {
  return readFileSync(path.join(assetsDir(), "app.js"));
}

export function fontFile(name: string): Buffer {
  return readFileSync(path.join(fontsDir(), name));
}
