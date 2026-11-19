import { CircleAlert } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { displayJson, plural } from "../../shared/display.js";
import type { JsonValue } from "../../shared/json.js";
import { asFailure, del, get, post } from "../api.js";
import { useToast } from "../components/Toast.js";
import { queryErrorText } from "../copy.js";
import { useShell } from "../shell/ProjectShell.js";

interface SavedQuery {
  id: string;
  name: string;
  filter: JsonValue;
  last_run_at: string | null;
  last_count: number | null;
}

const lastRunLine = (at: string | null, count: number | null): string =>
  at === null || count === null ? "Never run" : `Last run ${at.slice(0, 10)} ${at.slice(11, 16)} UTC, ${plural(count, "document")} matched`;

export function SavedQueries(): ReactNode {
  const { project, collection, role } = useShell();
  const toast = useToast();
  const base = `/api/projects/${project.id}/collections/${collection?.id ?? ""}/saved-queries`;
  const [queries, setQueries] = useState<SavedQuery[] | null>(null);
  const [message, setMessage] = useState("");
  const writer = role !== "reader";

  const load = useCallback(async () => {
    setQueries((await get<{ saved_queries: SavedQuery[] }>(base)).saved_queries);
  }, [base]);
  useEffect(() => void load(), [load]);

  const run = async (query: SavedQuery): Promise<void> => {
    setMessage("");
    try {
      const answer = await post<{ saved_query: SavedQuery }>(`${base}/${query.id}/run`, { page: 1 });
      setQueries((current) => current?.map((item) => (item.id === query.id ? answer.saved_query : item)) ?? null);
    } catch (error) {
      setMessage(queryErrorText(asFailure(error).body));
    }
  };

  return (
    <>
      <h1 className="screen-title">Saved queries</h1>
      {message ? (
        <p className="error-chip error-block" role="alert" aria-label="Query error">
          <CircleAlert size={18} aria-hidden="true" />
          {message}
        </p>
      ) : null}
      <ul className="rows panel" role="list" aria-label="Saved queries" aria-busy={queries === null || undefined}>
        {queries === null ? (
          <li className="skeleton-row" />
        ) : (
          queries.map((query) => (
            <li key={query.id} className="row saved-row">
              <span className="row-main">
                <strong>{query.name}</strong>
                <span className="muted saved-filter">{displayJson(query.filter)}</span>
                <span className="muted">{lastRunLine(query.last_run_at, query.last_count)}</span>
              </span>
              <span className="row-actions">
                <button type="button" className="btn" aria-label={`Run ${query.name}`} onClick={() => void run(query)}>
                  Run
                </button>
                {writer ? (
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Delete ${query.name}`}
                    onClick={() =>
                      void del(`${base}/${query.id}`).then(() => {
                        toast("Query deleted");
                        return load();
                      })
                    }
                  >
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))
        )}
      </ul>
      {queries?.length === 0 ? <p className="muted">No saved queries yet. Run a query on Documents, then press Save query.</p> : null}
    </>
  );
}
