// Shared page pieces: the stage scene per route, loading data with sign-in redirects, empty states,
// badges and the copy shown for failed actions.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AddOn, Audience, InstallationType, Size, Venue } from "../../shared/catalog";
import { CueLine } from "../components/CueLine";
import { AppLink } from "../components/Shell";
import { HttpError, call, signInHref } from "../lib/api";
import { bannerFor } from "../lib/notices";
import { currentRoute } from "../lib/router";
import { stage, type Scene } from "../stage/state";

export function useScene(scene: Scene, extra: Partial<ReturnType<typeof stage.get>> = {}): void {
  const key = JSON.stringify(extra);
  useEffect(() => {
    stage.set({ scene, ...(JSON.parse(key) as object) });
  }, [scene, key]);
}

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "missing" } | { status: "failed"; message: string };

/** Loads a resource; a signed-out caller is sent to sign in with this address as the return route. */
export function useLoad<T>(path: string | null): [Load<T>, () => Promise<void>] {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setState({ status: "ready", data: await call<T>(path) });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401 && error.code === "unauthenticated") location.assign(signInHref(currentRoute()));
      else if (error instanceof HttpError && (error.status === 404 || error.status === 403)) setState({ status: "missing" });
      else if (error instanceof HttpError && error.code !== "signed_out") setState({ status: "failed", message: failureText(error) });
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return [state, reload];
}

/** The words a failed action shows in its live region. */
export function failureText(error: unknown): string {
  if (!(error instanceof HttpError)) return "Something went wrong. Try again.";
  const banner = bannerFor(error.code);
  if (banner) return banner;
  const first = Object.values(error.errors)[0];
  return first ?? error.message ?? "Something went wrong. Try again.";
}

export interface Milestone {
  id: string | null; label: string; scheduleBp: number; state: string; subtotalCents: number; taxCents: number; amountCents: number;
  invoicedAt: string | null; dueAt: string | null; dueText: string | null; killbillInvoiceId: string | null; killbillPaymentId: string | null; documentId: string | null;
}

export interface Funder {
  id: string; kind: "client" | "sponsor"; name: string; email: string; bp: number; subtotalCents: number; taxCents: number; amountCents: number;
  state: string; inviteExpiresAt: string | null; position: number;
}

export interface LayoutItem { kind: string; x: number; y: number; rotationDeg: number }
export interface Piece { kind: string; label: string; widthM: number; depthM: number }

export interface Commission {
  id: string; title: string; state: string; installationType: InstallationType; venue: Venue;
  room: { widthM: number; depthM: number; doorWall: "front" | "back" | "left" | "right" }; audience: Audience; notes: string;
  options: { size: Size; addOns: AddOn[] };
  quote: { quoteId: string; lines: { label: string; amountCents: number }[]; subtotalCents: number; taxCents: number; totalCents: number; issuedAt: string; validUntil: string } | null;
  layout: { version: number; items: LayoutItem[] }; requiredPieces: Piece[];
  hold: { holdId: string; date: string; expiresAt: string; secondsRemaining: number; serverTime: string; status: string } | null;
  installDay: { id: string; date: string; startsAt: string; endsAt: string; crewUserIds: string[] } | null;
  milestones: Milestone[]; funders: Funder[];
  latestRender: { id: string; state: string; progress: number; previewSha256: string | null } | null;
  clientId: string; createdAt: string;
}

const STATE_WORDS: Record<string, string> = {
  briefed: "Briefed", previewed: "Previewed", placed: "Placed", held: "Held", contracted: "Contracted", concept_approved: "Concept approved",
  fabricating: "Fabricating", installed: "Installed", accepted: "Accepted", maintained: "Maintained", cancelled: "Cancelled",
  scheduled: "Scheduled", invoiced: "Invoiced", payment_pending: "Payment pending", paid: "Paid", failed: "Failed", retried: "Retried",
  lead: "Lead", invited: "Invited", revoked: "Revoked", expired: "Expired", pending: "Pending", running: "Running", done: "Done",
  stored: "Stored", preparing: "Preparing", issued: "Issued", delivered: "Delivered", retrying: "Retrying", no_endpoint: "No endpoint",
  success: "Success",
};

export function Badge({ state, on }: { state: string; on?: boolean }) {
  return <span className={`badge ${on ? "on" : ""}`}>{STATE_WORDS[state] ?? state}</span>;
}

const DRAWINGS: Record<string, ReactNode> = {
  room: <><rect x="8" y="10" width="80" height="46" fill="none" stroke="#a0a4ae" strokeWidth="1.5" /><path d="M38 56h20" stroke="#03060f" strokeWidth="3" /><path d="M38 56v-6M58 56v-6" stroke="#2271e3" strokeWidth="1.5" /><path d="M20 22h10M25 17v10" stroke="#2271e3" strokeWidth="1.5" /></>,
  tray: <><path d="M10 30h24l6 10h16l6-10h24v24H10z" fill="none" stroke="#a0a4ae" strokeWidth="1.5" /><path d="M48 8v20m-7-7 7 7 7-7" fill="none" stroke="#2271e3" strokeWidth="1.5" /></>,
  signal: <><circle cx="24" cy="44" r="4" fill="#2271e3" /><path d="M36 44a12 12 0 0 0-12-12M48 44a24 24 0 0 0-24-24M60 44a36 36 0 0 0-36-36" fill="none" stroke="#a0a4ae" strokeWidth="1.5" /><path d="M70 30h16M70 38h10" stroke="#a0a4ae" strokeWidth="1.5" /></>,
  calendar: <><rect x="18" y="10" width="60" height="46" fill="none" stroke="#a0a4ae" strokeWidth="1.5" /><path d="M18 22h60M34 6v8M62 6v8" stroke="#a0a4ae" strokeWidth="1.5" /><rect x="44" y="32" width="10" height="10" fill="none" stroke="#2271e3" strokeWidth="1.5" /></>,
  queue: <><path d="M14 18h68M14 32h68M14 46h40" stroke="#a0a4ae" strokeWidth="1.5" /><circle cx="70" cy="46" r="5" fill="none" stroke="#2271e3" strokeWidth="1.5" /></>,
};

export function Empty({ question, drawing, action }: { question: string; drawing: keyof typeof DRAWINGS; action?: ReactNode }) {
  return (
    <div className="empty">
      <svg viewBox="0 0 96 64" aria-hidden="true">{DRAWINGS[drawing]}</svg>
      <CueLine as="h2" text={question} />
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="stack" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}</div>;
}

export function Missing() {
  return (
    <main className="column">
      <Empty question="That isn't here. Back to the start?" drawing="room" action={<AppLink href="/" className="button">Back to the start</AppLink>} />
    </main>
  );
}

export function Failed({ message }: { message: string }) {
  return <main className="column"><p className="chip-note" role="alert">{message}</p></main>;
}

export function CommissionLinks({ id }: { id: string }) {
  const links: [string, string][] = [
    ["", "Overview"], ["/files", "Files"], ["/preview", "Preview"], ["/configure", "Configure"], ["/day", "Install day"],
    ["/checkout", "Checkout"], ["/webhooks", "CRM deliveries"], ["/maintenance", "Maintenance"],
  ];
  return (
    <nav aria-label="Commission" className="links-grid">
      {links.map(([suffix, label]) => <AppLink key={label} href={`/c/${id}${suffix}`}>{label}</AppLink>)}
    </nav>
  );
}

