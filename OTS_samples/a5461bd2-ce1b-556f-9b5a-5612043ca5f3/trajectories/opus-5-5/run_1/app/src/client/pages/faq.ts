import { moveFocus } from "../focus.js";
import type { MountedPage, PageContext } from "../router.js";
import { toggleDisclosure } from "./services.js";
import { parseFaqQuery } from "../../shared/routes.js";

export function mountFaq({ bootstrap, main, url }: PageContext): MountedPage {
  const buttons = [...main.querySelectorAll<HTMLElement>(".question button")];
  const listeners = new AbortController();
  main.addEventListener(
    "click",
    (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>(".question button") : null;
      if (button !== null) toggleDisclosure(button);
    },
    { signal: listeners.signal },
  );
  main.addEventListener(
    "keydown",
    (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      const index = buttons.indexOf(event.target);
      if (index === -1) return;
      const last = buttons.length - 1;
      const targets: Record<string, number> = {
        ArrowDown: index === last ? 0 : index + 1,
        ArrowUp: index === 0 ? last : index - 1,
        Home: 0,
        End: last,
      };
      const next = targets[event.key];
      if (next === undefined) return;
      event.preventDefault();
      moveFocus(buttons[next]);
    },
    { signal: listeners.signal },
  );
  const open = parseFaqQuery(url.searchParams, bootstrap.content);
  return {
    unmount: () => listeners.abort(),
    focus: open === null ? undefined : main.querySelector<HTMLElement>(`[data-question="${open}"]`),
  };
}
