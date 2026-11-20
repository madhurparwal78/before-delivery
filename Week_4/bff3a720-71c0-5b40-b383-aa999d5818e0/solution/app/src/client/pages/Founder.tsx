import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { IdReview, OutboxItem } from "../../shared/api";
import { hhmm, shortDate } from "../../shared/time";
import { announce } from "../lib/announce";
import { api, errorMessage } from "../lib/http";
import { useLive } from "../lib/live";
import { useRequireMember } from "../lib/useRequireSignIn";
import { Alert, EmptyState, PageHeading, Skeleton, StatusLine } from "../ui/Bits";
import { Plate } from "../ui/Plate";
import { Dialog } from "../ui/Dialog";

const NO_ACCESS = "You do not have access to this.";

function useFounder(): { allowed: boolean; ready: boolean } {
  const member = useRequireMember();
  return { ready: !!member, allowed: !!member?.roles.includes("founder") };
}

export function IdReviewPage(): ReactElement | null {
  const { ready, allowed } = useFounder();
  const [items, setItems] = useState<IdReview[] | null>(null);
  const [asking, setAsking] = useState<IdReview | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [rowError, setRowError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    setItems((await api<{ documents: IdReview[] }>("GET", "/api/founder/id-reviews")).documents);
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  useLive({
    onEvent: (event) => {
      if (allowed && (event.type === "hello" || event.type === "clock")) void load();
    },
  });

  if (!ready) return null;
  if (!allowed) {
    return (
      <div>
        <PageHeading>ID review</PageHeading>
        <p>{NO_ACCESS}</p>
      </div>
    );
  }

  const approve = async (item: IdReview): Promise<void> => {
    setRowError("");
    try {
      await api("POST", `/api/founder/id-reviews/${item.id}/approve`);
      announce(`${item.member.display_name} is verified.`);
      setDone(`${item.member.display_name} is verified.`);
      await load();
    } catch (e) {
      setRowError(errorMessage(e));
    }
  };

  const send = async (): Promise<void> => {
    if (!asking || pending) return;
    setPending(true);
    setError("");
    try {
      await api("POST", `/api/founder/id-reviews/${asking.id}/reject`, { body: { reason } });
      announce(`${asking.member.display_name} was asked to upload again.`);
      setDone(`${asking.member.display_name} was asked to upload again.`);
      setAsking(null);
      setReason("");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="review-page">
      <PageHeading>ID review</PageHeading>
      <StatusLine text={done} />
      {items === null ? <Skeleton rows={3} /> : null}
      {items && items.length === 0 ? <EmptyState sentence="No documents are waiting for review." seed="review-empty" /> : null}
      <Alert>{rowError}</Alert>
      <div className="listing listing-tall">
      {items && items.length > 0 ? <Plate seed="review-queue" ratio={0.8} caption="Saint Ivrel to Corrandy, the documents on the road" /> : null}
      <ul className="rows" aria-label="ID review queue">
        {(items ?? []).map((item) => (
          <li key={item.id} data-id={item.id}>
            <p>{`${item.member.display_name}, uploaded ${shortDate(new Date(item.uploaded_at))} at ${hhmm(new Date(item.uploaded_at))}`}</p>
            <div className="actions">
              <a href={`/api/files/${item.file_id}`}>{`View document for ${item.member.display_name}`}</a>
              <button type="button" onClick={() => void approve(item)}>
                {`Approve ${item.member.display_name}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReason("");
                  setError("");
                  setAsking(item);
                }}
              >
                {`Ask ${item.member.display_name} to upload again`}
              </button>
            </div>
          </li>
        ))}
      </ul>
      </div>

      <Dialog open={asking !== null} title="Ask for a new upload" onClose={() => setAsking(null)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="field">
            <label htmlFor="reason">Reason</label>
            <input id="reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="actions">
            <button type="submit">{pending ? "Working" : "Send request"}</button>
          </div>
          <Alert>{error}</Alert>
        </form>
      </Dialog>
    </div>
  );
}

const STATES = [
  "held", "requested", "accepted", "confirmed", "declined", "expired", "withdrawn",
  "cancelled_by_passenger", "cancelled_by_driver", "completed", "rated",
] as const;

export function NetworkPage(): ReactElement | null {
  const { ready, allowed } = useFounder();
  const [outbox, setOutbox] = useState<OutboxItem[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const [mail, states] = await Promise.all([
      api<{ items: OutboxItem[] }>("GET", "/api/founder/outbox"),
      api<{ counts: Record<string, number> }>("GET", "/api/founder/bookings-by-state"),
    ]);
    setOutbox(mail.items);
    setCounts(states.counts);
  }, []);

  useEffect(() => {
    if (!allowed) return undefined;
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [allowed, load]);

  useLive({
    onEvent: (event) => {
      if (allowed && (event.type === "hello" || event.type === "clock")) void load();
    },
  });

  if (!ready) return null;
  if (!allowed) {
    return (
      <div>
        <PageHeading>Network</PageHeading>
        <p>{NO_ACCESS}</p>
      </div>
    );
  }

  return (
    <div className="network-page">
      <PageHeading>Network</PageHeading>
      {outbox === null ? <Skeleton rows={3} /> : (
      <>
      <h2>Outbox</h2>
      <table aria-label="Outbox" className="data-table">
        <thead>
          <tr>
            {["Kind", "To", "Subject", "Status", "Attempts", "Last attempt"].map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outbox.map((item) => (
            <tr key={item.id} data-id={item.id}>
              <td data-label="Kind">{item.kind}</td>
              <td data-label="To">{item.to}</td>
              <td data-label="Subject">{item.subject}</td>
              <td data-label="Status">{item.status}</td>
              <td data-label="Attempts">{item.attempts}</td>
              <td data-label="Last attempt">{item.last_attempt_at ? `${shortDate(new Date(item.last_attempt_at))}, ${hhmm(new Date(item.last_attempt_at))}` : "None yet"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Bookings by state</h2>
      <table aria-label="Bookings by state" className="data-table">
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Bookings</th>
          </tr>
        </thead>
        <tbody>
          {STATES.map((state) => (
            <tr key={state}>
              <td data-label="State">{state.replace(/_/g, " ")}</td>
              <td data-label="Bookings">{counts[state] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </>
      )}
    </div>
  );
}
