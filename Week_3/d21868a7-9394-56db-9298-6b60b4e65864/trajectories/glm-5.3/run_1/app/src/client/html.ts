// HTML helpers: everything the app renders goes through h() so no raw string
// concatenation builds DOM.
export type Child = Node | string | null | undefined | false | Child[];

export function h(tag: string, attrs?: Record<string, unknown> | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "dataset") Object.assign(el.dataset, v as Record<string, string>);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function text(s: string): Text {
  return document.createTextNode(s);
}

// three-decimal number split into decimal-aligned parts
export function dec(s: string): HTMLElement {
  const [int, frac = ""] = s.split(".");
  const span = h("span", { class: "dec" });
  span.append(
    h("span", { class: "int" }, int ?? "0"),
    h("span", { class: "dot" }, "."),
    h("span", { class: "frac" }, frac.padEnd(3, "0").slice(0, 3)),
  );
  return span;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setStatus(el: HTMLElement, message: string): void {
  clear(el);
  el.append(text(message));
}

// a live region with the named accessible role
export function statusRegion(name: string, id: string): HTMLElement {
  return h("div", { role: "status", id, class: "status", "aria-label": name });
}

export function group(name: string, ...children: Child[]): HTMLElement {
  return h("div", { role: "group", "aria-label": name }, children.length ? children : "");
}

export function icon(name: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("lucide");
  const defs: Record<string, string[]> = {
    search: ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'],
    check: ['<path d="M20 6 9 17l-5-5"/>'],
    "log-out": ['<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 16 21 21 21 16"/><polyline points="16 8 21 3 21 8"/><line x1="15" x2="21" y1="12" y2="12"/>'],
    alert: ['<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'],
    clock: ['<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'],
    archive: ['<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'],
    users: ['<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'],
    clipboard: ['<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'],
    gauge: ['<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'],
  };
  svg.innerHTML = (defs[name] ?? []).join("");
  return svg;
}

// the gate glyph: a headgate leaf standing in a channel. When filled, the
// cobalt copy is clipped from the bed up to the fill height.
export function gateGlyph(size = 46, filled = false): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("glyph");
  const strokes = `
    <rect x="2" y="19" width="20" height="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <rect x="2" y="2" width="2.5" height="17" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <rect x="19.5" y="2" width="2.5" height="17" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <line x1="4.5" y1="6.5" x2="19.5" y2="6.5" stroke="currentColor" stroke-width="1.4"/>
    <rect x="6.5" y="6.5" width="11" height="12.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <line x1="12" y1="2" x2="12" y2="6.5" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="12" cy="4.2" r="1.6" fill="currentColor"/>
  `;
  if (filled) {
    svg.innerHTML = `<g style="color: var(--cobalt);">${strokes}</g>`;
  } else {
    svg.innerHTML = strokes;
  }
  return svg;
}
