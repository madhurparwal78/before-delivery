import { useEffect, useRef, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listen = () => setReduced(query.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);
  return reduced;
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(1280);
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return width;
}

export function useInterval(run: () => void, milliseconds: number): void {
  const held = useRef(run);
  held.current = run;
  useEffect(() => {
    const timer = window.setInterval(() => held.current(), milliseconds);
    return () => window.clearInterval(timer);
  }, [milliseconds]);
}

/** Keep Tab and Shift+Tab inside an open panel. */
export function useFocusTrap(open: boolean, container: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!open) return;
    const node = container.current;
    if (!node) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, container]);
}

export function useReveal<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, shown];
}
