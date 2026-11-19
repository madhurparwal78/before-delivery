import { createHash } from "node:crypto";

export interface Panes {
  html: string;
  css: string;
  js: string;
}

export interface Snapshot {
  pen_id: string;
  number: number;
  sha256: string;
  files: Panes;
  libraries: string[];
}

export function paneBytes(pane: string): Buffer {
  return Buffer.from(pane, "utf8");
}

export function canonicalHash(files: Panes, libraries: string[]): string {
  const h = createHash("sha256");
  const parts: Array<[string, string]> = [
    ["html", files.html],
    ["css", files.css],
    ["js", files.js],
  ];
  for (const [name, pane] of parts) {
    h.update(Buffer.from(`${name} ${paneBytes(pane).length}\n`, "utf8"));
    h.update(paneBytes(pane));
    h.update(Buffer.from("\n", "utf8"));
  }
  h.update(Buffer.from(`libraries ${libraries.join(",")}\n`, "utf8"));
  return h.digest("hex");
}

export function snapshotJson(s: Omit<Snapshot, "sha256">): string {
  return JSON.stringify({
    pen_id: s.pen_id,
    number: s.number,
    sha256: canonicalHash(s.files, s.libraries),
    files: s.files,
    libraries: s.libraries,
  });
}
