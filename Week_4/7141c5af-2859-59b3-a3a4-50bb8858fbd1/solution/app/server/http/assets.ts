import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytes, route } from "./router.ts";
import { notFound } from "./errors.ts";

const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff" };

const folder = (): string => join(dirname(fileURLToPath(import.meta.url)), "assets");

/** Jost's upright latin files, linked from the head so the face is in before the first layout (no reflow on its arrival). */
export const latinFonts = (() => {
  let names: string[] | undefined;
  return (): string[] => (names ??= readdirSync(folder()).filter((name) => /^jost-latin-\d+-normal-.*\.woff2$/.test(name)));
})();

/** Built files under /assets/, read once at start; only names the build wrote are ever served. */
export function registerAssets(): void {
  const files = new Map(readdirSync(folder()).map((name) => [name, readFileSync(join(folder(), name))]));
  route({
    method: "GET",
    pattern: "/assets/:name",
    access: "public",
    handle: async (ctx) => {
      const name = ctx.params.name as string;
      const file = files.get(name);
      if (!file) throw notFound();
      return bytes(200, TYPES[extname(name)] ?? "application/octet-stream", file);
    },
  });
}
