export type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el(tag: string, attributes: Attributes = {}, children: Array<Node | string> = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** A control that may send a change to the server, so it waits for the live socket. */
export function liveButton(label: string, attributes: Attributes = {}): HTMLButtonElement {
  const node = el("button", { type: "button", ...attributes }, [label]) as HTMLButtonElement;
  node.classList.add("live-action");
  return node;
}
