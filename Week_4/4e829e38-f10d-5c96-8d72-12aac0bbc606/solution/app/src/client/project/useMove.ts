import { useRef } from "preact/hooks";
import { useMount } from "../hooks";
import { reducedMotion, tween, type Tween } from "../motion";
import { configStore } from "../store";

const places = new Map<string, { x: number; y: number; key: string }>();

/** Forgets where a view's elements were, so a view that is shown again never animates stale moves. */
export function clearPlaces(namespace: string): void {
  for (const key of places.keys()) if (key.startsWith(namespace)) places.delete(key);
}

/**
 * Animates an element that moved: it is already drawn in its new place (state first), and the
 * motion only plays it in from the old place on the page clock. Exposes data-move-progress and
 * data-motion for the whole move.
 */
export function useMove<T extends HTMLElement>(namespace: string, id: string, key: string) {
  const ref = useRef<T>(null);
  const running = useRef<Tween | null>(null);
  const where = () => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY };
  };
  useMount(() => {
    const el = ref.current;
    if (!el) return undefined;
    running.current?.cancel();
    running.current = null;
    el.style.transform = "";
    const now = where();
    const before = places.get(namespace + id);
    places.set(namespace + id, { ...now, key });
    const moved = before && before.key !== key && (before.x !== now.x || before.y !== now.y);
    if (!moved || reducedMotion()) {
      el.dataset.motion = "settled";
      el.dataset.moveProgress = "1.0000";
      return undefined;
    }
    const dx = before.x - now.x;
    const dy = before.y - now.y;
    el.dataset.motion = "moving";
    running.current = tween(
      configStore.get().moveMs,
      (eased) => {
        el.style.transform = `translate3d(${dx * (1 - eased)}px, ${dy * (1 - eased)}px, 0)`;
        el.dataset.moveProgress = eased.toFixed(4);
      },
      () => {
        el.style.transform = "";
        el.dataset.motion = "settled";
        el.dataset.moveProgress = "1.0000";
        running.current = null;
      },
    );
    return () => running.current?.cancel();
  }, [key]);
  useMount(() => {
    if (ref.current && !running.current) places.set(namespace + id, { ...where(), key });
  });
  return ref;
}
