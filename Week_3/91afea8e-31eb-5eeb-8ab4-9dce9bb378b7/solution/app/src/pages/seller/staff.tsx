import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Empty } from "../../components/Empty";
import { NotFound } from "../../components/NotFound";
import { ApiFailure, failureMessage, get } from "../../lib/api";
import { signInHref, useAuth } from "../../lib/auth";
import type { Role } from "../../lib/types";
import "../../styles/seller.css";

export interface ListingItem {
  listing_id: string;
  product_id: string;
  title: string;
  category: string;
  price_paise: number;
  cost_price_paise: number;
  stock: number;
  status: "live" | "unlisted";
  photo_count: number;
  cod_allowed: boolean;
  no_cost_emi: boolean;
  description: string;
  return_note: string;
  photos: { photo_id: string; url: string }[];
}

export function Loading(): ReactNode {
  return (
    <div className="panel panel--ground" aria-busy="true">
      <div className="skeleton" style={{ minHeight: 320 }} />
    </div>
  );
}

/** Staff screens: a signed-out visitor goes to sign-in and comes back; anyone with another role gets the not-found panel. */
export function StaffGate({ role, children }: { role: Extract<Role, "seller" | "support">; children: ReactNode }): ReactNode {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <Loading />;
  if (auth.status === "signedOut") return <Navigate to={signInHref(`${location.pathname}${location.search}`)} replace />;
  if (auth.account?.role !== role) return <NotFound />;
  return children;
}

type Resource<T> = { phase: "loading" } | { phase: "ready"; data: T } | { phase: "failed"; status: number; message: string };

interface Loaded<T> {
  resource: Resource<T>;
  /** Replace the loaded data in place without a new request. */
  update: (change: (data: T) => T) => void;
  reload: () => void;
}

/** One GET, painted only when it is the newest request for the path. */
export function useResource<T>(path: string): Loaded<T> {
  const [resource, setResource] = useState<Resource<T>>({ phase: "loading" });
  const newest = useRef(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const mine = ++newest.current;
    get<T>(path).then(
      (data) => {
        if (mine === newest.current) setResource({ phase: "ready", data });
      },
      (error: unknown) => {
        if (mine === newest.current) setResource({ phase: "failed", status: error instanceof ApiFailure ? error.status : 0, message: failureMessage(error) });
      },
    );
  }, [path, attempt]);

  const update = useCallback((change: (data: T) => T): void => {
    setResource((current) => (current.phase === "ready" ? { phase: "ready", data: change(current.data) } : current));
  }, []);
  const reload = useCallback((): void => setAttempt((count) => count + 1), []);
  return { resource, update, reload };
}

export function Failure({ status, message }: { status: number; message: string }): ReactNode {
  if (status === 403 || status === 404) return <NotFound />;
  return (
    <Empty tone="pink" sign="lost">
      {message}
    </Empty>
  );
}

/** Whole rupees or rupees and paise as typed, to whole paise without floating point. Anything else goes to the server as typed. */
export function toPaise(text: string): number | string {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return text.trim();
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function wholeNumber(text: string): number | string {
  return /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : text.trim();
}

export function paiseText(paise: number): string {
  return `${Math.floor(paise / 100)}${paise % 100 === 0 ? "" : `.${String(paise % 100).padStart(2, "0")}`}`;
}
