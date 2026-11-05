import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const iconsDir = join(dirname(require.resolve("lucide-static/package.json")), "icons");

const NAMES = ["download", "upload", "menu", "x", "arrow-left", "triangle-alert"] as const;

export type IconName = (typeof NAMES)[number];

const markup = new Map<IconName, string>(
  NAMES.map((name) => [
    name,
    readFileSync(join(iconsDir, `${name}.svg`), "utf8")
      .replace(/\n/g, "")
      .replace("<svg ", '<svg aria-hidden="true" focusable="false" class="icon" '),
  ]),
);

/** Lucide is the one icon set, drawn decoratively beside its own label. */
export function icon(name: IconName): string {
  return markup.get(name) ?? "";
}
