import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ChapterPage } from "../../shared/api.ts";
import { ApiFailure, get } from "../lib/api.ts";
import { useTitle } from "../lib/focus.ts";
import { dateOf } from "../lib/format.ts";
import { useLive } from "../lib/live.ts";
import { useSession } from "../lib/session.tsx";
import { ChapterFigures } from "../figures/index.tsx";
import { Loading } from "../ui/Feedback.tsx";
import { NotFound } from "./NotFound.tsx";
import "../figures/figures.css";

function LiveChapter({ slug, reload }: { slug: string; reload: () => void }): ReactNode {
  useLive(["chapter.updated"], (message) => {
    if (message.type === "chapter.updated" && message.slug === slug) reload();
  });
  return null;
}

/** A published chapter page; `focusId` scrolls a statement into view and focuses it (the rule route). */
export function ChapterView({ slug, focusId }: { slug: string; focusId?: string }): ReactNode {
  const { me } = useSession();
  const [page, setPage] = useState<ChapterPage | "missing" | null>(null);
  const load = useCallback(() => {
    get<ChapterPage>(`/api/chapters/${slug}`).then(setPage, (error: unknown) => {
      if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
      setPage("missing");
    });
  }, [slug]);
  useEffect(load, [load]);
  useTitle(page && page !== "missing" ? page.title : "Chapter");

  const ready = page !== null && page !== "missing";
  useEffect(() => {
    if (!ready || !focusId) return;
    const item = document.getElementById(focusId);
    if (!item) return;
    item.scrollIntoView({ block: "center", behavior: "instant" });
    item.focus({ preventScroll: true });
  }, [ready, focusId]);

  if (page === "missing") return <NotFound />;
  if (page === null) return <Loading />;
  return (
    <>
      {me ? <LiveChapter slug={slug} reload={load} /> : null}
      <article className="chapter">
        <header className="cell cell-pad chapter-head" data-frame>
          <h1>{page.title}</h1>
          <p className="chapter-version">
            Version {page.version}, published {dateOf(page.publishedAt)}
          </p>
          <p className="prose">{page.intro}</p>
        </header>
        <div className="chapter-columns">
          <section className="cell cell-pad" data-frame aria-label="Statements">
            <h2 className="cell-label">Rules</h2>
            <ul className="statements" aria-label="Rules">
              {page.statements.map((s) => (
                <li key={s.identifier} id={s.identifier} tabIndex={-1}>
                  <code className="identifier">{s.identifier}</code>
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="chapter-figures">
            <ChapterFigures slug={slug} />
          </div>
        </div>
      </article>
    </>
  );
}

export function ChapterScreen({ params }: { params: string[] }): ReactNode {
  return <ChapterView slug={params[0]} />;
}
