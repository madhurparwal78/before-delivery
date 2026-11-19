/** All closeness is measured from the pointer position, not the card's edges. */
export const SNAP_RADIUS = 24;

export function insideOutline(element: Element, x: number, y: number): boolean {
  const box = element.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** Inside the outline, or within the published snap radius of its edge. */
export function withinSnapRadius(element: Element, x: number, y: number): boolean {
  const box = element.getBoundingClientRect();
  const dx = Math.max(box.left - x, 0, x - box.right);
  const dy = Math.max(box.top - y, 0, y - box.bottom);
  return Math.hypot(dx, dy) <= SNAP_RADIUS;
}
