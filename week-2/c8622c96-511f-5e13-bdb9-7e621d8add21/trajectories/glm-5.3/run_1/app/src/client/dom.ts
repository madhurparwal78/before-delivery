// DOM helpers without any framework: element creation with attributes and
// children, focus management and live regions.
export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") node.className = String(value);
    else if (name === "text") node.textContent = String(value);
    else if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === "string") node.append(document.createTextNode(child));
    else node.append(child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setStatus(id: string, text: string, tone?: "normal" | "ok" | "warn"): void {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone ?? "normal";
  // Re-announce for screen readers when the text changes.
  node.setAttribute("aria-live", "polite");
}

export function money(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export function dollarsPlain(minor: number): string {
  const abs = Math.abs(minor);
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function percent(bp: number): string {
  return `${Math.floor(Math.abs(bp) / 100)}.${String(Math.abs(bp) % 100).padStart(2, "0")}`;
}

export function monthName(month: string): string {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
}

export function escapeKeyHandler(fn: () => void): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key === "Escape") fn();
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const SECTION_ROUTES: Record<string, string[]> = {
  contributor: ["/sheet", "/studio", "/royalties"],
  picture_editor: ["/sheet", "/shortlist", "/licences", "/following"],
  licensing_manager: ["/licences", "/usage"],
  desk_editor: ["/sheet", "/review-queue", "/all-essays"],
  treasurer: ["/rates", "/statements"],
};

export const SECTION_LABELS: Record<string, string> = {
  "/sheet": "Contact sheet",
  "/studio": "Studio",
  "/royalties": "Royalties",
  "/shortlist": "Shortlist",
  "/licences": "Licences",
  "/following": "Following",
  "/usage": "Usage",
  "/review-queue": "Review queue",
  "/all-essays": "All essays",
  "/rates": "Rates",
  "/statements": "Statements",
};
