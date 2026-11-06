// Small pieces every screen uses: loading data on open, and table cells that stack into cards when narrow.

import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Booking } from "../../shared/api.js";
import { addDays, shortDate } from "../../shared/zone.js";
import { get } from "../api.js";

const RECENT_BEFORE = 33;
const RECENT_AFTER = 28;

/** Loads data when the screen opens and whenever a dependency changes; reload() after every action. */
export function useData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; failed: unknown; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const seq = useRef(0);
  const reload = async () => {
    const mine = ++seq.current;
    try {
      const value = await load();
      if (mine !== seq.current) return;
      setData(value);
      setFailed(null);
    } catch (error) {
      if (mine === seq.current) setFailed(error);
    }
  };
  useLayoutEffect(() => {
    void reload();
  }, deps);
  return { data, failed, reload };
}

export function Cell({ label, children, numeric }: { label: string; children: ComponentChildren; numeric?: boolean }) {
  return (
    <td data-label={label} class={numeric ? "num" : undefined}>
      {children}{" "}
    </td>
  );
}

export function EmptyRow({ columns, children }: { columns: number; children: ComponentChildren }) {
  return (
    <tr class="table__empty">
      <td colSpan={columns}>{children}</td>
    </tr>
  );
}

export function ScreenHead({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <header class="screen-head">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

/** The kitchen-local date of a server instant, which carries the kitchen's offset. */
export function instantDate(instant: string): string {
  return instant.slice(0, 10);
}

/** Readable names for the bookings a ledger mentions, from the widest booking range the API serves. */
export function useBookingNames(today: string): (bookingId: string) => string {
  const recent = useData(() => get<{ bookings: Booking[] }>(`/api/bookings?from=${addDays(today, -RECENT_BEFORE)}&to=${addDays(today, RECENT_AFTER)}`), [today]);
  return (bookingId) => {
    const booking = recent.data?.bookings.find((b) => b.id === bookingId);
    return booking ? `${booking.station_name} · ${shortDate(booking.date)} ${booking.start}–${booking.end}` : `Booking ${bookingId.slice(0, 12)}…`;
  };
}
