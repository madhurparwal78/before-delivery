import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
}

/** True from the first time the element is seen; always true under reduced motion. */
export function useSeenOnce<T extends Element>(): [RefObject<T | null>, boolean] {
  const reduced = useReducedMotion();
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen || reduced];
}

/** Live visibility of an element in the viewport. */
export function useOnScreen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setVisible(last.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, visible];
}
