// An ARIA tree: one Tab stop, arrows move and open, Home and End jump; clicking a row with children toggles it.
import { useState, type KeyboardEvent, type ReactNode } from "react";

export interface TreeNode {
  id: string;
  label: string;
  content: ReactNode;
  children: TreeNode[];
}

function ids(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...ids(node.children)]);
}

function withChildren(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => (node.children.length > 0 ? [node.id, ...withChildren(node.children)] : []));
}

export function Tree({ name, nodes }: { name: string; nodes: TreeNode[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(withChildren(nodes)));
  const [focusId, setFocusId] = useState(() => ids(nodes)[0] ?? "");
  const all = new Set(ids(nodes));
  const stop = all.has(focusId) ? focusId : (ids(nodes)[0] ?? "");

  const items = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const focusItem = (element: HTMLElement | undefined): void => {
    if (!element) return;
    setFocusId(element.dataset.id ?? "");
    element.focus();
  };
  const toggle = (id: string, to?: boolean): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (to ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!target) return;
    const list = items(event.currentTarget);
    const at = list.indexOf(target);
    const expandable = target.hasAttribute("aria-expanded");
    const expanded = target.getAttribute("aria-expanded") === "true";
    const id = target.dataset.id ?? "";
    if (event.key === "ArrowDown") focusItem(list[at + 1]);
    else if (event.key === "ArrowUp") focusItem(list[at - 1]);
    else if (event.key === "Home") focusItem(list[0]);
    else if (event.key === "End") focusItem(list[list.length - 1]);
    else if (event.key === "ArrowRight") {
      if (expandable && !expanded) toggle(id, true);
      else if (expandable) focusItem(list[at + 1]);
    } else if (event.key === "ArrowLeft") {
      if (expandable && expanded) toggle(id, false);
      else focusItem(target.closest('[role="group"]')?.parentElement?.querySelector<HTMLElement>(':scope > [role="treeitem"]') ?? undefined);
    } else return;
    event.preventDefault();
  };

  const render = (node: TreeNode): ReactNode => {
    const expandable = node.children.length > 0;
    const expanded = open.has(node.id);
    return (
      <li key={node.id} role="none">
        <div
          role="treeitem" className="tree-row" data-id={node.id} data-state={expandable ? (expanded ? "open" : "closed") : "leaf"}
          aria-label={node.label} aria-expanded={expandable ? expanded : undefined} tabIndex={stop === node.id ? 0 : -1}
          onFocus={(event) => { if (event.target === event.currentTarget) setFocusId(node.id); }}
          onClick={() => (expandable ? toggle(node.id) : undefined)}
        >
          {node.content}
        </div>
        {expandable && expanded ? <ul role="group" className="tree-group">{node.children.map(render)}</ul> : null}
      </li>
    );
  };

  return <ul role="tree" aria-label={name} className="tree" onKeyDown={onKeyDown}>{nodes.map(render)}</ul>;
}
