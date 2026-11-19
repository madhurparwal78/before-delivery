import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { QueueRow } from "../../shared/api.ts";
import { ESCALATION_LABELS } from "../../shared/domain.ts";
import { get, messageOf } from "../lib/api.ts";
import { stampOf } from "../lib/format.ts";
import { useTitle } from "../lib/focus.ts";
import { useLive } from "../lib/live.ts";
import { useDesktop } from "../lib/motion.ts";
import { Link } from "../lib/router.tsx";
import { Alert, EmptyState, Loading } from "../ui/index.ts";
import "../queue/queue.css";

const escalationOf = (row: QueueRow): string | null => (row.escalation ? ESCALATION_LABELS[row.escalation] : null);

export function Queue(_props: { params: string[] }): ReactNode {
  useTitle("Queue");
  const desktop = useDesktop();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = (await get<{ rows: QueueRow[] }>("/api/queue")).rows;
      const ids = new Set(next.map((row) => row.requestId));
      if (known.current) {
        const added = next.filter((row) => !known.current!.has(row.requestId)).map((row) => `${row.requestId} added to your queue.`);
        const left = [...known.current].filter((id) => !ids.has(id)).map((id) => `${id} left your queue.`);
        if (added.length + left.length > 0) setAnnouncement([...added, ...left].join(" "));
      }
      known.current = ids;
      setRows(next);
      setError(null);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, []);
  useEffect(() => void load(), [load]);
  useLive(["queue.updated", "request.updated"], () => void load());

  return (
    <>
      <h1>Queue</h1>
      <p role="status" aria-label="Queue updates" className="queue-updates">
        {announcement}
      </p>
      <Alert message={error} />
      {rows === null ? (
        error ? null : <Loading />
      ) : rows.length === 0 ? (
        <EmptyState glyph="inbox" tone="meadow">
          Nothing is waiting for you.
        </EmptyState>
      ) : desktop ? (
        <div className="cell table-wrap" data-frame>
          <table className="table" aria-label="Review queue">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Asset</th>
                <th scope="col">Application</th>
                <th scope="col">Requester</th>
                <th scope="col">Stage</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.requestId}>
                  <td>
                    <Link to={`/requests/${row.requestId}`} className="row-link">
                      {row.requestId}
                    </Link>
                  </td>
                  <td>{row.cardName}</td>
                  <td>{row.applicationLabel}</td>
                  <td>{`${row.requesterName}, ${row.organisationName}`}</td>
                  <td>{row.stageLabel}</td>
                  <td>
                    {`Due ${stampOf(row.deadline)}`}
                    {escalationOf(row) ? <span className="queue-escalation">{escalationOf(row)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="queue-cards" aria-label="Review queue">
          {rows.map((row) => (
            <li key={row.requestId} className="cell cell-pad queue-card" data-frame>
              <Link to={`/requests/${row.requestId}`} className="row-link">
                {row.requestId}
              </Link>
              <dl>
                <dt>Asset</dt>
                <dd>{row.cardName}</dd>
                <dt>Application</dt>
                <dd>{row.applicationLabel}</dd>
                <dt>Requester</dt>
                <dd>{`${row.requesterName}, ${row.organisationName}`}</dd>
                <dt>Stage</dt>
                <dd>{row.stageLabel}</dd>
                <dt>Due</dt>
                <dd>
                  {`Due ${stampOf(row.deadline)}`}
                  {escalationOf(row) ? <span className="queue-escalation">{escalationOf(row)}</span> : null}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
