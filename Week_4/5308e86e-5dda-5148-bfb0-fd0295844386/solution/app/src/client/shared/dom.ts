/** Small DOM helpers. Text is always set as text, never as markup. */

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

export function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

export function clear(element: Element): void {
  element.replaceChildren();
}

export function svg(markup: string, className = "icon"): SVGElement {
  const template = document.createElement("template");
  template.innerHTML = `<svg class="${className}" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
  return template.content.firstElementChild as SVGElement;
}

export const ICONS = {
  speaker: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bin: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  download: '<path d="M12 4v10M7.5 10 12 14.5 16.5 10M5 19h14"/>',
} as const;

/** Keeps Tab inside `container` while it is open. */
export function trapTab(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusable = [...container.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
    (element) => element.getClientRects().length > 0,
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Shows `dialog` as a modal that keeps Tab inside and closes on Escape, and returns its closer.
 * Closing removes the dialog and returns focus to `opener` in the same task, so a control the user
 * focuses right after the close never has its focus taken back by a late `close` event.
 */
export function openModal(dialog: HTMLDialogElement, opener: HTMLElement | null, onClose: () => void = () => {}): (restoreFocus: boolean) => void {
  let closed = false;
  const close = (restoreFocus: boolean): void => {
    if (closed) return;
    closed = true;
    onClose();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (restoreFocus && opener?.isConnected) opener.focus();
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close(true);
  });
  dialog.addEventListener("close", () => close(document.activeElement === null || document.activeElement === document.body));
  dialog.addEventListener("keydown", (event) => trapTab(dialog, event));
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

/** Marks a button as pending without taking it out of the focus order: it ignores presses until `done` runs. */
export function pending(button: HTMLElement, pendingLabel: string, label?: HTMLElement): () => void {
  const target = label ?? button;
  const original = target.textContent ?? "";
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("data-pending", "");
  target.textContent = pendingLabel;
  return () => {
    button.removeAttribute("aria-disabled");
    button.removeAttribute("data-pending");
    target.textContent = original;
  };
}

export function isPending(button: HTMLElement): boolean {
  return button.getAttribute("aria-disabled") === "true";
}
