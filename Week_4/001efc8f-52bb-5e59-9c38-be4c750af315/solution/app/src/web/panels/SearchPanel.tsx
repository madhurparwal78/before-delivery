import { useEffect, useState } from "react";
import { Image as ImageGlyph, MessageSquare } from "lucide-react";
import { apiMessage } from "../api";
import { cachedSearch, runSearch, type SearchPage } from "../query";
import { notify, useMe } from "../store";
import { formatWhen } from "../../shared/when";
import type { SearchResult } from "../types";

function announce(page: SearchPage): void {
  if (page.total === 0) notify(`No results for “${page.query}”.`);
  else notify(`${page.total} ${page.total === 1 ? "result" : "results"} for “${page.query}”.`);
}

// Literal matches in the person's channels, newest first; snippets are plain text, never links.
export function SearchPanel({ query, onOpen, pending = false }: { query: string; onOpen?: (result: SearchResult) => void; pending?: boolean }) {
  const zone = useMe().workspace.time_zone;
  const [page, setPage] = useState<SearchPage | null>(() => (pending ? null : (cachedSearch(query) ?? null)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pending) return;
    let live = true;
    const cached = cachedSearch(query);
    setPage(cached ?? null);
    if (cached) announce(cached);
    runSearch(query).then(
      (outcome) => {
        if (!live || !("page" in outcome)) return;
        setPage(outcome.page);
        if (!cached) announce(outcome.page);
      },
      (failure: unknown) => {
        if (live) setError(apiMessage(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [query, pending]);

  const more = async () => {
    if (!page?.next_cursor) return;
    try {
      const outcome = await runSearch(query, page.next_cursor);
      if ("page" in outcome) setPage({ ...outcome.page, results: [...page.results, ...outcome.page.results] });
    } catch (failure) {
      notify(apiMessage(failure));
    }
  };

  return (
    <section className="panel" aria-labelledby="panel-search">
      <h2 id="panel-search" className="panel-title">
        Search results
      </h2>
      {!page && !error ? <p className="panel-note">Searching…</p> : null}
      {error ? <p className="panel-note">{error}</p> : null}
      {page ? (
        <>
          <p className="search-total">
            {page.total} {page.total === 1 ? "result" : "results"} for “{page.query}”
          </p>
          <ul className="results">
            {page.results.map((result) => (
              <li key={`${result.message_id}-${result.attachment_id ?? ""}`}>
                <button className="result" type="button" onClick={() => onOpen?.(result)}>
                  <span className="result-head">
                    {result.kind === "photo" ? <ImageGlyph aria-hidden="true" size={16} /> : <MessageSquare aria-hidden="true" size={16} />}
                    <span className="result-channel">#{result.channel.name}</span>
                    <span>{result.author_name}</span>
                    <span className="stamp">{formatWhen(zone, result.sent_at)}</span>
                  </span>
                  <span className="result-snippet">{result.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
          {page.next_cursor ? (
            <button className="button button-quiet" type="button" onClick={() => void more()}>
              Load more results
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
