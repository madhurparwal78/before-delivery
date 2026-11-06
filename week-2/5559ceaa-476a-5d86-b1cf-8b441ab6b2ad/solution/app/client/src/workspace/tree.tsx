import { useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import type { FileMeta } from "../types";

export type Selection = { kind: "file"; id: string } | { kind: "folder"; path: string } | null;

interface Node {
  key: string;
  name: string;
  path: string;
  level: number;
  file?: FileMeta;
  children: Node[];
}

function buildTree(files: FileMeta[]): Node[] {
  const root: Node = { key: "", name: "", path: "", level: 0, children: [] };
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const parts = file.path.split("/");
    let parent = root;
    parts.slice(0, -1).forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let folder = parent.children.find((c) => !c.file && c.path === path);
      if (!folder) {
        folder = { key: `d:${path}`, name: part, path, level: i + 1, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    });
    parent.children.push({ key: `f:${file.id}`, name: parts[parts.length - 1]!, path: file.path, level: parts.length, file, children: [] });
  }
  const order = (nodes: Node[]): Node[] =>
    nodes
      .sort((a, b) => (!!a.file === !!b.file ? (a.name < b.name ? -1 : 1) : a.file ? 1 : -1))
      .map((n) => ({ ...n, children: order(n.children) }));
  return order(root.children);
}

interface TreeProps {
  files: FileMeta[];
  selection: Selection;
  activeId: string | null;
  onSelect: (selection: Selection) => void;
  onOpen: (fileId: string) => void;
}

/** The Files tree: one Tab stop, arrows move, Right/Left open and close folders, Enter opens a file. */
export function FileTree({ files, selection, activeId, onSelect, onOpen }: TreeProps) {
  const nodes = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const root = useRef<HTMLUListElement>(null);

  const visible: Node[] = [];
  const walk = (list: Node[]) =>
    list.forEach((n) => {
      visible.push(n);
      if (!n.file && !collapsed.has(n.path)) walk(n.children);
    });
  walk(nodes);

  const selectedKey =
    selection?.kind === "file" ? `f:${selection.id}` : selection?.kind === "folder" ? `d:${selection.path}` : null;
  const stopKey = visible.some((n) => n.key === selectedKey) ? selectedKey : (visible[0]?.key ?? null);

  const focusKey = (key: string) => root.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  const choose = (node: Node) => onSelect(node.file ? { kind: "file", id: node.file.id } : { kind: "folder", path: node.path });
  const toggle = (path: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const shouldOpen = open ?? next.has(path);
      if (shouldOpen) next.delete(path);
      else next.add(path);
      return next;
    });

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const key = (document.activeElement as HTMLElement | null)?.dataset.key;
    const at = visible.findIndex((n) => n.key === key);
    const node = visible[at];
    if (!node) return;
    const move = (target: Node | undefined) => {
      if (!target) return;
      event.preventDefault();
      choose(target);
      focusKey(target.key);
    };
    switch (event.key) {
      case "ArrowDown":
        return move(visible[at + 1]);
      case "ArrowUp":
        return move(visible[at - 1]);
      case "Home":
        return move(visible[0]);
      case "End":
        return move(visible[visible.length - 1]);
      case "ArrowRight":
        event.preventDefault();
        if (!node.file && collapsed.has(node.path)) toggle(node.path, true);
        else if (!node.file) move(node.children[0]);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (!node.file && !collapsed.has(node.path)) return toggle(node.path, false);
        return move(visible.find((n) => !n.file && n.level === node.level - 1 && node.path.startsWith(`${n.path}/`)));
      case "Enter":
      case " ":
        event.preventDefault();
        if (node.file) onOpen(node.file.id);
        else toggle(node.path);
        return;
    }
  };

  const render = (list: Node[]) =>
    list.map((node) => {
      const folderOpen = !node.file && !collapsed.has(node.path);
      return (
        <li
          key={node.key}
          role="treeitem"
          data-key={node.key}
          aria-label={node.file ? node.path : undefined}
          aria-level={node.level}
          aria-selected={node.key === selectedKey}
          aria-expanded={node.file ? undefined : folderOpen}
          tabIndex={node.key === stopKey ? 0 : -1}
          className="tree-item"
        >
          <div
            className={`tree-row${node.key === selectedKey ? " is-selected" : ""}${node.file && node.file.id === activeId ? " is-active" : ""}`}
            style={{ paddingInlineStart: `${8 + (node.level - 1) * 14}px` }}
            onClick={() => {
              choose(node);
              if (node.file) onOpen(node.file.id);
              else toggle(node.path);
            }}
          >
            {node.file ? (
              <Icon name="file" size={14} />
            ) : (
              <span className={folderOpen ? "tree-chevron is-open" : "tree-chevron"}>
                <Icon name="chevron" size={12} />
              </span>
            )}
            <span className="tree-name">{node.name}</span>
          </div>
          {!node.file && folderOpen && <ul role="group">{render(node.children)}</ul>}
        </li>
      );
    });

  return (
    <ul ref={root} role="tree" aria-label="Files" className="tree" onKeyDown={onKeyDown}>
      {render(nodes)}
    </ul>
  );
}
