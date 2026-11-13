// Pure application of commit actions to a snapshot of blob ids. Nothing here touches the database or file storage.
import { blobId, compareUtf8 } from "../lib/objects.ts";
import type { FileAction } from "./types.ts";
import { firstFileFolderClash, isUtf8Text, isValidPath, type Entries } from "./trees.ts";

interface PreparedFiles {
  readonly entries: Map<string, string>;
  // Bytes of every blob the actions produced, by blob id.
  readonly blobs: Map<string, Buffer>;
  // The same blobs as text.
  readonly texts: Map<string, string>;
  // Field name to message, in the order the problems were found.
  readonly errors: Map<string, string>;
}

export function oversizedFile(actions: readonly FileAction[], max: number): FileAction | undefined {
  return actions.find((action) => typeof action.content === "string" && Buffer.byteLength(action.content, "utf8") > max);
}

export function applyActions(before: Entries, actions: readonly FileAction[]): PreparedFiles {
  const entries = new Map(before);
  const blobs = new Map<string, Buffer>();
  const texts = new Map<string, string>();
  const errors = new Map<string, string>();
  const fail = (index: number, field: string, message: string): void => {
    const key = `actions.${index}.${field}`;
    if (!errors.has(key)) errors.set(key, message);
  };
  const store = (index: number, path: string, content: string | undefined): string | undefined => {
    if (typeof content !== "string") {
      fail(index, "content", `File ${path} needs content.`);
      return undefined;
    }
    if (!isUtf8Text(content)) {
      fail(index, "content", `File ${path} is not UTF-8 text.`);
      return undefined;
    }
    const bytes = Buffer.from(content, "utf8");
    const id = blobId(bytes);
    blobs.set(id, bytes);
    texts.set(id, content);
    return id;
  };

  actions.forEach((action, index) => {
    const path = action.path;
    if (!isValidPath(path)) {
      fail(index, "path", `Path ${path} is not valid.`);
      return;
    }
    if (action.action === "create") {
      if (entries.has(path)) fail(index, "path", `File ${path} already exists.`);
      else {
        const id = store(index, path, action.content);
        if (id !== undefined) entries.set(path, id);
      }
    } else if (action.action === "update") {
      if (!entries.has(path)) fail(index, "path", `File ${path} does not exist.`);
      else {
        const id = store(index, path, action.content);
        if (id !== undefined) entries.set(path, id);
      }
    } else if (action.action === "delete") {
      if (!entries.has(path)) fail(index, "path", `File ${path} does not exist.`);
      else entries.delete(path);
    } else {
      const from = action.previous_path;
      if (typeof from !== "string" || !isValidPath(from)) fail(index, "previous_path", `Path ${from ?? ""} is not valid.`);
      else if (!entries.has(from)) fail(index, "previous_path", `File ${from} does not exist.`);
      else if (entries.has(path)) fail(index, "path", `File ${path} already exists.`);
      else {
        const moved = entries.get(from);
        entries.delete(from);
        const id = action.content === undefined ? moved : store(index, path, action.content);
        if (id !== undefined) entries.set(path, id);
      }
    }
  });

  if (errors.size === 0) {
    const clash = firstFileFolderClash(entries.keys());
    if (clash !== undefined) errors.set("actions", `File ${clash} already exists.`);
  }
  return { entries: sortEntries(entries), blobs, texts, errors };
}

function sortEntries(entries: Map<string, string>): Map<string, string> {
  return new Map([...entries].sort((a, b) => compareUtf8(a[0], b[0])));
}
