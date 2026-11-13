// Pure tree building: a flat path-to-blob map becomes the nested tree objects whose ids the brief publishes.
import { compareUtf8, treeId, type TreeEntry } from "../lib/objects.ts";

// Path (slash separated) to blob id.
export type Entries = ReadonlyMap<string, string>;

interface BuiltTrees {
  readonly root: string;
  readonly trees: ReadonlyMap<string, readonly TreeEntry[]>;
}

export function buildTrees(entries: Entries): BuiltTrees {
  const trees = new Map<string, readonly TreeEntry[]>();
  const build = (files: ReadonlyMap<string, string>): string => {
    const own: TreeEntry[] = [];
    const folders = new Map<string, Map<string, string>>();
    for (const [path, id] of files) {
      const slash = path.indexOf("/");
      if (slash === -1) {
        own.push({ name: path, mode: "100644", id });
        continue;
      }
      const folder = path.slice(0, slash);
      const inside = folders.get(folder) ?? new Map<string, string>();
      inside.set(path.slice(slash + 1), id);
      folders.set(folder, inside);
    }
    for (const [name, inside] of folders) own.push({ name, mode: "040000", id: build(inside) });
    own.sort((a, b) => compareUtf8(a.name, b.name));
    const id = treeId(own);
    trees.set(id, own);
    return id;
  };
  const root = build(entries);
  return { root, trees };
}

export function sortedPaths(entries: Entries): string[] {
  return [...entries.keys()].sort(compareUtf8);
}

// A JavaScript string holds UTF-8 text unless it contains a lone surrogate.
export function isUtf8Text(text: string): boolean {
  return !/\p{Cs}/u.test(text);
}

export function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

// Paths the repository accepts: no leading slash and no empty, `.` or `..` segment.
export function isValidPath(path: string): boolean {
  if (path === "" || path.startsWith("/")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

// The first path that is also the folder of another path (a file and a folder cannot share a name).
export function firstFileFolderClash(paths: Iterable<string>): string | undefined {
  const all = new Set(paths);
  const sorted = [...all].sort(compareUtf8);
  for (const path of sorted) {
    let slash = path.indexOf("/");
    while (slash !== -1) {
      const folder = path.slice(0, slash);
      if (all.has(folder)) return folder;
      slash = path.indexOf("/", slash + 1);
    }
  }
  return undefined;
}
