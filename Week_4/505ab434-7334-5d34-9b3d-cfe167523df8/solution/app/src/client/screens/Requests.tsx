import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RequestSummary } from "../../shared/api.ts";
import { get, messageOf } from "../lib/api.ts";
import { stampOf } from "../lib/format.ts";
import { useTitle } from "../lib/focus.ts";
import { useLive } from "../lib/live.ts";
import { Link } from "../lib/router.tsx";
import { Alert, Chip, EmptyState, Loading } from "../ui/index.ts";

export function Requests(_props: { params: string[] }): ReactNode {
  useTitle("My requests");
  const [requests, setRequests] = useState<RequestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRequests((await get<{ requests: RequestSummary[] }>("/api/requests")).requests);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, []);
  useEffect(() => void load(), [load]);
  useLive(["request.updated"], () => void load());

  return (
    <>
      <h1>My requests</h1>
      <Alert message={error} />
      {requests === null ? (
        error ? null : <Loading />
      ) : requests.length === 0 ? (
        <EmptyState glyph="inbox">You have no requests yet.</EmptyState>
      ) : (
        <div className="cell table-wrap" data-frame>
          <table className="table" aria-label="My requests">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Asset</th>
                <th scope="col">Application</th>
                <th scope="col">State</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>
                    <Link to={`/requests/${request.id}`} className="row-link">
                      {request.id}
                    </Link>
                  </td>
                  <td>{request.cardName}</td>
                  <td>{request.applicationLabel}</td>
                  <td>
                    <Chip>{request.stateLabel}</Chip>
                  </td>
                  <td>{request.deadline ? stampOf(request.deadline) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
