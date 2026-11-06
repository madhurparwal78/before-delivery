import type { PointerEvent as ReactPointerEvent } from "react";
import { canReceive, locateOnPage, takesChildren } from "../../shared/tree.js";
import type { NodeType, WorkspaceDoc } from "../../shared/types.js";
import type { Dragged, DragState, EditorActions, Slot } from "./context.js";

const THRESHOLD = 4;

function draggedType(doc: WorkspaceDoc, dragged: Dragged): NodeType | null {
  if (dragged.kind === "type") return dragged.type;
  if (dragged.kind === "component") return doc.components.find((c) => c.id === dragged.componentId)?.root.type ?? null;
  return locateOnPage(doc, dragged.nodeId)?.node.type ?? null;
}

function horizontal(element: Element): boolean {
  const style = getComputedStyle(element);
  return style.display.includes("flex") && style.flexDirection.startsWith("row");
}

/** The slot a pointer at (x, y) would drop into, and where the indicator line goes. */
function slotAt(doc: WorkspaceDoc, pageId: string, dragged: Dragged, x: number, y: number): Pick<DragState, "slot" | "box"> {
  const none = { slot: null, box: null };
  const type = draggedType(doc, dragged);
  if (!type) return none;
  const hit = document.elementFromPoint(x, y);
  const row = hit?.closest<HTMLElement>('[role="tree"] [data-row-id]');
  const element = row ?? hit?.closest<HTMLElement>("#canvas [data-frame] [data-node-id]") ?? null;
  const frame = hit?.closest<HTMLElement>("#canvas [data-frame]");
  const id = element ? (element.getAttribute("data-row-id") ?? element.getAttribute("data-node-id")) : frame ? frame.querySelector("[data-node-id]")?.getAttribute("data-node-id") : null;
  if (!id) return none;
  let found = locateOnPage(doc, id);
  if (!found || found.owner.page.id !== pageId) return none;
  const box = (element ?? frame)?.getBoundingClientRect();
  if (!box) return none;
  const across = element && !row && found.parent ? horizontal(element.parentElement ?? element) : false;
  const ratio = across ? (x - box.left) / Math.max(1, box.width) : (y - box.top) / Math.max(1, box.height);
  const line = (edge: "before" | "after", rect: DOMRect) => ({ left: rect.left, top: edge === "before" ? rect.top : rect.bottom, width: rect.width });

  const container = takesChildren(found.node.type) && canReceive(found.node.type, type);
  const edge = !found.parent ? false : row ? ratio < 0.25 || ratio > 0.75 : ratio < 0.15 || ratio > 0.85;
  let slot: Slot | null = null;
  let indicator = line("after", box);
  if (container && (!edge || !found.parent)) {
    if (row) {
      slot = { parentId: found.node.id, index: found.node.children.length };
    } else {
      const children = [...(element ?? frame)!.querySelectorAll<HTMLElement>(":scope > [data-node-id]")];
      const flow = element && horizontal(element);
      let index = children.length;
      for (let i = 0; i < children.length; i += 1) {
        const r = children[i].getBoundingClientRect();
        if ((flow ? x < r.left + r.width / 2 : y < r.top + r.height / 2)) {
          index = i;
          break;
        }
      }
      slot = { parentId: found.node.id, index };
      const ref = children[index] ?? children[children.length - 1];
      indicator = ref ? line(children[index] ? "before" : "after", ref.getBoundingClientRect()) : line("before", box);
    }
  } else {
    let after = ratio >= 0.5;
    while (found && found.parent && !canReceive(found.parent.type, type)) {
      const parent = locateOnPage(doc, found.parent.id);
      if (!parent) break;
      found = parent;
      after = true;
    }
    if (!found || !found.parent) return none;
    slot = { parentId: found.parent.id, index: found.index + (after ? 1 : 0) };
    indicator = line(after ? "after" : "before", box);
  }
  if (dragged.kind === "node") {
    const moving = locateOnPage(doc, dragged.nodeId);
    if (moving?.parent?.id === slot.parentId && moving.index < slot.index) slot = { ...slot, index: slot.index - 1 };
  }
  return { slot, box: indicator };
}

/** Begin a pointer drag; a press without movement stays a click. */
export function startDrag(event: ReactPointerEvent, dragged: Dragged, act: Pick<EditorActions, "setDrag" | "drop">): void {
  if (event.button !== 0 || event.pointerType === "touch") return;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let last: Pick<DragState, "slot" | "box"> = { slot: null, box: null };
  const read = editorContext;
  const move = (e: PointerEvent) => {
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
    dragging = true;
    last = slotAt(read.doc(), read.pageId(), dragged, e.clientX, e.clientY);
    act.setDrag({ dragged, ...last });
  };
  const up = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!dragging) return;
    last = slotAt(read.doc(), read.pageId(), dragged, e.clientX, e.clientY);
    act.setDrag(null);
    const swallow = (c: Event) => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (last.slot) act.drop(dragged, last.slot);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** The editor registers how the drag reads the live document and page. */
export const editorContext: { doc: () => WorkspaceDoc; pageId: () => string } = {
  doc: () => {
    throw new Error("editor not mounted");
  },
  pageId: () => "",
};
