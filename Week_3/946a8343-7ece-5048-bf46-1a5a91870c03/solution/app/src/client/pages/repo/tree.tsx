// `tree "Files"`: a flat ARIA tree of the repository at one commit-ish. Folders load on demand.
//   Keys: ArrowDown/ArrowUp/Home/End move between visible items, ArrowRight opens a closed folder or moves into an open one,
//   ArrowLeft closes an open folder or moves to the parent, Enter opens a file (or toggles a folder), a letter jumps to the next
//   visible item whose name starts with it. One item is the tab stop (roving tabindex).
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { asApiError, type ApiError } from "../../api.ts";
import { Icon } from "../../ui/icons.tsx";
import { Notice, Skeleton } from "../../ui/feedback.tsx";
import { basename, dirname, joinPath, loadTree } from "./data.ts";
import type { TreeEntry } from "./types.ts";

interface FileTreeProps {
  project: string;
  /** Branch, tag or commit id the tree shows. */
  at: string;
  selected: string;
  /** Folders to open once the tree has loaded. */
  reveal: readonly string[];
  onOpenFile(path: string): void;
}

interface Item {
  path: string;
  name: string;
  type: "blob" | "tree";
  depth: number;
  position: number;
  siblings: number;
}

function ordered(entries: readonly TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => (a.type === b.type ? 0 : a.type === "tree" ? -1 : 1));
}

function flatten(dirs: ReadonlyMap<string, TreeEntry[]>, open: ReadonlySet<string>): Item[] {
  const out: Item[] = [];
  const walk = (dir: string, depth: number): void => {
    const entries = dirs.get(dir) ?? [];
    entries.forEach((entry, index) => {
      const path = joinPath(dir, entry.name);
      out.push({ path, name: entry.name, type: entry.type, depth, position: index + 1, siblings: entries.length });
      if (entry.type === "tree" && open.has(path) && dirs.has(path)) walk(path, depth + 1);
    });
  };
  walk("", 0);
  return out;
}

export function FileTree({ project, at, selected, reveal, onOpenFile }: FileTreeProps) {
  const [dirs, setDirs] = useState<ReadonlyMap<string, TreeEntry[]>>(new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const known = useRef<Map<string, TreeEntry[]>>(new Map());
  const revealKey = reveal.join("\n");

  const fetchDir = async (path: string, token: number): Promise<boolean> => {
    if (known.current.has(path)) return true;
    try {
      const entries = ordered(await loadTree(project, at, path));
      if (token !== generation.current) return false;
      known.current.set(path, entries);
      setDirs(new Map(known.current));
      return true;
    } catch (cause) {
      if (token === generation.current && path === "") setFailure(asApiError(cause));
      return false;
    }
  };

  useLayoutEffect(() => {
    const token = ++generation.current;
    known.current = new Map();
    setDirs(new Map());
    setOpen(new Set());
    setFailure(null);
    setReady(false);
    void fetchDir("", token).then(() => {
      if (token === generation.current) setReady(true);
    });
  }, [project, at]);

  useLayoutEffect(() => {
    if (!ready) return;
    const token = generation.current;
    void Promise.all(reveal.map(async (path) => ((await fetchDir(path, token)) ? path : null))).then((loaded) => {
      if (token !== generation.current) return;
      setOpen((current) => new Set([...current, ...loaded.filter((path): path is string => path !== null)]));
    });
  }, [ready, revealKey]);

  const items = flatten(dirs, open);
  const tabStop = items.some((item) => item.path === focusPath)
    ? focusPath
    : items.some((item) => item.path === selected)
      ? selected
      : (items[0]?.path ?? null);

  const focusItem = (path: string): void => {
    setFocusPath(path);
    for (const element of root.current?.querySelectorAll<HTMLElement>("[role='treeitem']") ?? []) {
      if (element.dataset.path === path) {
        element.focus();
        return;
      }
    }
  };

  const setFolder = async (path: string, wanted: boolean): Promise<void> => {
    if (wanted && !known.current.has(path)) await fetchDir(path, generation.current);
    setOpen((current) => {
      const next = new Set(current);
      if (wanted) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const index = items.findIndex((item) => item.path === tabStop);
    const current = items[index];
    if (!current) return;
    const go = (to: number): void => {
      const target = items[Math.max(0, Math.min(items.length - 1, to))];
      if (target) focusItem(target.path);
    };
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        go(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        go(index - 1);
        return;
      case "Home":
        event.preventDefault();
        go(0);
        return;
      case "End":
        event.preventDefault();
        go(items.length - 1);
        return;
      case "ArrowRight":
        event.preventDefault();
        if (current.type !== "tree") return;
        if (!open.has(current.path)) void setFolder(current.path, true);
        else if (items[index + 1] && items[index + 1].depth > current.depth) go(index + 1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (current.type === "tree" && open.has(current.path)) void setFolder(current.path, false);
        else if (current.depth > 0) focusItem(dirname(current.path));
        return;
      case "Enter":
        event.preventDefault();
        if (current.type === "tree") void setFolder(current.path, !open.has(current.path));
        else onOpenFile(current.path);
        return;
      default:
        if (event.key.length === 1 && event.key !== " ") {
          const letter = event.key.toLowerCase();
          for (let step = 1; step <= items.length; step++) {
            const candidate = items[(index + step) % items.length];
            if (candidate && candidate.name.toLowerCase().startsWith(letter)) {
              event.preventDefault();
              focusItem(candidate.path);
              return;
            }
          }
        }
    }
  };

  if (failure) return <Notice>{failure.message}</Notice>;
  if (!ready) return <Skeleton rows={5} height={36} />;
  return (
    <div ref={root} role="tree" aria-label="Files" class="sp-tree" onKeyDown={onKeyDown}>
      {items.map((item) => {
        const isFolder = item.type === "tree";
        const expanded = open.has(item.path);
        return (
          <div
            key={item.path}
            role="treeitem"
            aria-label={item.name}
            aria-level={item.depth + 1}
            aria-posinset={item.position}
            aria-setsize={item.siblings}
            aria-expanded={isFolder ? (expanded ? "true" : "false") : undefined}
            aria-selected={item.path === selected ? "true" : "false"}
            tabIndex={item.path === tabStop ? 0 : -1}
            data-path={item.path}
            class={`sp-tree__item${item.path === selected ? " sp-tree__item--selected" : ""}`}
            style={{ paddingLeft: `${8 + item.depth * 16}px` }}
            onFocus={() => setFocusPath(item.path)}
            onClick={() => {
              setFocusPath(item.path);
              if (isFolder) void setFolder(item.path, !expanded);
              else onOpenFile(item.path);
            }}
          >
            <Icon name={isFolder ? (expanded ? "chevron-down" : "chevron-right") : "file"} size={16} class="sp-tree__icon" />
            <span class="sp-tree__name" title={basename(item.path)}>
              {item.name}
            </span>
          </div>
        );
      })}
      {items.length === 0 ? <p class="sp-tree__empty">No files.</p> : null}
    </div>
  );
}
