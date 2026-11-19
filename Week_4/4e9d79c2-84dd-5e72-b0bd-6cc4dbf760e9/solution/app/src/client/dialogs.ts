// Dialogs, sheets and panels: browser-timed opening and closing, one focus trap, and Escape for the innermost only.
import { $, $$, focusHeading } from "./core.js";

const stack: { element: HTMLElement; opener: HTMLElement | null }[] = [];
const closing = new WeakMap<HTMLElement, number>();
let token = 0;

const appRoot = (): HTMLElement | null => document.getElementById("app");
const scrim = (): HTMLElement | null => document.getElementById("scrim");

const focusables = (root: HTMLElement): HTMLElement[] =>
  $$<HTMLElement>('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])', root)
    .filter((e) => !(e as HTMLInputElement).disabled && (e as HTMLInputElement).type !== "hidden" && e.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions) && !e.closest("[hidden],[inert]") && e.tabIndex >= 0);

const focusInside = (element: HTMLElement): void => {
  const wanted = $<HTMLElement>("[data-autofocus]", element);
  const list = focusables(element);
  const field = list.find((e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName));
  const target = wanted ?? field ?? list.find((e) => !e.hasAttribute("data-close")) ?? list[0] ?? element;
  if (target === element) element.tabIndex = -1;
  target.focus();
};

export const isOpen = (element: HTMLElement): boolean => stack.some((s) => s.element === element);
export const topDialog = (): HTMLElement | null => stack[stack.length - 1]?.element ?? null;

/** Whatever is moving turns back along its own path, so an interrupted dialog or sheet carries on from where it stands. */
const turnBack = (element: HTMLElement, change: () => void): void => {
  const kept = element.getAnimations().filter((a) => a.currentTime).map((a) => {
    const effect = a.effect as KeyframeEffect;
    const copy = element.animate(effect.getKeyframes(), { ...effect.getTiming(), fill: "none" });
    copy.currentTime = a.currentTime;
    copy.playbackRate = a.playbackRate;
    return copy;
  });
  change();
  if (!kept.length) return;
  void getComputedStyle(element).transform;
  for (const a of element.getAnimations()) if (!kept.includes(a)) a.cancel();
  for (const copy of kept) copy.reverse();
};

export const openDialog = (element: HTMLElement, opener: HTMLElement | null): void => {
  if (isOpen(element)) return;
  closing.delete(element);
  element.hidden = false;
  element.inert = false;
  stack.push({ element, opener });
  const curtain = scrim();
  if (curtain) {
    curtain.hidden = false;
    void curtain.offsetWidth;
    curtain.classList.add("is-open");
  }
  const app = appRoot();
  if (app) app.inert = true;
  void getComputedStyle(element).transform;
  turnBack(element, () => element.classList.add("is-open"));
  focusInside(element);
};

const finishClosing = (element: HTMLElement, mine: number): void => {
  if (closing.get(element) !== mine) return;
  closing.delete(element);
  element.hidden = true;
  element.inert = false;
};
const afterMotion = (element: HTMLElement, done: () => void): void => {
  void getComputedStyle(element).opacity;
  const moving = element.getAnimations();
  if (!moving.length) return done();
  void Promise.allSettled(moving.map((a) => a.finished)).then(done);
};

export const closeDialog = (element: HTMLElement, restoreFocus = true): void => {
  const index = stack.findIndex((s) => s.element === element);
  if (index < 0) return;
  const [{ opener }] = stack.splice(index, 1);
  const mine = (token += 1);
  closing.set(element, mine);
  element.inert = true;
  turnBack(element, () => element.classList.remove("is-open"));
  if (!stack.length) {
    const app = appRoot();
    if (app) app.inert = false;
    const curtain = scrim();
    if (curtain) {
      curtain.classList.remove("is-open");
      afterMotion(curtain, () => { if (!stack.length) curtain.hidden = true; });
    }
  }
  if (restoreFocus) (opener?.isConnected ? opener : null)?.focus();
  if (restoreFocus && !opener?.isConnected) focusHeading();
  afterMotion(element, () => finishClosing(element, mine));
};
export const closeAll = (): void => {
  for (const { element } of [...stack]) closeDialog(element, false);
};

/** What the action closed: back to its opener, or the level-one heading if that control has gone. */
const openerOf = (element: HTMLElement): HTMLElement | null => stack.find((s) => s.element === element)?.opener ?? null;

const openFrom = (button: HTMLElement): void => {
  const target = document.getElementById(button.dataset.dialogOpen ?? "");
  if (!target) return;
  const form = $<HTMLFormElement>("form", target);
  if (button.dataset.formApi && form) form.dataset.api = button.dataset.formApi;
  if (button.dataset.fill && form) {
    const values = JSON.parse(button.dataset.fill) as Record<string, string>;
    for (const [name, value] of Object.entries(values)) {
      const field = form.elements.namedItem(name) as HTMLInputElement | null;
      if (field) { field.value = value; delete field.dataset.dirty; }
    }
  }
  if (button.dataset.history) {
    const list = $("[data-history-list]", target);
    if (list) list.replaceChildren(...(JSON.parse(button.dataset.history) as string[]).map((line) => { const li = document.createElement("li"); li.textContent = line; return li; }));
  }
  const parent = button.closest<HTMLElement>(".dialog");
  let opener: HTMLElement | null = button;
  if (parent && isOpen(parent)) {
    opener = openerOf(parent);
    closeDialog(parent, false);
  }
  openDialog(target, opener);
};

export const initDialogs = (): void => {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const opener = target.closest<HTMLElement>("[data-dialog-open]");
    if (opener && !opener.hasAttribute("aria-disabled")) return openFrom(opener);
    const close = target.closest<HTMLElement>("[data-close]");
    if (close) {
      const dialog = close.closest<HTMLElement>(".dialog");
      if (dialog) closeDialog(dialog);
      return;
    }
    if (target.id === "scrim") {
      const top = topDialog();
      if (top && top.dataset.kind !== "dialog") closeDialog(top);
    }
  });
  document.addEventListener("keydown", (event) => {
    const top = topDialog();
    if (!top) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog(top);
    } else if (event.key === "Tab") {
      const list = focusables(top);
      if (!list.length) { event.preventDefault(); return; }
      const at = list.indexOf(document.activeElement as HTMLElement);
      let next = at + (event.shiftKey ? -1 : 1);
      if (next < 0) next = list.length - 1;
      if (next >= list.length) next = 0;
      event.preventDefault();
      list[next].focus();
    }
  });
};
