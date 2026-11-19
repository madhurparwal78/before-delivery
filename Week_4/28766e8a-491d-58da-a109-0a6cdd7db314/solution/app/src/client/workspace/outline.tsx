// The Diagram outline tree (brief: Outline tree): pages, visible layers, shapes and groups in
// reading order, then connectors; the standard tree keys; Enter selects and focuses a shape.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy, shapeLabel } from "../../shared/copy";
import { readingOrder, visibleLayerIds } from "../../shared/geometry";
import { isBlocked, isShown } from "../../shared/router";
import type { Page, Shape } from "../../shared/types";
import { Dialog } from "../dialog";
import { guardLocked, select, withGroup } from "./commands";
import type { WorkspaceStore } from "./store";

interface Node {
  id: string;
  text: string;
  children: Node[];
  shape?: { page: string; id: string };
}

function bySort(a: { y: number; x: number; id: string }, b: { y: number; x: number; id: string }) {
  return a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);
}

function pageNode(page: Page): Node {
  const visible = visibleLayerIds(page);
  const shapes = page.shapes.filter((s) => visible.has(s.layer));
  const byId = new Map(page.shapes.map((s) => [s.id, s]));
  const connectors = page.connectors.filter((c) => isShown(page, c, visible, byId));
  const order = readingOrder(shapes);
  const rank = new Map(order.map((s, i) => [s.id, i]));
  const labelsOf = (ids: string[]) => [...new Set(ids)].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)).map((id) => shapeLabel(byId.get(id) as Shape));
  const shapeNode = (s: Shape): Node => ({
    id: `shape-${s.id}`,
    text: copy.outlineShape(shapeLabel(s), s.kind, labelsOf(connectors.filter((c) => c.from.shape === s.id).map((c) => c.to.shape)),
      labelsOf(connectors.filter((c) => c.to.shape === s.id).map((c) => c.from.shape))),
    children: [],
    shape: { page: page.id, id: s.id },
  });
  const layers = [...page.layers].filter((l) => l.visible).sort((a, b) => b.order - a.order).map((l): Node => {
    const own = shapes.filter((s) => s.layer === l.id);
    const items: { y: number; x: number; id: string; node: Node }[] = [];
    for (const s of own.filter((x) => !x.group)) items.push({ y: s.y, x: s.x, id: s.id, node: shapeNode(s) });
    for (const g of page.groups) {
      const members = own.filter((s) => s.group === g.id);
      if (!members.length) continue;
      items.push({
        y: Math.min(...members.map((m) => m.y)), x: Math.min(...members.map((m) => m.x)), id: g.id,
        node: { id: `group-${g.id}`, text: copy.groupName(members.length), children: readingOrder(members).map(shapeNode) },
      });
    }
    const conns = connectors.filter((c) => c.layer === l.id).sort((a, b) =>
      (rank.get(a.from.shape) ?? 0) - (rank.get(b.from.shape) ?? 0) || (rank.get(a.to.shape) ?? 0) - (rank.get(b.to.shape) ?? 0) || (a.id < b.id ? -1 : 1));
    return {
      id: `layer-${l.id}`,
      text: copy.outlineLayer(l.name, l.locked, page.shapes.filter((s) => s.layer === l.id).length),
      children: [
        ...items.sort(bySort).map((i) => i.node),
        ...conns.map((c) => ({
          id: `connector-${c.id}`,
          text: copy.connectorName(shapeLabel(byId.get(c.from.shape) as Shape), shapeLabel(byId.get(c.to.shape) as Shape), isBlocked(page, c, c.route)),
          children: [],
        })),
      ],
    };
  });
  return { id: `page-${page.id}`, text: copy.outlinePage(page.name, shapes.length, connectors.length), children: layers };
}

