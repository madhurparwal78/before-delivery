// History-API routing: every published route is a real address that survives reload and Back/Forward.
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { feedback, store, useStore } from "./store";

interface Place {
  path: string;
  search: string;
}

const read = (): Place => ({ path: location.pathname, search: location.search });
const place = store<Place>(read());

/** Set when the screen changes, so the new screen's level-1 heading takes focus once it is shown. */
let arriving = false;

window.addEventListener("popstate", () => {
  arriving = true;
  place.set(read());
});

interface Go {
  replace?: boolean;
  /** Keep the action's message on the screen the action lands on. */
  keepFeedback?: boolean;
}

export function navigate(to: string, go: Go = {}): void {
  if (go.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  if (!go.keepFeedback) feedback.set(null);
  arriving = true;
  place.set(read());
}

export function usePlace(): Place {
  return useStore(place);
}

type LinkProps = JSX.HTMLAttributes<HTMLAnchorElement> & { href: string; children: ComponentChildren };

export function Link({ href, onClick, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    />
  );
}

/** The screen's level-1 heading: it takes focus when the screen was reached by a screen change. */
export function Heading({ children, class: className }: { children: ComponentChildren; class?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (arriving && ref.current) {
      arriving = false;
      ref.current.focus({ preventScroll: false });
    }
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} class={className}>
      {children}
    </h1>
  );
}
