import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Me, Role } from "../shared/types.js";
import { ROLE_LABEL, countdown, displayDate, displayInstant, dollars, groupThousands } from "../shared/format.js";
import { ApiFailure, api } from "./api.js";
import { announce, announceOnce, onAnnouncement } from "./announce.js";
import { useResource } from "./hooks.js";
import { LiveProvider, useLive, useLiveEvent } from "./live.js";
import { Link, navigate, useLocation } from "./router.js";
import { SessionContext, useSession } from "./session.js";
import { Band } from "./ui.js";
import { SignInPage } from "./pages/signin.js";
import { PortalPage } from "./pages/portal.js";
import { GrantPage, VestingPage } from "./pages/grant.js";
import { ExercisePage, ExerciseOrderPage } from "./pages/exerciseOrders.js";
import { DocumentsPage } from "./pages/documents.js";
import { CapTablePage } from "./pages/capTable.js";
import { TenderPage, TendersPage } from "./pages/tenders.js";
import { BoardPage, BoardSummaryPage } from "./pages/board.js";
import { AdminGrantFormPage, AdminGrantsPage } from "./pages/adminGrants.js";
import { LedgerPage, PeoplePage, ScenarioPage, ValuationsPage, AdminTendersPage } from "./pages/admin.js";
import { NotFoundPage } from "./pages/notFound.js";
import type { Grant } from "../shared/types.js";

const SHELL_FACES = ['600 1em "Funnel Sans"', '400 1em "Funnel Sans"', '700 1em "Funnel Display"'];

type State = { status: "loading" } | { status: "out" } | { status: "in"; me: Me } | { status: "removed" };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    // The first screen is laid out once in the bundled faces, so their arrival never re-wraps the navigation.
    const faces = Promise.allSettled(SHELL_FACES.map((face) => document.fonts.load(face)));
    const session = api<Me>("GET", "/api/me").then(
      (me): State => ({ status: "in", me }),
      (failure: unknown): State => {
        if (failure instanceof ApiFailure && failure.status === 401) return { status: "out" };
        throw failure;
      },
    );
    void Promise.all([session, faces]).then(([next]) => setState(next));
  }, []);

  if (state.status === "loading") {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  if (state.status === "out") {
    return (
      <SignInPage
        onSignedIn={(me) => {
          setState({ status: "in", me });
          navigate("/", { replace: true, focus: "main h1" });
        }}
      />
    );
  }
  if (state.status === "removed") return <RemovedPage />;
  return <SignedIn me={state.me} setState={setState} />;
}

function RemovedPage() {
  return (
    <main className="page-state">
      <Band tone="black" className="band-fill">
        Your access to the Tidecraft register has ended.
      </Band>
      <p className="removed-link">
        <a href="/" className="button button-primary">
          Go to sign-in
        </a>
      </p>
    </main>
  );
}

function SignedIn({ me, setState }: { me: Me; setState: (state: State) => void }) {
  const refresh = useCallback(async () => {
    const fresh = await api<Me>("GET", "/api/me");
    setState({ status: "in", me: fresh });
    return fresh;
  }, [setState]);

  return (
    <LiveProvider startSeq={me.event_seq} startTime={me.server_time}>
      <SessionContext.Provider value={{ person: me.person, serverDate: me.server_date, refresh }}>
        <Shell onRemoved={() => setState({ status: "removed" })} onSignedOut={() => setState({ status: "out" })} />
      </SessionContext.Provider>
    </LiveProvider>
  );
}

function linksFor(role: Role, vestingPath: string): Array<{ label: string; href: string }> {
  const portal = { label: "Portal", href: "/" };
  const cap = { label: "Cap table", href: "/cap-table" };
  switch (role) {
    case "option_holder":
    case "leaver":
      return [portal, { label: "Vesting", href: vestingPath }, { label: "Exercise", href: "/exercise" }, { label: "Documents", href: "/documents" }, cap];
    case "investor":
      return [portal, { label: "Tender", href: "/tenders" }, { label: "Documents", href: "/documents" }, cap];
    case "board_member":
      return [portal, { label: "Board queue", href: "/board" }, cap];
    case "founder_admin":
      return [
        portal,
        cap,
        { label: "Ledger", href: "/admin/ledger" },
        { label: "Grants", href: "/admin/grants" },
        { label: "Valuations", href: "/admin/valuations" },
        { label: "Tenders", href: "/admin/tenders" },
        { label: "Round scenario", href: "/admin/scenario" },
        { label: "People", href: "/admin/people" },
        { label: "Documents", href: "/documents" },
      ];
  }
}