export function OutlinePanel({ store, opener, onClose }: { store: WorkspaceStore; opener: HTMLElement | null; onClose: () => void }) {
  const doc = store.doc;
  const tree = useRef<HTMLUListElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set((doc?.pages ?? []).filter((p) => p.id !== store.page?.id).map((p) => `page-${p.id}`)));
  const [active, setActive] = useState<string | null>(null);
  const roots = [...(doc?.pages ?? [])].sort((a, b) => a.order - b.order).map(pageNode);
  const visibleNodes: { node: Node; parent: Node | null; level: number }[] = [];
  const walk = (nodes: Node[], parent: Node | null, level: number) => {
    for (const node of nodes) {
      visibleNodes.push({ node, parent, level });
      if (node.children.length && !collapsed.has(node.id)) walk(node.children, node, level + 1);
    }
  };
  walk(roots, null, 1);
  const current = visibleNodes.find((v) => v.node.id === active) ?? visibleNodes[0];

  useLayoutEffect(() => {
    if (!current) return;
    const el = tree.current?.querySelector<HTMLElement>(`[data-node="${current.node.id}"]`);
    if (el && tree.current?.contains(document.activeElement)) el.focus();
  }, [active, collapsed]);
  useLayoutEffect(() => {
    tree.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, []);

  const focusNode = (id: string) => setActive(id);
  const onKey = (e: KeyboardEvent) => {
    if (!current) return;
    const index = visibleNodes.indexOf(current);
    const { node, parent } = current;
    const expandable = node.children.length > 0;
    let handled = true;
    if (e.key === "ArrowDown") focusNode(visibleNodes[Math.min(visibleNodes.length - 1, index + 1)]?.node.id ?? node.id);
    else if (e.key === "ArrowUp") focusNode(visibleNodes[Math.max(0, index - 1)]?.node.id ?? node.id);
    else if (e.key === "Home") focusNode(visibleNodes[0]?.node.id ?? node.id);
    else if (e.key === "End") focusNode(visibleNodes[visibleNodes.length - 1]?.node.id ?? node.id);
    else if (e.key === "ArrowRight") {
      if (expandable && collapsed.has(node.id)) setCollapsed(new Set([...collapsed].filter((id) => id !== node.id)));
      else if (expandable) focusNode(node.children[0]?.id ?? node.id);
    } else if (e.key === "ArrowLeft") {
      if (expandable && !collapsed.has(node.id)) setCollapsed(new Set([...collapsed, node.id]));
      else if (parent) focusNode(parent.id);
    } else if (e.key === "Enter" && node.shape) {
      const target = node.shape;
      const page = doc?.pages.find((p) => p.id === target.page);
      const shape = page?.shapes.find((s) => s.id === target.id);
      onClose();
      if (!page || !shape) return;
      store.setPage(page.id);
      store.focusId = shape.id;
      store.focusKey = `shape:${store.keyFor(shape.id)}`;
      if (guardLocked(page, shape)) select(store, withGroup(page, shape));
      store.emit();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <Dialog label="Outline" onClose={onClose} returnTo={opener} className="outline-panel" modal={false} initial='[role="treeitem"][tabindex="0"]'>
      <ul ref={tree} role="tree" aria-label="Diagram outline" class="tree" onKeyDown={onKey}>
        {roots.map((root) => <Item key={root.id} node={root} level={1} collapsed={collapsed} active={current?.node.id ?? null} onPick={focusNode} />)}
      </ul>
    </Dialog>
  );
}

function Item({ node, level, collapsed, active, onPick }: { node: Node; level: number; collapsed: Set<string>; active: string | null; onPick: (id: string) => void }) {
  const expandable = node.children.length > 0;
  const open = expandable && !collapsed.has(node.id);
  return (
    <li role="treeitem" aria-label={node.text} aria-level={level} aria-expanded={expandable ? open : undefined} data-node={node.id}
      tabIndex={node.id === active ? 0 : -1} class={`tree-item level-${level}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick(node.id);
      }}>
      <span class="tree-text" aria-hidden="true">{node.text}</span>
      {open && (
        <ul role="group">
          {node.children.map((child) => <Item key={child.id} node={child} level={level + 1} collapsed={collapsed} active={active} onPick={onPick} />)}
        </ul>
      )}
    </li>
  );
}
