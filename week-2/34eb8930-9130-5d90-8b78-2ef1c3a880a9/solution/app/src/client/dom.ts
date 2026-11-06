type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | null | undefined | false;

/** Element builder: attributes, `on*` listeners and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** A textarea that grows with its text instead of offering a resize grip. */
export function autoGrow(box: HTMLTextAreaElement): HTMLTextAreaElement {
  box.addEventListener("input", () => {
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight + 2}px`;
  });
  return box;
}

export function svgIcon(paths: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "icon");
  svg.innerHTML = paths;
  return svg;
}

/** Lucide icon paths (ISC licence), inlined. */
export const ICONS = {
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  checks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  cards: '<path d="M7 8h10"/><path d="M7 12h6"/><path d="M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>',
} as const;

/** The quill-and-sheet line drawing for empty and end states (original). */
export function quillMark(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 96 72");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "quill-mark");
  svg.innerHTML = '<rect x="10" y="10" width="46" height="56" rx="2" fill="#FCFAF5" stroke="#5A5248" stroke-width="1.5"/>'
    + '<path d="M18 24h30M18 31h26M18 38h30M18 45h18" stroke="#5A5248" stroke-width="1.2" stroke-linecap="round" opacity=".6"/>'
    + '<path d="M44 56c10-4 22-18 38-46-14 6-26 16-34 30l-4 16z" fill="#E4DDD0" stroke="#1F5A48" stroke-width="1.6" stroke-linejoin="round"/>'
    + '<path d="M46 52c6-10 14-20 26-30" stroke="#1F5A48" stroke-width="1.2" stroke-linecap="round"/>';
  return svg;
}

export function formatWhen(isoTime: string): string {
  return new Date(isoTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
