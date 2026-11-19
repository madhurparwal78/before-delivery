import { navigate } from "../lib/router";
import type { OutlineController } from "./controller";

/** The screen rectangle a zoom starts from, read before the view changes. */
export const zoomOrigin: { rect: DOMRect | null } = { rect: null };

function rowTextRect(key: string): DOMRect | null {
  const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const row = rows.find((candidate) => candidate.dataset.key === key);
  return row?.querySelector(".cell")?.getBoundingClientRect() ?? null;
}

export function zoomInto(controller: OutlineController, key: string, id: string): void {
  controller.flushAll();
  zoomOrigin.rect = rowTextRect(key);
  navigate(`/b/${encodeURIComponent(controller.resolve(id))}`);
}

/** Where "zoom out" leads from the current view, or null when the view is already at its top. */
function parentPath(controller: OutlineController): string | null {
  const { root } = controller.state.view;
  if (root === null) return null;
  if (root.parentId !== null) return `/b/${encodeURIComponent(root.parentId)}`;
  const top = controller.shareTop();
  return top === null ? "/" : top === root.id ? null : `/b/${encodeURIComponent(top)}`;
}

export function zoomOut(controller: OutlineController): void {
  const path = parentPath(controller);
  if (path === null) return;
  controller.flushAll();
  zoomOrigin.rect = document.querySelector<HTMLElement>("[data-title]")?.getBoundingClientRect() ?? null;
  navigate(path);
}

export function homePath(controller: OutlineController): string {
  const top = controller.shareTop();
  return top === null ? "/" : `/b/${encodeURIComponent(top)}`;
}
