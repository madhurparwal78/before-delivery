// A folder tree with one Tab stop and roving focus (brief: Interactions, Folder tree).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { filesWord } from "../format";
import { reducedMotion } from "./homing";
import { collator } from "../../shared/rules";
import type { Folder } from "../../shared/api";

const TYPEAHEAD_MS = 500;

interface Node {
  folder: Folder;
  level: number;
  setSize: number;
  position: number;
  hasChildren: boolean;
}

/** The visible nodes in order: roots are folders whose parent the person cannot see. */
export function visibleNodes(all: Folder[], expanded: Set<string>): Node[] {
  const ids = new Set(all.map((f) => f.id));
  const children = new Map<string | null, Folder[]>();
  for (const folder of all) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(folder);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => collator.compare(a.name, b.name));
  const out: Node[] = [];
  const walk = (parent: string | null, level: number) => {
    const list = children.get(parent) ?? [];
    list.forEach((folder, i) => {
      const hasChildren = (children.get(folder.id)?.length ?? 0) > 0;
      out.push({ folder, level, setSize: list.length, position: i + 1, hasChildren });
      if (hasChildren && expanded.has(folder.id)) walk(folder.id, level + 1);
    });
  };
  walk(null, 1);
  return out;
}

function Count({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(value);
  useLayoutEffect(() => {
    if (last.current !== value && ref.current && !reducedMotion()) {
      ref.current.animate([{ transform: "translateY(-45%)", opacity: 0.25 }, { transform: "none", opacity: 1 }], { duration: 180, easing: "ease-out" });
    }
    last.current = value;
  }, [value]);
  return <span ref={ref} className="node-count num" aria-hidden="true">{value}</span>;
}

interface Props {
  label: "Folders" | "Destination folders";
  folders: Folder[];
  expanded: Set<string>;
  onToggle: (id: string, open: boolean) => void;
  /** The folder shown as current: the open folder, or the chosen destination. */
  current: string | null;
  onOpen: (id: string) => void;
  /** Destination trees choose on focus and click; Enter or a double click confirms. */
  onFocusNode?: (id: string) => void;
  counts?: Record<string, number>;
  badge?: { folderId: string | null; n: number } | null;
  dropTarget?: string | null;
  autoFocus?: boolean;
  compact?: boolean;
  /** In a destination tree, the folder the moving files are already in. */
  sourceId?: string | null;
}

export function Tree({ label, folders: all, expanded, onToggle, current, onOpen, onFocusNode, counts, badge, dropTarget, autoFocus, compact, sourceId }: Props) {
  const nodes = useMemo(() => visibleNodes(all, expanded), [all, expanded]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const typed = useRef<{ text: string; timer?: ReturnType<typeof setTimeout> }>({ text: "" });
  const root = useRef<HTMLDivElement>(null);
  const roving = nodes.some((n) => n.folder.id === focusId) ? focusId
    : nodes.some((n) => n.folder.id === current) ? current : nodes[0]?.folder.id ?? null;

  useEffect(() => {
    if (autoFocus) root.current?.querySelector<HTMLElement>("[role=treeitem][tabindex='0']")?.focus();
  }, [autoFocus]);

  const focusNode = (id: string) => {
    setFocusId(id);
    onFocusNode?.(id);
    root.current?.querySelector<HTMLElement>(`[data-folder-node="${CSS.escape(id)}"]`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const at = nodes.findIndex((n) => n.folder.id === roving);
    const node = nodes[at];
    if (!node) return;
    const next = nodes[at + 1], previous = nodes[at - 1], last = nodes[nodes.length - 1];
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    switch (event.key) {
      case "ArrowDown":
        if (next) focusNode(next.folder.id);
        break;
      case "ArrowUp":
        if (previous) focusNode(previous.folder.id);
        break;
      case "ArrowRight":
        if (node.hasChildren && !expanded.has(node.folder.id)) onToggle(node.folder.id, true);
        else if (node.hasChildren && next) focusNode(next.folder.id);
        break;
      case "ArrowLeft": {
        if (node.hasChildren && expanded.has(node.folder.id)) onToggle(node.folder.id, false);
        else {
          const parent = nodes.slice(0, at).reverse().find((n) => n.level === node.level - 1);
          if (parent) focusNode(parent.folder.id);
        }
        break;
      }
      case "Home":
        if (nodes[0]) focusNode(nodes[0].folder.id);
        break;
      case "End":
        if (last) focusNode(last.folder.id);
        break;
      case "Enter":
        onOpen(node.folder.id);
        break;
      default: {
        if (!plain || event.key.length !== 1 || event.key === " ") return;
        clearTimeout(typed.current.timer);
        typed.current.text += event.key.toLowerCase();
        typed.current.timer = setTimeout(() => (typed.current.text = ""), TYPEAHEAD_MS);
        const text = typed.current.text;
        const start = text.length > 1 ? at : at + 1;
        for (let i = 0; i < nodes.length; i++) {
          const candidate = nodes[(start + i) % nodes.length];
          if (candidate?.folder.name.toLowerCase().startsWith(text)) {
            focusNode(candidate.folder.id);
            break;
          }
        }
      }
    }
    event.preventDefault();
  };

  return (
    <div ref={root} role="tree" aria-label={label} data-tree={label} data-shortcuts={label === "Folders" ? "" : undefined}
      className={`tree${compact ? " tree-compact" : ""}`} onKeyDown={onKeyDown}>
      {nodes.map((node) => {
        const id = node.folder.id;
        const count = counts?.[id] ?? node.folder.fileCount;
        const open = expanded.has(id);
        const descId = `${label === "Folders" ? "t" : "d"}-${id}-count`;
        return (
          <div key={id} role="treeitem" aria-level={node.level} aria-setsize={node.setSize} aria-posinset={node.position}
            aria-expanded={node.hasChildren ? open : undefined} aria-selected={id === current}
            aria-describedby={descId} aria-disabled={id === sourceId || undefined} tabIndex={id === roving ? 0 : -1}
            data-folder-node={id} data-drop-folder={label === "Folders" ? id : undefined}
            className={`node${id === current ? " is-current" : ""}${dropTarget === id ? " is-drop" : ""}${id === sourceId ? " is-source" : ""}`}
            style={{ paddingInlineStart: `${4 + (node.level - 1) * 14}px` }}
            title={node.folder.name}
            onFocus={() => {
              setFocusId(id);
              onFocusNode?.(id);
            }}
            onClick={() => (onFocusNode ? focusNode(id) : onOpen(id))}
            onDoubleClick={() => onFocusNode && onOpen(id)}>
            <span className="node-marker" aria-hidden="true"
              onClick={(e) => {
                if (!node.hasChildren) return;
                e.stopPropagation();
                onToggle(id, !open);
              }}>
              {node.hasChildren && <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />}
            </span>
            <Icon name={id === current ? "folderOpen" : "folder"} size={15} />
            <span className="node-name">{node.folder.name}</span>
            {id === sourceId && <span className="node-hint" aria-hidden="true">Current folder</span>}
            {badge && badge.folderId === id && <span className="plus-badge num" aria-hidden="true">+{badge.n}</span>}
            {counts && <Count value={count} />}
            <span id={descId} className="visually-hidden" aria-hidden="true">{filesWord(count)}</span>
          </div>
        );
      })}
    </div>
  );
}
