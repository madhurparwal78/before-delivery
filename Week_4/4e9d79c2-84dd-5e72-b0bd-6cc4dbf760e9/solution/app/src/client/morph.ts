// A refresh changes only what changed, in place: same elements, same focus, same open things, same typed text.
const ALWAYS_KEEP = new Set(["aria-invalid", "aria-describedby", "aria-expanded", "aria-activedescendant", "aria-controls", "data-dirty", "data-pending"]);

const keyOf = (node: Element): string | null => {
  const key = node.getAttribute("data-key");
  if (key) return key;
  const id = node.id;
  return id && !/^f\d+/.test(id) ? id : null;
};
const skip = (element: Element): boolean =>
  element.hasAttribute("data-client-owned") || element.hasAttribute("data-pending")
  || (element.classList.contains("dialog") && !element.hasAttribute("hidden"))
  || element.hasAttribute("data-local-dirty");

const syncAttributes = (current: Element, next: Element): void => {
  const clientAttrs = new Set((current.getAttribute("data-client-attrs") ?? "").split(/\s+/).filter(Boolean));
  for (const { name } of [...current.attributes]) {
    if (!next.hasAttribute(name) && !ALWAYS_KEEP.has(name) && !clientAttrs.has(name)) current.removeAttribute(name);
  }
  for (const { name, value } of [...next.attributes]) {
    if (clientAttrs.has(name)) continue;
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
};
const syncValue = (current: Element, next: Element): void => {
  if (current instanceof HTMLInputElement) {
    if (current.dataset.dirty) return;
    if (current.type === "radio" || current.type === "checkbox") {
      if (current.type === "radio") current.checked = next.hasAttribute("checked");
    } else if (current.type !== "file") current.value = next.getAttribute("value") ?? "";
  } else if (current instanceof HTMLTextAreaElement) {
    if (!current.dataset.dirty) current.value = next.textContent ?? "";
  } else if (current instanceof HTMLSelectElement) {
    if (current.dataset.dirty) return;
    const chosen = (next as HTMLSelectElement).querySelector("option[selected]");
    current.value = chosen ? chosen.getAttribute("value") ?? "" : (next as HTMLSelectElement).querySelector("option")?.getAttribute("value") ?? "";
  }
};

const morphElement = (current: Element, next: Element): void => {
  if (skip(current)) return;
  syncAttributes(current, next);
  if (current.tagName === "SELECT") {
    const value = (current as HTMLSelectElement).value;
    morphChildren(current, next);
    if ((current as HTMLSelectElement).dataset.dirty) (current as HTMLSelectElement).value = value;
    syncValue(current, next);
    return;
  }
  if (current.tagName === "TEXTAREA" || current.tagName === "INPUT") {
    syncValue(current, next);
    return;
  }
  morphChildren(current, next);
};

const morphChildren = (current: Element, next: Element): void => {
  const existing = [...current.childNodes];
  const keyed = new Map<string, Element>();
  for (const child of existing) if (child instanceof Element) { const key = keyOf(child); if (key) keyed.set(key, child); }
  const used = new Set<Node>();
  let cursor = 0;
  const takeUnkeyed = (node: Node): Node | null => {
    for (let i = cursor; i < existing.length; i += 1) {
      const candidate = existing[i];
      if (used.has(candidate)) continue;
      if (candidate.nodeType !== node.nodeType) continue;
      if (candidate instanceof Element) {
        if (keyOf(candidate) || candidate.tagName !== (node as Element).tagName) continue;
      }
      return candidate;
    }
    return null;
  };
  const ordered: Node[] = [];
  for (const node of [...next.childNodes]) {
    const key = node instanceof Element ? keyOf(node) : null;
    const match = key ? keyed.get(key) ?? null : takeUnkeyed(node);
    if (match) {
      used.add(match);
      if (match instanceof Element) morphElement(match, node as Element);
      else if (match.textContent !== node.textContent) match.textContent = node.textContent;
      ordered.push(match);
      if (existing[cursor] === match) cursor += 1;
    } else ordered.push(document.importNode(node, true));
  }
  // Nodes only the page owns stay where they are, ahead of the server's order.
  for (const child of existing) {
    if (used.has(child)) continue;
    if (child instanceof Element && child.hasAttribute("data-client-owned")) continue;
    child.remove();
  }
  let pointer: ChildNode | null = current.firstChild;
  for (const node of ordered) {
    while (pointer instanceof Element && pointer.hasAttribute("data-client-owned") && !used.has(pointer)) pointer = pointer.nextSibling;
    if (node === pointer) pointer = pointer.nextSibling;
    else current.insertBefore(node, pointer);
  }
};

/** Swaps in a freshly read page's screen without disturbing focus. */
export const morphPage = (parsed: Document): void => {
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.closest("[data-key]")?.getAttribute("data-key") ?? null;
  const focusIsKeyed = active?.getAttribute("data-key") === focusKey;
  const app = document.getElementById("app");
  const overlays = document.getElementById("overlays");
  const nextApp = parsed.getElementById("app");
  const nextOverlays = parsed.getElementById("overlays");
  if (app && nextApp) morphChildren(app, nextApp);
  if (overlays && nextOverlays) morphChildren(overlays, nextOverlays);
  if (document.title !== parsed.title) document.title = parsed.title;
  if (active && active !== document.body && !active.isConnected && focusKey) {
    const same = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`);
    (focusIsKeyed ? same : same?.querySelector<HTMLElement>("button,a,input,select,[tabindex]") ?? same)?.focus({ preventScroll: true });
  } else if (active && active !== document.activeElement && active.isConnected) active.focus({ preventScroll: true });
};
