import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LibraryResponse, LibraryCard } from "../../shared/api.ts";
import { ASSET_CLASS_LABELS, BADGES, type Badge } from "../../shared/domain.ts";
import { get, messageOf } from "../lib/api.ts";
import { useTitle } from "../lib/focus.ts";
import { useLive } from "../lib/live.ts";
import { useSession } from "../lib/session.tsx";
import { CardView } from "../library/CardView.tsx";
import { RequestDialog } from "../library/RequestDialog.tsx";
import { applyFilters, resultsSentence, type Filters } from "../library/filters.ts";
import { Alert, EmptyState, Loading } from "../ui/index.ts";
import "../library/library.css";

export function Library(_props: { params: string[] }): ReactNode {
  useTitle("Library");
  const { me } = useSession();
  const [cards, setCards] = useState<LibraryCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ classLabel: "", badges: new Set<Badge>(), query: "" });
  const [requesting, setRequesting] = useState<LibraryCard | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setCards((await get<LibraryResponse>("/api/library")).cards);
      setError(null);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, []);
  useEffect(() => void load(), [load]);
  useLive(["library.updated", "grant.updated"], () => void load());

  const shown = useMemo(() => (cards ? applyFilters(cards, filters) : []), [cards, filters]);
  const toggleBadge = (badge: Badge): void =>
    setFilters((current) => {
      const next = new Set(current.badges);
      if (next.has(badge)) next.delete(badge);
      else next.add(badge);
      return { ...current, badges: next };
    });

  return (
    <>
      <h1>Library</h1>
      <div className="library">
        <section className="cell cell-pad filters-cell" data-frame>
          <span className="cell-label">Filters</span>
          <div role="group" aria-label="Filters" className="stack">
            <div className="field">
              <label htmlFor="lib-class">Class</label>
              <select id="lib-class" value={filters.classLabel} onChange={(event) => setFilters({ ...filters, classLabel: event.target.value })}>
                <option value="">All classes</option>
                {Object.values(ASSET_CLASS_LABELS).map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="check-grid single">
              {BADGES.map((badge) => (
                <label key={badge} className="check">
                  <input type="checkbox" checked={filters.badges.has(badge)} onChange={() => toggleBadge(badge)} />
                  {badge}
                </label>
              ))}
            </div>
            <div className="field">
              <label htmlFor="lib-search">Search assets</label>
              <input id="lib-search" type="search" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
            </div>
          </div>
          <p role="status" aria-label="Library results" className="results">
            {cards ? resultsSentence(shown.length, filters) : ""}
          </p>
        </section>
        <div className="lib-main">
          <Alert message={error} />
          {cards === null ? (
            error ? null : <Loading />
          ) : shown.length === 0 ? (
            <EmptyState glyph="empty" tone="stone">
              No assets match these filters.
            </EmptyState>
          ) : (
            <div className="card-grid">
              {shown.map((card) => (
                <CardView key={`${card.assetId}/${card.variantId}`} card={card} agency={me!.principal.role === "agency"} onRequest={(target) => setRequesting(target)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {requesting ? <RequestDialog card={requesting} onClose={() => setRequesting(null)} /> : null}
    </>
  );
}
