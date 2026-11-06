import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LIMITS, SYSTEM_KIND_IDS, SYSTEM_KINDS, ZONE_KIND_IDS, ZONE_KINDS, type Point, type SystemKind, type ZoneKind } from "../../shared/model.ts";
import { icons, KindIcon, ZoneKindIcon } from "../icons.tsx";

export type LibraryKind = { type: "system"; kind: SystemKind } | { type: "zone"; kind: ZoneKind };

interface Props {
  disabled: boolean;
  zonesFull: boolean;
  /** Places at the centre of the canvas pane. */
  onAdd(item: LibraryKind): void;
  /** Places centred on a client point dropped over the canvas. */
  onDrop(item: LibraryKind, client: Point): void;
}

const ENTRIES: { item: LibraryKind; name: string }[] = [
  ...SYSTEM_KIND_IDS.map((kind) => ({ item: { type: "system", kind } as LibraryKind, name: SYSTEM_KINDS[kind] })),
  ...ZONE_KIND_IDS.map((kind) => ({ item: { type: "zone", kind } as LibraryKind, name: ZONE_KINDS[kind].name })),
];

/** The search keeps the Add buttons whose kind name contains the trimmed text, ignoring letter case. */
function matches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q);
}

export function LibraryBody({ disabled, zonesFull, onAdd, onDrop }: Props) {
  const [query, setQuery] = useState("");
  const drag = useRef<{ item: LibraryKind; sx: number; sy: number; ghost: HTMLElement | null; id: number } | null>(null);
  const suppressClick = useRef(false);
  const systems = ENTRIES.filter((e) => e.item.type === "system" && matches(e.name, query));
  const zones = ENTRIES.filter((e) => e.item.type === "zone" && matches(e.name, query));

  const onPointerDown = (item: LibraryKind) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { item, sx: e.clientX, sy: e.clientY, ghost: null, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.ghost && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.textContent = e.currentTarget.textContent?.replace(/^Add /, "") ?? "";
      document.body.append(ghost);
      d.ghost = ghost;
    }
    if (d.ghost) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.ghost) return;
    d.ghost.remove();
    suppressClick.current = true;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[role="application"]');
    if (over) onDrop(d.item, [e.clientX, e.clientY]);
  };

  const tile = ({ item, name }: { item: LibraryKind; name: string }) => {
    const off = disabled || (item.type === "zone" && zonesFull);
    return (
      <button
        key={`${item.type}:${item.kind}`}
        type="button"
        className="tile"
        disabled={off}
        onPointerDown={onPointerDown(item)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current?.ghost?.remove();
          drag.current = null;
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onAdd(item);
        }}
      >
        {item.type === "system" ? <KindIcon kind={item.kind} /> : <ZoneKindIcon kind={item.kind} />}
        <span className="tile-name"><span className="sr-only">Add </span>{name}{item.type === "zone" && <span className="sr-only"> zone</span>}</span>
      </button>
    );
  };

  return (
    <div className="library-body">
      <label className="search">
        <span className="sr-only">Search shapes</span>
        {icons.search}
        <input type="search" aria-label="Search shapes" placeholder="Search shapes" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {systems.length > 0 && (
        <>
          <p className="section-label" aria-hidden="true">Systems</p>
          <div className="tiles">{systems.map(tile)}</div>
        </>
      )}
      {zones.length > 0 && (
        <>
          <p className="section-label" aria-hidden="true">Zones{zonesFull ? ` · ${LIMITS.zones} max` : ""}</p>
          <div className="tiles">{zones.map(tile)}</div>
        </>
      )}
      {systems.length === 0 && zones.length === 0 && (
        <div className="empty-search">
          <svg className="empty-art" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
            <rect x="3" y="3" width="18" height="18" strokeDasharray="3 2" /><circle cx="20" cy="20" r="6" /><path d="m24.5 24.5 4.5 4.5" />
          </svg>
          <p>No shapes match your search.</p>
        </div>
      )}
    </div>
  );
}
