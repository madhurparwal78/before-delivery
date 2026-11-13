import { Link } from '../lib/router.js';
import { useResource } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { numeralFor } from '../../shared/sightline.js';
import type { ChapterSummary, SavedPath } from '../../shared/types.js';

export function ChapterIndex({ chapters }: { chapters: ChapterSummary[] }): JSX.Element {
  const { user } = useStore();
  const path = useResource<{ path: SavedPath }>(user ? '/api/me/path' : null);
  const lastChapter = path.data?.path.last_chapter ?? null;

  return (
    <>
      <h1>Eight Rooms of Machine Thought</h1>
      <p>
        Each chapter opens as a cloud of shards that reads as its numeral and title from one viewpoint alone. Find
        the sightline and the room opens.
      </p>
      {lastChapter !== null ? (
        <p>
          <Link to={`/chapters/${lastChapter}`}>{`Continue at chapter ${numeralFor(lastChapter)}`}</Link>
        </p>
      ) : null}
      <ul className="card-grid">
        {chapters.map((chapter) => (
          <li key={chapter.number} className="museum-card" data-numeral={chapter.numeral}>
            <span className="catalogue">{chapter.catalogue_number}</span>
            <span className="numeral" aria-hidden="true">
              {chapter.numeral}
            </span>
            <h2 style={{ fontSize: 'var(--step-2)' }}>
              <Link to={`/chapters/${chapter.number}`}>{`Chapter ${chapter.numeral}: ${chapter.title}`}</Link>
            </h2>
            <span className="secondary">{chapter.era}</span>
            {chapter.resolved ? <span className="accent">Resolved</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
