import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DocNode } from "../../shared/types.js";
import { Icon, type IconName } from "../ui/icons.js";
import { useEditor } from "./context.js";

const TYPE_ICON: Record<DocNode["type"], IconName> = {
  page: "file-text",
  section: "square",
  stack: "rows-3",
  heading: "heading-1",
  text: "type",
  image: "image",
  button: "mouse-pointer-click",
  nav: "navigation",
  collection_list: "file-stack",
};

interface Row {
  node: DocNode;
  level: number;
  posinset: number;
  setsize: number;
  parentId: string | null;
}

function visibleRows(root: DocNode, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const visit = (node: DocNode, level: number, posinset: number, setsize: number, parentId: string | null) => {
    rows.push({ node, level, posinset, setsize, parentId });
    if (collapsed.has(node.id)) return;
    node.children.forEach((child, i) => visit(child, level + 1, i + 1, node.children.length, node.id));
  };
  visit(root, 1, 1, 1, null);
  return rows;
}

function rowName(node: DocNode): string {
  const parts = [node.name, node.type];
  if (node.shared) parts.push("shared");
  if (node.bind && Object.keys(node.bind).length) parts.push("bound");
  return parts.join(", ");
}

function RenameField({ id, initial }: { id: string; initial: string }) {
  const { act } = useEditor();
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      done.current = true;
      act.commitRename(id, value.trim() || initial);
    } else if (event.key === "Escape") {
      event.preventDefault();
      done.current = true;
      act.cancelRename(id);
    }
  };
  return (
    <input
      ref={ref}
      className="pl-rename"
      aria-label="Name"
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        if (!done.current) act.commitRename(id, value.trim() || initial);
      }}
    />
  );
}

export function Navigator() {
  const { state, act } = useEditor();
  const { page, collapsed, selectedId, layout, drawerOpen, readOnly, renamingId, drag } = state;
  const rows = visibleRows(page.root, collapsed);
  const tabStop = rows.some((r) => r.node.id === state.focusRowId) ? state.focusRowId : (rows.find((r) => r.node.id === selectedId)?.node.id ?? rows[0]?.node.id);
  const open = layout === "desktop" || drawerOpen;
  const focusAt = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    act.setFocusRow(row.node.id);
    document.querySelector<HTMLElement>(`[role="tree"] [data-row-id="${row.node.id}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const id = target.getAttribute("data-row-id");
    if (!id) return;
    const at = rows.findIndex((r) => r.node.id === id);
    const row = rows[at];
    if (!row) return;
    const hasChildren = row.node.children.length > 0;
    const isCollapsed = collapsed.has(id);
    const editing = !readOnly;
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.startsWith("Arrow")) {
      event.preventDefault();
      if (!editing) return;
      const move = { ArrowUp: "up", ArrowDown: "down", ArrowRight: "indent", ArrowLeft: "outdent" } as const;
      const kind = move[event.key as keyof typeof move];
      if (kind) act.keyMove(id, kind);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        return focusAt(at + 1);
      case "ArrowUp":
        event.preventDefault();
        return focusAt(at - 1);
      case "ArrowRight":
        event.preventDefault();
        if (hasChildren && isCollapsed) return act.setCollapsed(id, false);
        if (hasChildren) return focusAt(at + 1);
        return;
      case "ArrowLeft": {
        event.preventDefault();
        if (hasChildren && !isCollapsed) return act.setCollapsed(id, true);
        const parent = rows.findIndex((r) => r.node.id === row.parentId);
        if (parent >= 0) focusAt(parent);
        return;
      }
      case "Home":
        event.preventDefault();
        return focusAt(0);
      case "End":
        event.preventDefault();
        return focusAt(rows.length - 1);
      case "Enter":
      case " ":
        event.preventDefault();
        act.select(id);
        if (layout === "tablet") {
          act.toggleDrawer(false);
          act.focusRow(null);
        }
        return;
      case "F2":
        event.preventDefault();
        if (editing && layout !== "phone") act.startRename(id);
        return;
    }
  };

  return (
    <aside className={`pl-navigator${layout === "tablet" ? " pl-drawer" : ""}`} aria-label="Navigator panel" hidden={!open} inert={!open}>
      <div className="pl-panel-head">
        <h2 className="pl-panel-title">Navigator</h2>
        <span className="pl-mono pl-muted">{rows.length}</span>
      </div>
      <div role="tree" aria-label="Navigator" className="pl-tree" onKeyDown={onKeyDown}>
        {rows.map((row) => {
          const { node } = row;
          const isParent = node.children.length > 0;
          const dropping = drag?.slot?.parentId === node.id;
          return (
            <div
              key={node.id}
              role="treeitem"
              data-row-id={node.id}
              aria-label={rowName(node)}
              aria-level={row.level}
              aria-posinset={row.posinset}
              aria-setsize={row.setsize}
              aria-expanded={isParent ? !collapsed.has(node.id) : undefined}
              aria-selected={selectedId === node.id}
              tabIndex={tabStop === node.id ? 0 : -1}
              className={`pl-row${selectedId === node.id ? " pl-row-selected" : ""}${dropping ? " pl-row-drop" : ""}`}
              style={{ paddingLeft: 8 + (row.level - 1) * 14 }}
              onFocus={() => act.setFocusRow(node.id)}
              onClick={() => act.select(node.id)}
            >
              <span className="pl-twisty" aria-hidden="true" onClick={(e) => (isParent ? (e.stopPropagation(), act.setCollapsed(node.id, !collapsed.has(node.id))) : undefined)}>
                {isParent ? <Icon name={collapsed.has(node.id) ? "chevron-right" : "chevron-down"} size={12} /> : null}
              </span>
              <Icon name={node.shared ? "layers" : TYPE_ICON[node.type]} size={14} />
              {renamingId === node.id ? (
                <RenameField id={node.id} initial={node.name} />
              ) : (
                <span className="pl-row-name" aria-hidden="true">
                  {node.name}
                </span>
              )}
              {node.shared && <span className="pl-badge" data-badge="shared" aria-hidden="true" />}
              {node.bind && Object.keys(node.bind).length > 0 && <span className="pl-badge" data-badge="bound" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <button type="button" className="pl-button pl-add-page" onClick={() => act.openDialog({ kind: "addPage" })}>
          <Icon name="plus" />
          Add page
        </button>
      )}
    </aside>
  );
}
