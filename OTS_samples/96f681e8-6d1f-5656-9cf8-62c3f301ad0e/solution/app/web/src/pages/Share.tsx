import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnounce } from "../announce";
import { ApiError, RequestKey, call, messageOf } from "../api";
import { ErrorBand } from "../components/Feedback";
import { clubDate, clubTime, euros, clubDateTime } from "../format";
import { NotFound } from "./NotFound";

interface ShareCard {
  token: string;
  amount_cents: number;
  status: "due" | "paid" | "void" | "covered";
  court: number;
  start: string;
  minutes: number;
  organiser_name: string;
  kind: "booking" | "lesson";
  settle_at: string | null;
}

const statusWords = { due: "Due", paid: "Paid", void: "Void", covered: "Covered" } as const;
const statusCopy = {
  paid: "You have paid your share. Thank you.",
  covered: "This share was covered by the organiser.",
  void: "This share is no longer due.",
} as const;

export function Share({ token }: { token: string }) {
  const announce = useAnnounce();
  const [card, setCard] = useState<ShareCard | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payKey = useRef(new RequestKey());

  const load = useCallback(async () => {
    try {
      setCard(await call<ShareCard>(`/api/shares/${encodeURIComponent(token)}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setError(messageOf(e));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = async () => {
    setPending(true);
    setError(null);
    try {
      const paid = await call<ShareCard>(`/api/shares/${encodeURIComponent(token)}/pay`, { method: "POST", key: payKey.current.for(token), body: {} });
      payKey.current.settle(null);
      setCard(paid);
      announce("Payment received.");
    } catch (e) {
      payKey.current.settle(e);
      setError(messageOf(e));
      if (e instanceof ApiError && (e.code === "SHARE_SETTLED" || e.code === "SHARE_VOID")) await load();
    } finally {
      setPending(false);
    }
  };

  if (missing) return <NotFound />;
  return (
    <div className="page">
      <div className="column column--narrow">
        <article className="card share-card">
          <h1 className="page__title">Your share</h1>
          {!card && !error && <p className="muted">Loading…</p>}
          {card && (
            <>
              <p className="share-card__amount">
                {euros(card.amount_cents)} for Court {card.court}, {clubDate(card.start)} {clubTime(card.start)}
              </p>
              <p className="muted">
                {card.kind === "lesson" ? `A lesson block with ${card.organiser_name}.` : `Booked by ${card.organiser_name}.`}
              </p>
              {card.settle_at && (
                <p>
                  Pay before <strong>{clubDateTime(card.settle_at)}</strong>. After that the organiser&apos;s card covers any share still unpaid.
                </p>
              )}
              {card.status === "due" ? (
                <>
                  {error && <ErrorBand>{error}</ErrorBand>}
                  <button type="button" className="pill pill--cobalt" disabled={pending} onClick={() => void pay()}>
                    {pending ? "Paying..." : "Pay my share"}
                  </button>
                </>
              ) : (
                <>
                  <p>
                    <span className={`status-word status-word--${card.status}`}>{statusWords[card.status]}</span>
                  </p>
                  <p>{statusCopy[card.status]}</p>
                  {error && <ErrorBand>{error}</ErrorBand>}
                </>
              )}
            </>
          )}
          {!card && error && <ErrorBand>{error}</ErrorBand>}
        </article>
      </div>
    </div>
  );
}
