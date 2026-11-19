type Attrs = Record<string, string | number | boolean | null | undefined>;

/** el builds one element with its attributes and children. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
};

/** svg builds one SVG element tree from a markup string. */
export const svg = (markup: string, label: string | null, cls: string): SVGSVGElement => {
  const holder = document.createElement("div");
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" class="${cls}" preserveAspectRatio="xMidYMid slice">${markup}</svg>`;
  const node = holder.firstElementChild as SVGSVGElement;
  if (label === null) {
    node.setAttribute("aria-hidden", "true");
  } else {
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", label);
  }
  return node;
};

/** clear empties an element before a repaint. */
export const clear = (node: Element): void => {
  while (node.firstChild) node.firstChild.remove();
};

/** field builds a labelled form field with its error line beneath it. */
export const field = (
  label: string,
  input: HTMLElement,
  errorID: string,
): HTMLElement =>
  el("label", { class: "field" }, [
    el("span", { class: "field-label", text: label }),
    input,
    el("p", { class: "field-error", id: errorID }),
  ]);

/** setFieldError marks a field invalid and points it at its message. */
export const setFieldError = (input: HTMLElement, errorID: string, message: string): void => {
  const line = document.getElementById(errorID);
  if (line) line.textContent = message;
  if (message) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", errorID);
  } else {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
};

/** reducedMotion reports whether the device asks for reduced motion. */
export const reducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** columns is the number of tile columns the current layout shows. */
export const columns = (): number => {
  if (window.matchMedia("(min-width: 1200px)").matches) return 3;
  if (window.matchMedia("(min-width: 768px)").matches) return 2;
  return 1;
};

/** isWide reports whether the wide split-poster layout is in use. */
export const isWide = (): boolean => window.matchMedia("(min-width: 1200px)").matches;

/** trapFocus keeps Tab inside a dialog and closes it on Escape. */
export const trapFocus = (
  dialog: HTMLElement,
  stops: HTMLElement[],
  close: () => void,
): (event: KeyboardEvent) => void => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const at = active ? stops.indexOf(active) : -1;
    const step = event.shiftKey ? -1 : 1;
    const next = (at + step + stops.length) % stops.length;
    stops[next < 0 ? stops.length - 1 : next].focus();
  };
  dialog.addEventListener("keydown", onKeyDown);
  return onKeyDown;
};
