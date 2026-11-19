// Small DOM helpers: every page builds real elements, one place per pattern.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | null> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

export function button(label: string, attrs: Record<string, string | boolean | null> = {}, onClick?: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el("button", attrs, label);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function link(href: string, label: string, attrs: Record<string, string | boolean | null> = {}): HTMLAnchorElement {
  const a = el("a", { href, ...attrs }, label);
  return a;
}

export function status(label: string): HTMLElement {
  return el("div", { class: "status", role: "status", "aria-label": label, tabindex: "-1" });
}

export function setStatus(node: HTMLElement, text: string): void {
  node.textContent = text;
}

export function alertBox(label: string, ...children: (Node | string)[]): HTMLElement {
  const node = el("div", { role: "alert", class: "alert", "aria-label": label });
  for (const child of children) {
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

export function heading(level: 1 | 2 | 3 | 4, text: string): HTMLHeadingElement {
  return el(`h${level}` as "h1", { text });
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function navigate(path: string, replace = false): void {
  if (replace) {
    history.replaceState(null, "", path);
  } else {
    history.pushState(null, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}
