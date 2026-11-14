import { useLayoutEffect, useRef } from "preact/hooks";
import type { AlertView } from "../../shared/wire.ts";
import { Link } from "../router.tsx";
import { ALERT_MS, EASE, mark } from "../markers.ts";
import { useRoom } from "./room.tsx";

export function Announcers({ urgent, polite }: { urgent: string; polite: string }) {
  return (
    <div class="sr-only">
      <div role="alert" aria-label="Urgent alerts" aria-live="assertive">
        {urgent}
      </div>
      <div role="status" aria-label="Alert announcements" aria-live="polite">
        {polite}
      </div>
    </div>
  );
}

const STATE_WORD = { running: "Running", paused: "Paused", ended: "Ended" } as const;

/** The exercise state, sim clock, runway, wind and notice every session client shows. */
export function StatusBar({ sessionId, connection }: { sessionId: string; connection: "connecting" | "live" | "lost" }) {
  const { payload } = useRoom();
  return (
    <div class="status-bar">
      <div class="stat">
        <span class="stat-label">Exercise</span>
        <span role="status" aria-label="Exercise state" class="stat-value">
          {STATE_WORD[payload.status]}
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">Sim time</span>
        <span role="status" aria-label="Sim clock" aria-live="off" data-speed={payload.speed} class="stat-value tabular">
          {payload.simTime}
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">Runway</span>
        <span role="status" aria-label="Runway in use" class="stat-value">
          {payload.runwayInUse}
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">Wind</span>
        <span role="status" aria-label="Wind" class="stat-value tabular">
          {`${String(payload.wind.dir).padStart(3, "0")} at ${payload.wind.kt} kt`}
        </span>
      </div>
      <div class="stat stat-wide" data-notice={payload.notice === "" ? undefined : "true"}>
        <span class="stat-label">Notice</span>
        <span role="status" aria-label="Runway notice" class="stat-value">
          {payload.notice}
        </span>
      </div>
      {payload.status === "ended" && (
        <Link href={`/sessions/${sessionId}/debrief`} class="button-link">
          Open debrief
        </Link>
      )}
      {connection === "lost" && (
        <div class="cell-error stat-full">
          <span role="status" aria-label="Connection">
            Connection lost. Reconnecting...
          </span>
        </div>
      )}
    </div>
  );
}

export function AlertsList({ alerts }: { alerts: AlertView[] }) {
  const { reduced } = useRoom();
  const list = useRef<HTMLUListElement>(null);
  const seen = useRef<Set<number> | null>(null);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const ids = new Set(alerts.map((a) => a.id));
    if (seen.current !== null && !reduced) {
      for (const li of element.querySelectorAll<HTMLElement>("[data-alert-id]")) {
        if (seen.current.has(Number(li.dataset.alertId))) continue;
        mark(li, "data-motion", "alert", ALERT_MS);
        li.animate([{ transform: "translateX(24px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: ALERT_MS, easing: EASE });
      }
    }
    seen.current = ids;
  });
  return (
    <section class="cell alerts-cell">
      <h2>Alerts</h2>
      <ul aria-label="Alerts" class="alert-list" ref={list}>
        {alerts.map((alert, index) => (
          <li key={alert.id} data-rule={alert.rule} data-severity={alert.severity} data-alert-id={alert.id} data-live={index === 0 ? "true" : undefined}>
            {`${alert.simTime} ${alert.rule} ${alert.text}`}
          </li>
        ))}
      </ul>
      {alerts.length === 0 && <p class="empty">No alerts yet.</p>}
    </section>
  );
}
