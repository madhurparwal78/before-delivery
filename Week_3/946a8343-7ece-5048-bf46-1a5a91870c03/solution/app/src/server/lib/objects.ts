// Content-addressed repository objects: the published hash formulas (see "Repository model").
import { createHash } from "node:crypto";

type TreeEntryMode = "100644" | "040000";

export interface TreeEntry {
  readonly name: string;
  readonly mode: TreeEntryMode;
  readonly id: string;
}

interface CommitFields {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly authoredAt: number;
  readonly committer: string;
  readonly committedAt: number;
  readonly message: string;
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function blobId(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.length}\n`, "utf8");
  return sha256Hex(Buffer.concat([header, bytes]));
}

export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function treeId(entries: readonly TreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => compareUtf8(a.name, b.name));
  return sha256Hex(`tree\n${sorted.map((e) => `${e.mode} ${e.name} ${e.id}\n`).join("")}`);
}

/** Root tree id of a snapshot of text files keyed by slash-separated path. */
export function treeIdFromFiles(files: ReadonlyMap<string, string>): string {
  const here = new Map<string, string>();
  const folders = new Map<string, Map<string, string>>();
  for (const [path, content] of files) {
    const slash = path.indexOf("/");
    if (slash === -1) {
      here.set(path, content);
      continue;
    }
    const folder = path.slice(0, slash);
    const inside = folders.get(folder) ?? new Map<string, string>();
    inside.set(path.slice(slash + 1), content);
    folders.set(folder, inside);
  }
  const entries: TreeEntry[] = [];
  for (const [name, content] of here) entries.push({ name, mode: "100644", id: blobId(Buffer.from(content, "utf8")) });
  for (const [name, inside] of folders) entries.push({ name, mode: "040000", id: treeIdFromFiles(inside) });
  return treeId(entries);
}

export function normalizeMessage(message: string): string {
  return message.replace(/\s+$/u, "");
}

export function commitId(fields: CommitFields): string {
  const parents = fields.parents.map((p) => `parent ${p}\n`).join("");
  const text =
    `commit\ntree ${fields.tree}\n${parents}` +
    `author ${fields.author} ${fields.authoredAt}\ncommitter ${fields.committer} ${fields.committedAt}\n\n` +
    normalizeMessage(fields.message);
  return sha256Hex(text);
}

export function shortId(id: string): string {
  return id.slice(0, 7);
}
