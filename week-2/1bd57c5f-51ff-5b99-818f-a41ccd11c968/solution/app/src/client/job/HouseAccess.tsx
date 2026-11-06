import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { AccessCard } from "../../shared/domain";
import { useAnnounce } from "../activity";
import { ApiFailure, apiWithServerTime } from "../api";
import { COPY } from "../copy";
import { localClock, localStamp } from "../time";
import { useJob } from "./context";

/**
 * The house access region. Codes are read only on request, each read is logged by the server,
 * and shown codes go when hidden, when a refresh says they may no longer show, or — for a
 * trade — at the moment the code window closes.
 */
export function HouseAccess({ onCard }: { onCard?: (card: AccessCard) => void }) {
  const { job, role } = useJob();
  const announce = useAnnounce();
  const headingId = useId();
  const [card, setCard] = useState<(AccessCard & { remainingMs: number | null }) | null>(null);
  const [refusal, setRefusal] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!job.access_codes_available) setCard(null);
  }, [job.access_codes_available]);

  // The moment codes go is judged from the server's clock (its reply's Date header against
  // visible_until), never from the device's own clock, which may be hours off.
  useEffect(() => {
    if (card?.remainingMs === null || card?.remainingMs === undefined) return;
    const countdown = new Worker(new URL("./countdown.worker.ts", import.meta.url), { type: "module" });
    countdown.onmessage = () => setCard(null);
    countdown.postMessage(Math.max(0, card.remainingMs));
    return () => countdown.terminate();
  }, [card]);

  const show = async () => {
    setPending(true);
    setRefusal("");
    announce(COPY.saving);
    try {
      const { body: next, serverTime } = await apiWithServerTime<AccessCard>(`/api/jobs/${job.id}/access`);
      setCard({ ...next, remainingMs: next.visible_until ? Date.parse(next.visible_until) - serverTime : null });
      onCard?.(next);
      announce(role === "trade" && next.visible_until ? `Codes visible until ${localClock(next.visible_until, job.time_zone)}` : "Showing the house access codes.");
    } catch (error) {
      const message = error instanceof ApiFailure ? error.message : "Access codes need a connection.";
      setRefusal(message);
      announce(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="house-access" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title">
        House access
      </h2>
      {card ? (
        <>
          <dl className="codes">
            <dt>Lockbox</dt>
            <dd className="code">{card.lockbox_code || "—"}</dd>
            <dt>Alarm</dt>
            <dd className="code">{card.alarm_code || "—"}</dd>
            <dt>Garage</dt>
            <dd className="code">{card.garage_code || "—"}</dd>
            <dt>House note</dt>
            <dd>{card.house_note || "—"}</dd>
          </dl>
          {card.visible_until && (
            <p>
              Codes visible until <span className="mono">{localClock(card.visible_until, job.time_zone)}</span>
            </p>
          )}
          <div>
            <button type="button" className="btn" onClick={() => setCard(null)}>
              <EyeOff size={16} aria-hidden="true" />
              Hide access codes
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {role === "trade"
              ? "Codes show from 30 minutes before your site visit until it ends. Every view is logged."
              : "Every view of the codes is logged for the owner."}
          </p>
          <div>
            <button type="button" className="btn" onClick={show} disabled={pending} aria-busy={pending}>
              <Eye size={16} aria-hidden="true" />
              Show access codes
            </button>
          </div>
          {refusal && <p className="form-error">{refusal}</p>}
          {refusal && role === "trade" && job.next_visit && (
            <p>
              Next visit: <span className="mono">{localStamp(job.next_visit.starts_at)}</span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
