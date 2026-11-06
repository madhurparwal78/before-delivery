// The Alerts region: one card per alert that is not Closed. Refreshes never move focus or replay a card's
// entrance; after an acknowledgement focus moves to the next card below with an Acknowledge button.
import { useLayoutEffect, useRef, useState } from "react";
import { api, NoResponse, Stale, type Alert } from "../api";
import { reducedMotion } from "../hooks";
import { useSession } from "../session";
import { hms, position as formatPosition } from "../units";

const ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const hasButton = (a: Alert) => a.state === "Active" || a.state === "Rectified";

interface Props {
  alerts: Alert[];
  loaded: boolean;
  announce: (text: string) => void;
  applyAlert: (alert: Alert) => void;
}

export function AlertsRegion({ alerts, loaded, announce, applyAlert }: Props) {
  const { user } = useSession();
  const region = useRef<HTMLElement>(null);
  const known = useRef<Set<string> | null>(null);
  const focusNext = useRef<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!loaded) return;
    const first = known.current === null;
    const seen = known.current ?? new Set<string>();
    for (const a of alerts) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      if (first || reducedMotion()) continue;
      region.current?.querySelector(`[data-alert="${a.id}"]`)?.animate(
        [{ transform: "translateY(-8px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
        { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
    known.current = seen;
    const target = focusNext.current;
    if (target) {
      focusNext.current = null;
      const el = target === "region" ? region.current : region.current?.querySelector<HTMLElement>(target);
      (el ?? region.current)?.focus();
    }
  }, [alerts, loaded]);

  const acknowledge = async (alert: Alert) => {
    if (pending) return;
    setPending(alert.id);
    announce("Acknowledging");
    try {
      const result = await api<Alert>(`/api/alerts/${alert.id}/ack`, { method: "POST", body: {} });
      if (!result.ok) {
        announce(result.error?.message ?? "Alert not acknowledged");
        return;
      }
      const index = alerts.findIndex((a) => a.id === alert.id);
      const below = alerts.slice(index + 1).find(hasButton);
      const above = [...alerts.slice(0, Math.max(0, index))].reverse().find(hasButton);
      const next = below ?? above;
      focusNext.current = next ? `[data-ack="${next.id}"]` : result.data.state !== "Closed" ? `[data-state="${alert.id}"]` : "region";
      applyAlert(result.data);
      announce("Alert acknowledged");
    } catch (error) {
      if (error instanceof Stale) return;
      if (error instanceof NoResponse) announce("Could not reach Swathdeck — the alert is not acknowledged yet");
      else throw error;
    } finally {
      setPending(null);
    }
  };

  const staff = user.role !== "client_reviewer";
  return (
    <section ref={region} className="alerts" aria-labelledby="alerts-heading" tabIndex={-1}>
      <h2 id="alerts-heading">Alerts</h2>
      {loaded && !alerts.length && <p className="empty-note">No open alerts.</p>}
      <ol>
        {alerts.map((a) => (
          <li key={a.id}>
            <article className="alert-card" data-alert={a.id} aria-labelledby={`alert-${a.id}`}>
              <h3 id={`alert-${a.id}`}>{ICON}{a.heading}</h3>
              <p className="state-line" tabIndex={-1} data-state={a.id}>{a.state}</p>
              {a.state === "Acknowledged" && a.acknowledged_at && <p>Acknowledged by {a.acknowledged_by} at <span className="num">{hms(a.acknowledged_at)}</span> UTC</p>}
              {a.state === "Rectified" && a.rectified_at && <p>Rectified at <span className="num">{hms(a.rectified_at)}</span> UTC</p>}
              <p className="muted">Raised <span className="num">{hms(a.raised_at)}</span> UTC</p>
              {a.position && <p className="num">{formatPosition(a.position, user.units)}</p>}
              <p className="muted">{a.email === "Emailed" ? "Emailed" : "Email queued"}</p>
              {staff && hasButton(a) && (
                <button type="button" data-ack={a.id} aria-label={`Acknowledge ${a.heading}`} onClick={() => void acknowledge(a)}>
                  Acknowledge
                </button>
              )}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
