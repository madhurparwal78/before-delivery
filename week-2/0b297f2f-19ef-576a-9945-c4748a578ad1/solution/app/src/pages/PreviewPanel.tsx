import { useEffect, useState } from "react";
import { request } from "../api";
import { FIELD_MESSAGES, say } from "../copy";
import { countdownText } from "../format";
import { setQuery } from "../router";
import { isFailure, useStore } from "../store";
import { Button } from "../ui/Button";
import { focusWhenReady } from "../ui/focus";
import type { Preview } from "../types";

const STATUS_WORD = { draft: "Draft", scheduled: "Scheduled", published: "Live", withdrawn: "Withdrawn" } as const;
const DELIVERY = { sent: "Sent", queued: "Waiting for mail relay", cancelled: "Not sent" } as const;

export function focusPreviewHeading(): void {
  focusWhenReady(() => document.getElementById("preview-heading"));
}

/** The lender preview: status and times only from the server; the countdown from its remainingMs. */
export function PreviewPanel() {
  const store = useStore();
  const state = store.preview;
  const curator = store.staff?.role === "curator";
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0);
  const scheduled = state?.preview.status === "scheduled";

  useEffect(() => {
    if (!scheduled) return;
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [scheduled]);

  const act = async (verb: "schedule" | "cancel" | "withdraw") => {
    if (busy) return;
    setBusy(verb);
    try {
      const data = await request<{ preview: Preview }>("POST", `/api/preview/${verb}`, verb === "schedule" ? { date } : undefined);
      store.putPreview(data.preview);
      setError("");
      store.announce(
        verb === "schedule" ? say.scheduled(data.preview.publishAtDisplay ?? "") : verb === "cancel" ? say.cancelled : say.withdrawn,
      );
      setQuery({ panel: "preview" });
      focusPreviewHeading();
    } catch (failure) {
      if (isFailure(failure) && failure.fields.date) {
        setError(failure.fields.date);
        store.announce(failure.fields.date);
        focusWhenReady(() => document.getElementById("preview-date"));
      } else if (isFailure(failure)) {
        store.announce(failure.message);
        if (failure.code === "preview_conflict") void store.refresh(["preview"]);
      }
    } finally {
      setBusy(null);
    }
  };

  const preview = state?.preview;
  let countdown = "";
  if (preview && scheduled && preview.remainingMs !== null) {
    const left = Math.ceil((preview.remainingMs - (performance.now() - state.syncedAt)) / 1000);
    countdown = left > 0 ? `Publishes in ${countdownText(left)}` : "Publishing now";
  }
  const canSchedule = curator && (preview?.status === "draft" || preview?.status === "withdrawn");

  return (
    <section aria-label="Lender preview" className="preview-panel">
      <h2 id="preview-heading" tabIndex={-1}>
        Lender preview
      </h2>
      {!preview ? (
        <p className="muted">Loading the preview…</p>
      ) : (
        <>
          <p className={`preview-status preview-${preview.status}`}>
            <span className="status-dot" aria-hidden="true" />
            {STATUS_WORD[preview.status]}
          </p>
          {preview.status === "scheduled" && (
            <>
              <p>Publishes {preview.publishAtDisplay}</p>
              <p className="countdown num">{countdown}</p>
            </>
          )}
          {preview.status === "published" && <p>Published {preview.publishedAtDisplay}</p>}
          {preview.status === "withdrawn" && <p>Withdrawn {preview.withdrawnAtDisplay}</p>}
          {canSchedule && (
            <div className="field">
              <label htmlFor="preview-date">Preview date</label>
              <p className="hint" id="preview-date-hint">
                Publishes at 09:00 Europe/London time on the date you choose.
              </p>
              <input
                id="preview-date"
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                autoComplete="off"
                value={date}
                aria-invalid={error ? true : undefined}
                aria-describedby={`preview-date-hint${error ? " preview-date-error" : ""}`}
                onChange={(e) => setDate(e.target.value)}
              />
              {error && (
                <p className="field-error" id="preview-date-error">
                  {error}
                </p>
              )}
              <Button
                tone="primary"
                busy={busy === "schedule"}
                onClick={() => {
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
                    setError(FIELD_MESSAGES.badDate);
                    store.announce(FIELD_MESSAGES.badDate);
                    focusWhenReady(() => document.getElementById("preview-date"));
                    return;
                  }
                  void act("schedule");
                }}
              >
                Schedule preview
              </Button>
            </div>
          )}
          {curator && preview.status === "scheduled" && (
            <Button busy={busy === "cancel"} onClick={() => void act("cancel")}>
              Cancel schedule
            </Button>
          )}
          {curator && preview.status === "published" && (
            <Button busy={busy === "withdraw"} onClick={() => void act("withdraw")}>
              Withdraw preview
            </Button>
          )}
          {preview.recipients.length > 0 && (
            <>
              <h3 className="recipients-title" id="recipients-title">
                Recipients
              </h3>
              <ul aria-label="Recipients" className="recipients">
                {preview.recipients.map((r) => (
                  <li key={r.lenderId}>
                    <span className={`delivery delivery-${r.delivery}`} aria-hidden="true" />
                    {`${r.lenderName}: ${DELIVERY[r.delivery]}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
