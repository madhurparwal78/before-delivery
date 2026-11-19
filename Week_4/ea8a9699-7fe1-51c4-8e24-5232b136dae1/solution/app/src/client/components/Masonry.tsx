// Masonry in reading order: items keep document order (so Tab and screen readers read left to right, top to
// bottom) and each is placed under the shortest column, from its measured height.
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref } from "react";

/** Column counts by minimum viewport width, widest first (brief: Screens and layout table). */
type ColumnSpec = ReadonlyArray<readonly [number, number]>;

export const WALL_COLUMNS: ColumnSpec = [[1024, 3], [600, 2], [0, 1]];
export const EXPLORE_COLUMNS: ColumnSpec = [[1280, 4], [1024, 3], [600, 2], [0, 1]];

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

function useColumns(spec: ColumnSpec): number {
  const key = useSyncExternalStore(
    (onChange) => {
      const lists = spec.map(([min]) => matchMedia(`(min-width: ${min}px)`));
      lists.forEach((l) => l.addEventListener("change", onChange));
      return () => lists.forEach((l) => l.removeEventListener("change", onChange));
    },
    () => spec.find(([min]) => matchMedia(`(min-width: ${min}px)`).matches)?.[1] ?? 1,
  );
  return key;
}

export interface MasonryItem {
  key: string;
  render: (style: CSSProperties, ref: Ref<HTMLElement>) => ReactNode;
}

const GAP = 8;

export function Masonry({ items, columns, className, label, role }: { items: MasonryItem[]; columns: ColumnSpec; className: string; label: string; role?: "feed" }) {
  const count = useColumns(columns);
  const container = useRef<HTMLElement | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const observer = useRef<ResizeObserver | null>(null);
  if (!observer.current) {
    observer.current = new ResizeObserver((records) => {
      setHeights((current) => {
        let next = current;
        for (const record of records) {
          const node = record.target as HTMLElement;
          const key = node.dataset.key ?? "";
          if (next[key] !== node.offsetHeight) next = { ...next, [key]: node.offsetHeight };
        }
        return next;
      });
    });
  }
  useLayoutEffect(() => () => observer.current?.disconnect(), []);

  const columnWidth = width > 0 ? (width - GAP * (count - 1)) / count : 0;
  // ResizeObserver runs after layout and can otherwise expose a frame of estimated positions.
  // Measure at the assigned column width before paint, also for newly appended cards and resizes.
  useLayoutEffect(() => {
    if (columnWidth <= 0) return;
    let next = heights;
    for (const item of items) {
      const node = nodes.current.get(item.key);
      if (node && next[item.key] !== node.offsetHeight) next = { ...next, [item.key]: node.offsetHeight };
    }
    if (next !== heights) setHeights(next);
  });
  const tops = Array.from({ length: count }, () => 0);
  const placed = items.map((item) => {
    const column = tops.indexOf(Math.min(...tops));
    const top = tops[column] ?? 0;
    tops[column] = top + (heights[item.key] ?? columnWidth) + GAP;
    return { item, style: { position: "absolute", left: column * (columnWidth + GAP), top, width: columnWidth } as CSSProperties };
  });
  const height = Math.max(0, ...tops) - GAP;
  const Tag = role === "feed" ? "div" : "ul";
  return (
    <Tag
      ref={(el: HTMLElement | null) => {
        container.current = el;
      }}
      className={`masonry ${className}`}
      aria-label={label}
      role={role}
      style={{ height: Math.max(height, 0), visibility: width > 0 ? "visible" : "hidden" }}
    >
      {placed.map(({ item, style }) =>
        item.render(style, (el: HTMLElement | null) => {
          const known = nodes.current.get(item.key);
          if (el && el !== known) {
            if (known) observer.current?.unobserve(known);
            el.dataset.key = item.key;
            nodes.current.set(item.key, el);
            observer.current?.observe(el);
          } else if (!el && known) {
            observer.current?.unobserve(known);
            nodes.current.delete(item.key);
          }
        }),
      )}
    </Tag>
  );
}
