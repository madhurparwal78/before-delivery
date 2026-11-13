// Small pieces the merge request panel and pages share.
//   <PanelSection title innerRef? focusable? class?>   a region named by its heading (`region "<title>"`); focusable adds tabIndex -1
//   <ActionNotice errors />                            the first API refusal in the status strip pattern (it was announced already)
//   useFocusRequest()                                  { ref(key), request(key) }: after the next render that has the keyed element,
//                                                      focus it (for controls that swap places after an action)
//   requestMrFocus(path, target) / takeMrFocus(path)   "after this navigation, focus the heading or the merge checks"
import type { ComponentChildren, Ref } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import type { ApiError } from "../../api.ts";
import { Notice } from "../../ui/index.ts";

export function PanelSection({
  title,
  children,
  innerRef,
  focusable = false,
  class: className,
}: {
  title: string;
  children?: ComponentChildren;
  innerRef?: Ref<HTMLElement>;
  focusable?: boolean;
  class?: string;
}) {
  const heading = useId();
  return (
    <section ref={innerRef} aria-labelledby={heading} tabIndex={focusable ? -1 : undefined} class={`sp-mrp${className ? ` ${className}` : ""}`}>
      <h2 id={heading} class="sp-mrp__title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ActionNotice({ errors }: { errors: ReadonlyArray<ApiError | null> }) {
  const shown = errors.find((error): error is ApiError => error !== null);
  if (!shown) return null;
  return <Notice>{shown.message}</Notice>;
}

export function useFocusRequest() {
  const wanted = useRef<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const settle = () => {
    const key = wanted.current;
    if (key === null) return;
    const element = elements.current.get(key);
    if (!element) return;
    wanted.current = null;
    element.focus();
  };
  useLayoutEffect(settle);
  return {
    ref: (key: string) => (element: HTMLElement | null) => {
      if (element) elements.current.set(key, element);
      else elements.current.delete(key);
    },
    request(key: string) {
      wanted.current = key;
      settle();
    },
  };
}

type Arrival = "heading" | "checks";
let arrival: { path: string; target: Arrival } | null = null;

export function requestMrFocus(path: string, target: Arrival): void {
  arrival = { path, target };
}

export function takeMrFocus(path: string): Arrival | null {
  if (!arrival || arrival.path !== path) return null;
  const { target } = arrival;
  arrival = null;
  return target;
}
