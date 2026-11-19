import { useLayoutEffect, useRef } from 'preact/hooks';

/** A ref for a page's h1: focus moves to it when the page opens, so a screen reader starts at the page title. */
export function usePageHeading() {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}
