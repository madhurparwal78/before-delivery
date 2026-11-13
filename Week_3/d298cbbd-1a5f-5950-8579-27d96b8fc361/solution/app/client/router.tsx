import type { ComponentChildren, JSX } from "preact";
import { Store, useStore } from "./store";

interface Location {
  readonly path: string;
  readonly search: string;
}

function current(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

const location = new Store<Location>(current());

/** The page the typist was on before the current one, so sign-in can return to it. */
let cameFrom = "/";

export function previousPage(): string {
  return cameFrom;
}

export function navigate(to: string, replace = false): void {
  const target = new URL(to, window.location.href);
  const next = `${target.pathname}${target.search}`;
  if (next === `${window.location.pathname}${window.location.search}`) return;
  if (!replace) cameFrom = `${window.location.pathname}${window.location.search}`;
  if (replace) window.history.replaceState(null, "", next);
  else window.history.pushState(null, "", next);
  location.set(current());
}

window.addEventListener("popstate", () => location.set(current()));

export function useLocation(): Location {
  return useStore(location);
}

interface LinkProps {
  readonly href: string;
  readonly class?: string;
  readonly current?: boolean;
  readonly vars?: Readonly<Record<string, number>>;
  readonly children: ComponentChildren;
}

export function Link({ href, class: className, current, vars, children }: LinkProps): JSX.Element {
  return (
    <a
      href={href}
      class={className}
      style={vars}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
