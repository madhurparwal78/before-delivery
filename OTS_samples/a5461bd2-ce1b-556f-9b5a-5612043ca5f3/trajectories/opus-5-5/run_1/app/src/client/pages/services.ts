import { moveFocus } from "../focus.js";
import type { MountedPage, PageContext } from "../router.js";
import { renderServiceTabs } from "../../shared/render.js";

/** Toggles a disclosure button and the element it controls. */
export function toggleDisclosure(button: HTMLElement): void {
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  const controlled = document.getElementById(button.getAttribute("aria-controls") ?? "");
  if (controlled !== null) controlled.hidden = expanded;
}

export function mountServices({ bootstrap, main }: PageContext): MountedPage {
  const { content } = bootstrap;
  const body = main.querySelector<HTMLElement>(".services-body");
  if (body === null) throw new Error("Services markup missing");
  const tabs = (): HTMLElement[] => [...body.querySelectorAll<HTMLElement>('[role="tab"]')];

  const select = (id: string, focus: boolean): void => {
    const panel = document.createElement("div");
    panel.innerHTML = renderServiceTabs(content, id);
    body.querySelector('[role="tabpanel"]')?.replaceWith(...panel.querySelectorAll('[role="tabpanel"]'));
    for (const tab of tabs()) {
      const selected = tab.dataset.service === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    history.replaceState(null, "", `/services/${id}`);
    if (focus) moveFocus(tabs().find((t) => t.dataset.service === id) ?? null);
  };

  const listeners = new AbortController();
  body.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const tab = event.target.closest<HTMLElement>('[role="tab"]');
      if (tab !== null) {
        select(tab.dataset.service ?? "", false);
        return;
      }
      const step = event.target.closest<HTMLElement>(".process button");
      if (step !== null) toggleDisclosure(step);
    },
    { signal: listeners.signal },
  );
  body.addEventListener(
    "keydown",
    (event) => {
      if (!(event.target instanceof Element) || event.target.closest('[role="tab"]') === null) return;
      const ids = content.services.map((s) => s.id);
      const current = ids.indexOf((event.target as HTMLElement).dataset.service ?? "");
      const targets: Record<string, number> = {
        ArrowRight: (current + 1) % ids.length,
        ArrowLeft: (current - 1 + ids.length) % ids.length,
        Home: 0,
        End: ids.length - 1,
      };
      const next = targets[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(ids[next], true);
    },
    { signal: listeners.signal },
  );
  return { unmount: () => listeners.abort() };
}
