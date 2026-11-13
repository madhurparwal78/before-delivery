// The reviewer's page: one engagement's current milestone stills, accept, or request a revision round.
import { useEffect, useRef, useState } from "preact/hooks";
import { api, newKey } from "../api";
import { Dialog } from "../components/Dialog";
import { Field } from "../components/Forms";
import { Shell } from "../components/Shell";
import { MILESTONE_LABELS } from "../../shared/format";
import { NotFound } from "./Public";

type Review = {
  reference: string;
  brand_name: string;
  milestone: "look_dev" | "final_delivery";
  state: string;
  revision_rounds_used: number;
  revision_rounds_included: number;
  actions_open: boolean;
  stills: { id: string; shot_code: string; title: string; url: string }[];
};
type Outcome = { kind: "accepted" } | { kind: "revision"; round: number; changeOrder: boolean };

export function ReviewPage({ token }: { token: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [missing, setMissing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [enlarged, setEnlarged] = useState<Review["stills"][number] | null>(null);
  const key = useRef("");
  const opener = useRef<HTMLButtonElement>(null);
  const enlargedFrom = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void api<Review>("GET", `/api/review/${token}`).then((reply) => {
      if (reply.ok) setReview(reply.data);
      else setMissing(true);
    });
  }, [token]);
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setEnlarged(null);
      enlargedFrom.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enlarged]);

  if (missing) return <NotFound />;
  if (!review)
    return (
      <Shell>
        <div class="wrap page">
          <div class="skeleton" aria-hidden="true" />
        </div>
      </Shell>
    );
  const label = MILESTONE_LABELS[review.milestone];

  const accept = async (): Promise<void> => {
    const reply = await api<Review>("POST", `/api/review/${token}/accept`, {});
    if (reply.ok) {
      setReview(reply.data);
      setOutcome({ kind: "accepted" });
    } else setError(reply.failure.message);
  };
  const openRequest = (): void => {
    key.current = newKey();
    setNote("");
    setNoteError(undefined);
    setAsking(true);
  };
  const closeRequest = (): void => {
    setAsking(false);
    opener.current?.focus();
  };
  const send = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    const reply = await api<{ review: Review; round: number; change_order: boolean }>("POST", `/api/review/${token}/revisions`, { note }, { "Idempotency-Key": key.current });
    setSending(false);
    if (reply.ok) {
      setAsking(false);
      setReview(reply.data.review);
      setOutcome({ kind: "revision", round: reply.data.round, changeOrder: reply.data.change_order });
    } else if (reply.failure.fields?.note) setNoteError(reply.failure.fields.note);
    else {
      setAsking(false);
      setError(reply.failure.message);
    }
  };

  return (
    <Shell>
      <div class="wrap page">
        <h1>
          {review.reference} · {label} review
        </h1>
        <p class="meta-line">
          <span>{review.brand_name}</span>
          <span>
            Revision rounds used: {review.revision_rounds_used} of {review.revision_rounds_included}
          </span>
        </p>
        {outcome?.kind === "accepted" && (
          <div class="success notice">
            <h2>Milestone accepted</h2>
            <p>Thank you. The studio will be in touch about the next step.</p>
          </div>
        )}
        {outcome?.kind === "revision" && (
          <div class="success notice">
            <h2>Revision requested</h2>
            <p>{outcome.round <= 2 ? `Round ${outcome.round} of 2 included.` : `Round ${outcome.round}. This round adds a change order to this milestone's invoice.`}</p>
          </div>
        )}
        {error && (
          <p class="notice" role="alert">
            {error}
          </p>
        )}
        <ul class="stills-grid" aria-label="Stills">
          {review.stills.map((still) => (
            <li key={still.id}>
              <img
                src={still.url}
                alt={`${still.title} still`}
                loading="lazy"
                referrerpolicy="no-referrer"
                onClick={(event) => {
                  enlargedFrom.current = event.currentTarget.parentElement?.querySelector("button") ?? null;
                  setEnlarged(still);
                }}
              />
              <p class="still-caption">
                {still.title}
                <button
                  type="button"
                  class="button quiet"
                  onClick={(event) => {
                    enlargedFrom.current = event.currentTarget;
                    setEnlarged(still);
                  }}
                >
                  View larger
                </button>
              </p>
            </li>
          ))}
        </ul>
        {review.actions_open && !outcome ? (
          <div class="review-actions">
            <button type="button" class="button primary" onClick={() => void accept()}>
              {review.milestone === "look_dev" ? "Accept look-dev" : "Accept final delivery"}
            </button>
            <button type="button" class="button" ref={opener} onClick={openRequest}>
              Request a revision
            </button>
          </div>
        ) : (
          !outcome && <p class="muted">This milestone isn't open for review right now. The studio will send a new link when it is.</p>
        )}
      </div>
      {enlarged && (
        <div class="lightbox" role="dialog" aria-modal="true" aria-label={`${enlarged.title} still, enlarged`} onClick={() => setEnlarged(null)}>
          <img src={enlarged.url} alt={`${enlarged.title} still`} referrerpolicy="no-referrer" />
        </div>
      )}
      {asking && (
        <Dialog title="Request a revision" onClose={closeRequest}>
          <form noValidate onSubmit={send}>
            <Field id="revision-note" label="What should change?" value={note} onInput={setNote} error={noteError} multiline />
            <div class="actions">
              <button type="submit" class="button primary" aria-busy={sending ? "true" : "false"}>
                {sending ? "Sending" : "Send request"}
              </button>
              <button type="button" class="button" onClick={closeRequest}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </Shell>
  );
}
