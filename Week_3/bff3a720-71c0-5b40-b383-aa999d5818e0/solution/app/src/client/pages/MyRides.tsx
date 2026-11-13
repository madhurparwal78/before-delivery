import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { Booking, Ride } from "../../shared/api";
import { plural } from "../../shared/money";
import { shortDateTime } from "../../shared/time";
import { STATUS } from "../lib/format";
import { api } from "../lib/http";
import { useLive } from "../lib/live";
import { Link, replaceQuery, useLocation } from "../lib/router";
import { useRequireMember } from "../lib/useRequireSignIn";
import { EmptyState, PageHeading, Skeleton } from "../ui/Bits";
import { Plate } from "../ui/Plate";

type Tab = "upcoming" | "past";
const TABS: readonly Tab[] = ["upcoming", "past"];

export function MyRidesPage(): ReactElement | null {
  const member = useRequireMember();
  const { search } = useLocation();
  const tab: Tab = search.get("tab") === "past" ? "past" : "upcoming";
  const [data, setData] = useState<{ tab: Tab; bookings: Booking[]; rides: Ride[] } | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const tabButtons = useRef<Record<Tab, HTMLButtonElement | null>>({ upcoming: null, past: null });

  const load = useCallback(async () => {
    const reply = await api<{ bookings: Booking[]; rides: Ride[] }>("GET", `/api/me/bookings?tab=${tab}`);
    setData({ tab, ...reply });
  }, [tab]);

  useEffect(() => {
    if (member) void load();
  }, [member, load]);

  useLive({
    onEvent: (event) => {
      if (event.type === "hello" || event.type === "booking" || event.type === "ride" || event.type === "clock") void load();
    },
  });

  if (!member) return null;

  const select = (next: Tab, focus = false): void => {
    replaceQuery(new URLSearchParams({ tab: next }));
    if (focus) tabButtons.current[next]?.focus();
  };

  const entries =
    data && data.tab === tab
      ? [
          ...data.bookings.map((b) => ({
            id: b.id,
            at: new Date(b.boarding_time),
            href: `/bookings/${b.id}`,
            text: `${shortDateTime(new Date(b.boarding_time))}, ${b.boarding} to ${b.alighting}, ${plural(b.seats, "seat")}, ${STATUS[b.state].toLowerCase()}`,
          })),
          ...data.rides.map((r) => {
            const first = r.stops[0]!;
            const end = r.stops[r.stops.length - 1]!;
            return {
              id: r.id,
              at: new Date(first.time),
              href: `/rides/${r.id}`,
              text: `${shortDateTime(new Date(first.time))}, ${first.city} to ${end.city}, you drive`,
            };
          }),
        ].sort((a, b) => (tab === "upcoming" ? a.at.getTime() - b.at.getTime() : b.at.getTime() - a.at.getTime()))
      : null;

  return (
    <div className="my-rides">
      <PageHeading>My rides</PageHeading>
      <div role="tablist" aria-label="My rides" className="tabs">
        {TABS.map((name) => (
          <button
            key={name}
            ref={(node) => {
              tabButtons.current[name] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${name}`}
            aria-selected={tab === name}
            aria-controls="my-rides-panel"
            tabIndex={tab === name ? 0 : -1}
            onClick={() => select(name)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                select(name === "upcoming" ? "past" : "upcoming", true);
              }
            }}
          >
            {name === "upcoming" ? "Upcoming" : "Past"}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="my-rides-panel"
        aria-labelledby={`tab-${tab}`}
        className="tab-panel"
        onTouchStart={(event) => {
          const point = event.touches[0];
          touch.current = point ? { x: point.clientX, y: point.clientY } : null;
          last.current = touch.current;
        }}
        onTouchMove={(event) => {
          const point = event.touches[0];
          if (point) last.current = { x: point.clientX, y: point.clientY };
        }}
        onTouchEnd={() => {
          const start = touch.current;
          const end = last.current;
          touch.current = null;
          if (!start || !end) return;
          const dx = end.x - start.x;
          if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(end.y - start.y)) {
            if (dx < 0 && tab === "upcoming") select("past");
            else if (dx > 0 && tab === "past") select("upcoming");
          }
        }}
      >
        {entries && entries.length === 0 ? (
          <EmptyState
            sentence={tab === "upcoming" ? "No upcoming trips." : "No past trips yet."}
            seed={`my-rides-${tab}`}
          />
        ) : null}
        {entries === null ? <Skeleton rows={4} /> : null}
        {entries && entries.length > 0 ? (
          <div className="listing listing-right">
            <ul className="entries">
              {entries.map((entry) => (
                <li key={entry.id} data-id={entry.id}>
                  <Link href={entry.href}>{entry.text}</Link>
                </li>
              ))}
            </ul>
            <Plate seed={`my-rides-${tab}`} ratio={0.8} caption="Kestrevel to Brisanne, the road out of town" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