function Shell({ onRemoved, onSignedOut }: { onRemoved: () => void; onSignedOut: () => void }) {
  const { person, refresh } = useSession();
  const location = useLocation();
  const live = useLive();
  const holds = person.role === "option_holder" || person.role === "leaver";
  const grants = useResource<{ grants: Grant[] }>(holds ? "/api/grants" : null, ["grants"]);
  const oldest = grants.data?.grants.filter((grant) => grant.state === "accepted" || grant.state === "offered")[0];
  const vestingPath = oldest ? `/grants/${oldest.id}` : "/grants";

  useLiveEvent((message) => {
    const data = message.data;
    const text = (name: string) => String(data[name]);
    switch (message.type) {
      case "offer.arrived":
        announce(`A grant offer is waiting: ${text("grant_id")}, ${groupThousands(Number(data.options))} options.`);
        break;
      case "offer.warning":
        announce(`The offer for grant ${text("grant_id")} lapses at ${displayInstant(text("expires_at"))}. Accept or decline before then.`);
        break;
      case "offer.expired":
        announce(`The offer for grant ${text("grant_id")} has expired.`);
        break;
      case "tranche.vested":
        announce(`${groupThousands(Number(data.vested))} options vested today on grant ${text("grant_id")}.`);
        break;
      case "order.issued":
        announceOnce(`order-issued:${text("order_id")}`, `Payment confirmed. ${groupThousands(Number(data.options))} shares issued on grant ${text("grant_id")}.`);
        break;
      case "order.notice_sealed":
        announceOnce(`order-notice:${text("order_id")}`, `Exercise notice for ${text("order_id")} sealed in the vault.`);
        break;
      case "window.warning":
        announce(`Your exercise window on grant ${text("grant_id")} closes in ${countdown(Number(data.seconds))}.`);
        break;
      case "window.ended":
        announce(`Your exercise window has closed. ${groupThousands(Number(data.cancelled))} unexercised options on grant ${text("grant_id")} were cancelled.`);
        break;
      case "tender.closed":
        announce(`Tender ${text("tender_id")} has closed.`);
        break;
      case "tender.allocated":
        announce(`Tender ${text("tender_id")} allocated: you sold ${groupThousands(Number(data.shares))} shares for ${dollars(text("proceeds"))}.`);
        break;
      case "grant.decided":
        announce(data.outcome === "approved" ? `Grant ${text("grant_id")} approved by the board.` : `Grant ${text("grant_id")} returned to draft by the board.`);
        break;
      case "valuation.changed":
        if (data.status === "lapsed") announceOnce(`lapsed:${text("expires_on")}`, `The current valuation lapsed on ${displayDate(text("expires_on"))}. Record a new valuation before issuing grants.`);
        break;
      case "role.changed":
        void refresh().then((fresh) => {
          announce(`Your role is now ${ROLE_LABEL[fresh.person.role]}.`);
          navigate("/", { replace: true, focus: "main h1" });
        });
        break;
      case "access.removed":
        announce("Your access to the Tidecraft register has ended.");
        onRemoved();
        break;
    }
  });

  const signOut = async () => {
    await api("DELETE", "/api/session");
    onSignedOut();
  };

  return (
    <>
      {live.everClosed && !live.open && <div className="reconnect-strip">Reconnecting to the register.</div>}
      <header className="topbar">
        <p className="brand">Tidecraft Robotics</p>
        <nav aria-label="Register">
          <ul role="list">
            {linksFor(person.role, vestingPath).map((link) => (
              <li key={link.label}>
                <Link href={link.href} aria-current={isCurrent(location.path, link.href, link.label) ? "page" : undefined}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <button type="button" className="button button-quiet" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <Notice path={location.path} />
      <RoutedPage path={location.path} search={location.search} role={person.role} />
    </>
  );
}

function isCurrent(path: string, href: string, label: string): boolean {
  if (href === "/") return path === "/";
  if (label === "Vesting") return path.startsWith("/grants");
  return path === href || path.startsWith(`${href}/`);
}

/** The visible copy of the latest announcement; the polite status region says it, this shows it. */
function Notice({ path }: { path: string }) {
  const [note, setNote] = useState<{ text: string; path: string } | null>(null);
  useEffect(() => onAnnouncement((text) => setNote({ text, path: window.location.pathname })), []);
  return (
    <p className="notice" aria-hidden="true">
      {note && note.path === path ? note.text : null}
    </p>
  );
}

function RoutedPage({ path, search, role }: { path: string; search: string; role: Role }): ReactNode {
  const parts = path.split("/").filter(Boolean);
  const [first, second, third] = parts;
  const holder = role === "option_holder" || role === "leaver";
  const admin = role === "founder_admin";
  const page = (allowed: boolean, element: ReactNode) => (allowed ? element : <NotFoundPage />);
  if (parts.length === 0) return <PortalPage />;
  if (first === "grants" && !third) return second ? page(holder || admin, <GrantPage key={second} id={second} />) : page(holder, <VestingPage />);
  if (first === "exercise" && !second) return page(holder, <ExercisePage />);
  if (first === "exercises" && second && !third) return page(holder || admin, <ExerciseOrderPage key={second} id={second} />);
  if (first === "documents" && !third) return page(role !== "board_member", <DocumentsPage openId={second ?? null} key="documents" />);
  if (first === "cap-table" && !second) return <CapTablePage key="cap" search={search} />;
  if (first === "tenders" && !third) return page(role === "investor" || admin, second ? <TenderPage key={second} id={second} /> : <TendersPage />);
  if (first === "board" && !third) return page(role === "board_member", second ? <BoardSummaryPage key={second} id={second} /> : <BoardPage />);
  if (first === "admin" && admin && !third) {
    if (second === "grants") return <AdminGrantsPage />;
    if (second === "valuations") return <ValuationsPage search={search} />;
    if (second === "ledger") return <LedgerPage />;
    if (second === "tenders") return <AdminTendersPage />;
    if (second === "scenario") return <ScenarioPage search={search} />;
    if (second === "people") return <PeoplePage />;
  }
  if (first === "admin" && second === "grants" && third && admin && parts.length === 3) return <AdminGrantFormPage key={third} id={third} />;
  return <NotFoundPage />;
}

