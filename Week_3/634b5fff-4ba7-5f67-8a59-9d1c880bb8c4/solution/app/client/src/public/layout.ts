import { useCallback, useEffect, useRef, type RefCallback } from "react";

/** Fixed chrome (the top bar, the story band, the hold bar) publishes its height as a CSS variable and an event. */

type Extent = "chrome" | "band" | "dock";

const LAYOUT_EVENT = "press:layout";

export const extentOf = (name: Extent): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`)) || 0;

const publish = (name: Extent, height: number): void => {
  document.documentElement.style.setProperty(`--${name}`, `${height}px`);
  window.dispatchEvent(new Event(LAYOUT_EVENT));
};

/** A ref callback for the element whose height is the named extent; the extent is 0 while it is not rendered. */
export const useExtent = (name: Extent): RefCallback<HTMLElement> =>
  useCallback(
    (element: HTMLElement | null) => {
      if (!element) return undefined;
      const write = (): void => publish(name, element.getBoundingClientRect().height);
      write();
      const observer = new ResizeObserver(write);
      observer.observe(element);
      return () => {
        observer.disconnect();
        publish(name, 0);
      };
    },
    [name],
  );

/** Calls `listener` whenever the window or the fixed chrome changes size. */
export const useLayoutChange = (listener: () => void): void => {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const call = (): void => latest.current();
    window.addEventListener("resize", call);
    window.addEventListener(LAYOUT_EVENT, call);
    return () => {
      window.removeEventListener("resize", call);
      window.removeEventListener(LAYOUT_EVENT, call);
    };
  }, []);
};

/** A length custom property of the design tokens, in pixels. */
export const tokenPx = (name: string): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
