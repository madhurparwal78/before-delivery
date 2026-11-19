import { createHash } from "node:crypto";
import { PANES, type Files } from "../shared/types.js";

export function canonicalSha256(files: Files, libraries: readonly string[]): string {
  const hash = createHash("sha256");
  for (const pane of PANES) {
    const bytes = Buffer.from(files[pane], "utf8");
    hash.update(`${pane} ${bytes.length}\n`);
    hash.update(bytes);
    hash.update("\n");
  }
  hash.update(`libraries ${libraries.join(",")}\n`);
  return hash.digest("hex");
}
