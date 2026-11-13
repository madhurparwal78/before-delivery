type Child = Node | string | null | undefined | false;
type Attributes = Record<string, string | number | boolean | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    element.setAttribute(name, value === true ? "" : String(value));
  }
  element.append(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
  return element;
}

/** Parses drawn-in-code SVG markup (already escaped) into an element. */
export function drawing(markup: string): SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  const svg = template.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error("drawing markup must start with an svg element");
  return svg;
}

/** Wraps every digit in a fixed-width span so figures line up in columns whatever the font. */
export function figures(value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const character of value) {
    if (/\d/.test(character)) fragment.append(h("span", { class: "digit" }, character));
    else fragment.append(character);
  }
  return fragment;
}

export function find<T extends Element>(root: ParentNode, selector: string, kind: abstract new () => T): T {
  const found = root.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`missing ${selector}`);
  return found;
}
