// The ticket spike: the member's bookings as kitchen order tickets, newest on top.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Booking, Site } from "../shared/api.ts";
import { hoursText, STATUS_WORDS } from "../shared/format.ts";
import { EmptyState, prefersReducedMotion } from "./ui.tsx";

interface SpikeProps {
  tickets: Booking[];
  sites: Site[];
  userId: string;
  onCancel: (booking: Booking) => void;
  ticketRef: (id: string, element: HTMLLIElement | null) => void;
}

/**
 * Tickets made on this screen sit on top in the order they were spiked (`placed`, newest first); the rest follow
 * newest first, a series' occurrences sharing a creation instant with the earliest occurrence on top.
 */
export function spikeOrder(list: Booking[], placed: readonly string[]): Booking[] {
  const rank = (b: Booking): number => {
    const at = placed.indexOf(b.id);
    return at === -1 ? placed.length : at;
  };
  return [...list].sort(
    (a, b) =>
      rank(a) - rank(b) || (a.created_at === b.created_at ? a.date.localeCompare(b.date) : b.created_at.localeCompare(a.created_at)),
  );
}

function TornEdge(): ReactNode {
  const teeth = 24;
  const points = ["0,0"];
  for (let i = 0; i < teeth; i++) points.push(`${((i + 0.5) / teeth) * 100},8`, `${((i + 1) / teeth) * 100},0`);
  return (
    <svg className="torn" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={points.join(" ")} />
    </svg>
  );
}

export function Spike({ tickets, sites, userId, onCancel, ticketRef }: SpikeProps): ReactNode {
  const list = useRef<HTMLUListElement>(null);
  const positions = useRef(new Map<string, number>());
  const seen = useRef<Set<string> | null>(null);

  // New tickets drop onto the spike while the others shift down (FLIP on transform only).
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const next = new Map<string, number>();
    const reduced = prefersReducedMotion();
    for (const item of root.querySelectorAll<HTMLLIElement>("li[data-id]")) {
      const id = item.dataset.id ?? "";
      const top = item.getBoundingClientRect().top;
      next.set(id, top);
      if (reduced || seen.current === null) continue;
      const before = positions.current.get(id);
      if (!seen.current.has(id)) {
        item.animate([{ transform: "translateY(-12px)", opacity: 0 }, { transform: "none", opacity: 1 }], {
          duration: 400,
          easing: "cubic-bezier(.2,0,0,1)",
        });
      } else if (before !== undefined && before !== top) {
        item.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], { duration: 400, easing: "cubic-bezier(.2,0,0,1)" });
      }
    }
    positions.current = next;
    seen.current = new Set(next.keys());
  }, [tickets]);

  return (
    <section className="spike" aria-labelledby="spike-title">
      <h2 id="spike-title">Tickets</h2>
      <div className="spike-rods" aria-hidden="true">
        {[0, 1].map((column) => (
          <svg key={column} className="spike-rod" viewBox="0 0 40 44">
            <path d="M20 2 L20 44" />
            <circle cx="20" cy="4" r="3" />
          </svg>
        ))}
      </div>
      {tickets.length === 0 && <EmptyState drawing="spike">No tickets yet. Drag on a dial to claim station time.</EmptyState>}
      <ul ref={list} role="list" aria-label="Tickets" className="tickets">
        {tickets.map((b) => {
          const site = sites.find((s) => s.id === b.site_id);
          const byOther = b.cancelled_by !== null && b.cancelled_by.user_id !== userId;
          return (
            <li key={b.id} data-id={b.id} ref={(element) => ticketRef(b.id, element)} tabIndex={0} className={`ticket ticket-${b.status}`}>
              <span className="ticket-hole" aria-hidden="true" />
              <p className="ticket-ref mono">{b.reference}</p>
              <p className="ticket-station">{b.station_name}</p>
              <p className="ticket-site">{site?.name ?? ""}</p>
              <p className="ticket-when mono">
                {b.date} {b.start}–{b.end}
              </p>
              <p className="ticket-hours mono">{hoursText(b.hours)} h</p>
              <p className={`stamp stamp-${b.status}`}>{STATUS_WORDS[b.status]}</p>
              {byOther && b.cancelled_by && <p className="ticket-by">Cancelled by {b.cancelled_by.name}</p>}
              {(b.status === "held" || b.status === "confirmed") && (
                <button type="button" className="button button-small" onClick={() => onCancel(b)}>
                  Cancel booking
                </button>
              )}
              <TornEdge />
            </li>
          );
        })}
      </ul>
      {tickets.length > 0 && (
        <svg className="spike-base" viewBox="0 0 120 14" aria-hidden="true">
          <path d="M60 0 V6" />
          <rect x="4" y="6" width="112" height="7" rx="1" />
        </svg>
      )}
    </section>
  );
}
