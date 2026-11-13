// The chapter index (brief: Screens and layout › Chapter index).

import { useApi, useChapters } from "../hooks.js";
import { Link } from "../router.js";
import { useApp } from "../state.js";
import { rememberNumeral } from "../morph.js";
import type { ChapterSummary, Path } from "../api.js";

export function ChapterCard({ chapter }: { chapter: ChapterSummary }) {
  return (
    <Link
      href={`/chapters/${chapter.number}`}
      className="chapter-card museum-card"
      aria-describedby={`${chapter.id}-meta`}
      onNavigate={(event) => rememberNumeral(chapter.numeral, event.currentTarget.querySelector(".card-numeral"))}
    >
      {/* The name comes from this text, so the visible numeral and title stay part of it. */}
      <span className="visually-hidden">{`Chapter ${chapter.numeral}: ${chapter.title}`}</span>
      <span className="card-head" aria-hidden="true">
        <span className="catalogue">{chapter.catalogue_number}</span>
        {chapter.resolved && <span className="resolved-mark">Resolved</span>}
      </span>
      <span className="card-numeral" aria-hidden="true">
        {chapter.numeral}
      </span>{" "}
      <span className="card-title" aria-hidden="true">
        {chapter.title}
      </span>
      <span className="era" aria-hidden="true">
        {chapter.era}
      </span>
      <span id={`${chapter.id}-meta`} hidden>
        {[chapter.catalogue_number, chapter.era, chapter.resolved ? "Resolved" : ""].filter(Boolean).join(", ")}
      </span>
    </Link>
  );
}

export function IndexPage() {
  const app = useApp();
  const chapters = useChapters(app.user?.id ?? null, app.pathVersion);
  const path = useApi<{ path: Path }>(app.user ? `/api/me/path?v=${app.pathVersion}` : null);
  const last = path.data?.path.last_chapter ?? null;
  const lastChapter = chapters?.find((c) => c.number === last);
  return (
    <div className="page index-page">
      <header className="page-intro">
        <p className="eyebrow">Halden Reading Room · Sightline</p>
        <h1>Eight rooms of machine thought</h1>
        <p className="lede">
          Each room opens as a sculpture of scattered shards. Turn it until the shards line up and the chapter reveals its numeral and title, then step inside.
        </p>
        {app.user && lastChapter && (
          <Link href={`/chapters/${lastChapter.number}`} className="button button-primary continue-link">
            Continue at chapter {lastChapter.numeral}
          </Link>
        )}
      </header>
      {chapters ? (
        <ol className="card-grid chapter-grid">
          {chapters.map((c) => (
            <li key={c.number}>
              <ChapterCard chapter={c} />
            </li>
          ))}
        </ol>
      ) : (
        <ol className="card-grid chapter-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={`skeleton-${i}`}>
              <div className="museum-card skeleton-card" />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
