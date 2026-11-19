export function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function must<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
}

export function all<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** The one live region: each announcement replaces the last. */
export function announce(text: string): void {
  must<HTMLElement>(document, "#site-status").textContent = text;
}

/** Top of an element in document coordinates, ignoring any transform it is animating. */
export function layoutTop(element: HTMLElement): number {
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
  return top;
}

export function newSubmissionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Replaces one query parameter of the address without a history entry, keeping the others and the hash. */
export function setParam(name: string, value: string | null): void {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  history.replaceState(history.state, "", url);
}

export function setHash(id: string | null): void {
  const url = new URL(location.href);
  url.hash = id === null ? "" : id;
  history.replaceState(history.state, "", url);
}

export const EASE_OUT = "cubic-bezier(0.2, 0.7, 0.2, 1)";
export const EASE_CARRY = "cubic-bezier(0.16, 1, 0.3, 1)";
