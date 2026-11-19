/** The cutting floor: the loft hand's queue of assigned drawings, and the nesting screen without the step rail. */
import { useCallback, useEffect, useRef } from "react";
import { getJson } from "../api.js";
import { useLive } from "../live.js";
import { Link } from "../router.js";
import { EmptyState, useLoad, usePoll } from "../ui.js";
import { Nesting } from "./nesting.js";
import { PageHeading } from "./chrome.js";
import { NotFound } from "./public.js";
import { StatusChip } from "./loft.js";
import { EMPTY, SUCCESS } from "../../shared/copy.js";
import { sailLabel } from "../format.js";
import type { Drawing, Page } from "../../shared/types.js";

export function FloorPage() {
  const { say } = useLive();
  const queue = useLoad((signal) => getJson<Page<Drawing>>("/api/drawings?limit=50", signal), []);
  const known = useRef<Set<string> | null>(null);
  const items = queue.data?.items ?? [];
  useEffect(() => {
    if (!queue.data) return;
    const codes = new Set(queue.data.items.map((item) => item.code));
    if (known.current) {
      for (const code of codes) if (!known.current.has(code)) say(SUCCESS.newAssignment(code));
    }
    known.current = codes;
  }, [queue.data, say]);
  usePoll(() => void queue.reload(), 5);
  return (
    <main className="page">
      <section className="field-ground">
        <PageHeading>Cutting floor</PageHeading>
      </section>
      {!queue.data ? null : items.length === 0 ? (
        <EmptyState>{EMPTY.floor}</EmptyState>
      ) : (
        <ul aria-label="Cutting queue" className="card-grid queue-grid">
          {items.map((drawing) => (
            <li key={drawing.code} className="card">
              <Link to={`/floor/${drawing.code}`} className="card-link">{`${drawing.code} · ${drawing.boat_name} ${sailLabel(drawing.sail)}`}</Link>
              <p className="card-figure">{drawing.area ? `${drawing.area.area_m2} m²` : "Not drawn"}</p>
              <p className="muted">{`${drawing.panels.length} panels`}</p>
              <StatusChip status={drawing.status} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function FloorDrawingPage({ code }: { code: string }) {
  const drawing = useLoad((signal) => getJson<Drawing>(`/api/drawings/${code}`, signal), [code]);
  const onDrawing = useCallback(() => undefined, []);
  if (drawing.error?.status === 404) return <NotFound />;
  return (
    <main className="page">
      <PageHeading>{`Nest ${code}`}</PageHeading>
      <Nesting code={code} onDrawing={onDrawing} onCut={() => undefined} />
    </main>
  );
}
