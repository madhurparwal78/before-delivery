import { Link } from '../lib/router.js';
import { numeralFor } from '../../shared/sightline.js';
import type { SourceRecord, TimelineEvent } from '../../shared/types.js';

export function Sources({
  sources,
  events,
}: {
  sources: SourceRecord[];
  events: TimelineEvent[];
}): JSX.Element {
  return (
    <>
      <h1>Sources</h1>
      <ul className="card-grid">
        {sources.map((source) => (
          <li key={source.id} className="museum-card">
            <span className="catalogue">{source.id}</span>
            <p>{source.citation}</p>
            <ul>
              {source.cited_by.map((id) => {
                const event = events.find((entry) => entry.id === id);
                if (!event) return null;
                return (
                  <li key={id} className="secondary">
                    <Link to={`/chapters/${event.chapter}`}>
                      {`${event.title} — Chapter ${numeralFor(event.chapter)}`}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}
