import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReturnView } from "../../shared/types";
import { EmptyTile, ReturnTile } from "../components/Tile";
import { useReturnList } from "../hooks";
import { prefersReducedMotion } from "../lib/dom";
import { Link } from "../router";

const GLIDE_MS = 280;
const DRAG_THRESHOLD = 5;

/** Moves a row sideways to a position: gliding, or at once under reduced motion. */
function glide(row: HTMLElement, left: number): void {
  const from = row.scrollLeft;
  if (prefersReducedMotion()) {
    row.scrollLeft = left;
    return;
  }
  let started: number | null = null;
  const frame = (time: number): void => {
    started ??= time;
    const t = Math.min(1, (time - started) / GLIDE_MS);
    row.scrollLeft = from + (left - from) * (1 - (1 - t) ** 3);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function Row({ name, items }: { name: string; items: ReturnView[] }) {
  const row = useRef<HTMLUListElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = row.current!;
    setEdge({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, items.length]);

  const step = (direction: 1 | -1): void => {
    const el = row.current!;
    const tiles = el.children;
    const width = tiles.length > 1 ? (tiles[1] as HTMLElement).offsetLeft - (tiles[0] as HTMLElement).offsetLeft : el.clientWidth;
    glide(el, Math.max(0, el.scrollLeft + direction * width));
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    step(event.key === "ArrowRight" ? 1 : -1);
  };
  const down = (event: PointerEvent<HTMLUListElement>): void => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    drag.current = { x: event.clientX, left: row.current!.scrollLeft, moved: false };
  };
  const move = (event: PointerEvent<HTMLUListElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    if (!d.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      d.moved = true;
      row.current!.setPointerCapture(event.pointerId);
    }
    if (d.moved) row.current!.scrollLeft = d.left - dx;
  };
  const up = (): void => {
    swallowClick.current = drag.current?.moved ?? false;
    drag.current = null;
  };

  return (
    <section aria-label={name} className="catalogue-row">
      <div className="row-head">
        <h2>{name}</h2>
        <div className="pager">
          {!edge.start && (
            <button type="button" className="button" aria-label={`Previous returns for ${name}`} onClick={() => step(-1)}>
              <ChevronLeft aria-hidden="true" size={20} />Previous
            </button>
          )}
          {!edge.end && (
            <button type="button" className="button" aria-label={`Next returns for ${name}`} onClick={() => step(1)}>
              Next<ChevronRight aria-hidden="true" size={20} />
            </button>
          )}
        </div>
      </div>
      <ul ref={row} aria-label={`Returns for ${name}`} className="tiles" tabIndex={0} onKeyDown={onKey} onScroll={measure}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClickCapture={(event) => {
          if (swallowClick.current) {
            event.preventDefault();
            event.stopPropagation();
          }
          swallowClick.current = false;
        }}>
        {items.map((r) => (
          <li key={r.id}>
            {/* Named from its content, the brief's "<client> <state> <period>"; the drawn tile and caption repeat
                it for the eye, and the due line is the link's description. */}
            <Link href={`/returns/${r.id}`} aria-describedby={`due-line-${r.id}`} draggable={false}>
              <span className="sr-only">{`${r.client.name} ${r.state} ${r.period_label}`}</span>
              <ReturnTile view={r} />
              <span className="caption" aria-hidden="true">
                <strong>{r.client.name}</strong>
                <span id={`due-line-${r.id}`}>{r.due_line}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Catalogue() {
  const list = useReturnList("/api/returns");
  const byClient = new Map<string, ReturnView[]>();
  for (const r of list?.returns ?? []) byClient.set(r.client.id, [...(byClient.get(r.client.id) ?? []), r]);
  return (
    <main className="catalogue">
      <h1>Catalogue</h1>
      {[...byClient.values()].sort((a, b) => (a[0].client.name < b[0].client.name ? -1 : 1))
        .map((items) => <Row key={items[0].client.id} name={items[0].client.name} items={items} />)}
      {list?.counts.total === 0 && <EmptyTile>No returns yet. Register a client in a state to start.</EmptyTile>}
    </main>
  );
}
