import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api, ApiFailure } from "../lib/api";
import { navigate } from "../lib/router";
import type { OrderStatus } from "../lib/types";

// Pieces every back-office page shares: reading server data, failures, and small drawings.

/** Narrows a failed call to the published error shape; an ended session goes back to sign-in. */
export function failureOf(error: unknown): ApiFailure {
  if (!(error instanceof ApiFailure)) throw error;
  if (error.status === 401) navigate(`/sign-in?next=${window.location.pathname}`, true);
  return error;
}

interface OfficeData<T> {
  data: T | null;
  setData: Dispatch<SetStateAction<T | null>>;
  failure: ApiFailure | null;
  reload: () => Promise<void>;
}

/** A page's server data, read on mount and then every `everyMs` milliseconds when given. */
export function useOfficeData<T>(path: string, everyMs?: number): OfficeData<T> {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<T>("GET", path));
      setFailure(null);
    } catch (error) {
      setFailure(failureOf(error));
    }
  }, [path]);
  useEffect(() => {
    void reload();
    if (!everyMs) return;
    const timer = setInterval(() => void reload(), everyMs);
    return () => clearInterval(timer);
  }, [reload, everyMs]);
  return { data, setData, failure, reload };
}

export function RoleDenied() {
  return <p className="panel office-note">Your role can't open this page.</p>;
}

/** What a page shows when its data can't be read. */
export function PageFailure({ failure }: { failure: ApiFailure }) {
  return failure.status === 403 ? <RoleDenied /> : <p className="panel office-note">{failure.message}</p>;
}

export function Loading() {
  return (
    <div className="office-loading" aria-hidden="true">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

/** A small open crate with one leaf, for empty lists. */
export function EmptyCrate() {
  return (
    <svg className="empty-drawing" viewBox="0 0 96 72" width="96" height="72" aria-hidden="true" focusable="false">
      <path d="M10 30h76l-6 34H16z" fill="var(--paper-deep)" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M22 30v34M38 30v34M58 30v34M74 30v34" stroke="var(--ink-muted)" strokeWidth="1.5" />
      <path d="M10 30l8-10h60l8 10" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M48 20c10-14 24-14 30-12-4 10-16 16-30 12z" fill="var(--leaf-soft)" stroke="var(--leaf)" strokeWidth="1.5" />
      <path d="M48 20c10-4 18-8 26-11" fill="none" stroke="var(--leaf)" strokeWidth="1.2" />
    </svg>
  );
}

const STATUS_WORDS: Record<OrderStatus, string> = {
  pending_payment: "Pending payment",
  paid: "Paid",
  picking: "Picking",
  packed: "Packed",
  shipped: "Shipped",
  refunded: "Refunded",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge order-status order-status-${status}`}>{STATUS_WORDS[status]}</span>;
}

/** Typed dollars (`12.34`, `$12.34`, `12`) as integer cents, by string arithmetic; null when not an amount. */
export function parseDollars(text: string): number | null {
  const found = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!found) return null;
  return Number(found[1]) * 100 + Number((found[2] ?? "").padEnd(2, "0"));
}
