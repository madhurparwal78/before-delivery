// Sources (brief: Screens and layout › Sources): every source with its citation and the
// published events that cite it, in the published order.

import type { Source, TimelineEvent } from "../api.js";
import { useApi } from "../hooks.js";
import { Link } from "../router.js";
import { Skeleton } from "../components/ui.js";
import { NUMERALS } from "../../shared/copy.js";

export function SourcesPage() {
  const sources = useApi<{ sources: Source[] }>("/api/sources");
  const timeline = useApi<{ events: TimelineEvent[] }>("/api/timeline");
  const events = new Map((timeline.data?.events ?? []).map((e) => [e.id, e]));
  return (
    <div className="page sources-page">
      <header className="page-intro">
        <p className="eyebrow">The archive</p>
        <h1>Sources</h1>
        <p className="lede">The papers, notes and books the exhibition draws on, each with the timeline events that cite it.</p>
      </header>
      {sources.data ? (
        <ol className="source-list">
          {sources.data.sources.map((s) => (
            <li key={s.id} className="museum-card source-card">
              <p className="catalogue">{s.id.toUpperCase()}</p>
              <p className="citation">{s.citation}</p>
              {s.cited_by.length > 0 ? (
                <ul className="cited-by" aria-label={`Cited by, ${s.id}`}>
                  {s.cited_by.map((id) => {
                    const event = events.get(id);
                    return (
                      <li key={id}>
                        {event ? (
                          <Link href={`/chapters/${event.chapter}`}>
                            <span className="figure">{event.year}</span> {event.title} <span className="era">· Chapter {NUMERALS[event.chapter - 1]}</span>
                          </Link>
                        ) : (
                          id
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="hint">Not yet cited by a published event.</p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <Skeleton lines={6} />
      )}
    </div>
  );
}
