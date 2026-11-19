import { useSyncExternalStore, type ComponentProps, type MouseEvent } from "react";

const listeners = new Set<() => void>();
let flash: string | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", notify);

export function navigate(to: string, options: { replace?: boolean; flash?: string } = {}): void {
  flash = options.flash ?? null;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  notify();
}

export function replaceQuery(query: URLSearchParams): void {
  const search = query.toString();
  history.replaceState(null, "", `${location.pathname}${search === "" ? "" : `?${search}`}`);
}

export function takeFlash(): string | null {
  const message = flash;
  flash = null;
  return message;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function Link({ to, onClick, ...rest }: { to: string } & ComponentProps<"a">): React.JSX.Element {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target === "_blank") return;
    event.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={follow} />;
}
