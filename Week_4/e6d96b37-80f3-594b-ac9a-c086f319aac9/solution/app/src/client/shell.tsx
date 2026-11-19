// The desk shell on every page: Flan wordmark masthead, Tab Wipe folder tabs, the exchange desk
// corner block, slate desk rules, the desk status line, the specimen sheet and the desk footer.

import { CircleAlert, Menu, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { cornerCount, F, statusLine } from "../shared/feedback";
import { deskCounts } from "../shared/counts";
import { EXCHANGE_WORKSPACES, type WorkspaceSlug } from "../shared/drafts";
import { useDesk } from "./desk";
import { follow } from "./route";

const STOCK_LINKS: [WorkspaceSlug, string][] = [
  ["intake", "Intake"],
  ["attribution", "Attribution"],
  ["reconciliation", "Catalog reconciliation"],
  ["tray", "Tray placement"],
  ["album", "Album"],
  ["condition", "Condition"],
  ["keepers", "Keepers"],
  ["audit", "Stock audit"],
];
const EXCHANGE_LINKS: [WorkspaceSlug, string][] = [
  ["offers", "Offers"],
  ["counteroffers", "Counteroffers"],
  ["dispatch", "Dispatch"],
  ["receipt", "Receipt"],
  ["disputes", "Disputes"],
];

function WorkspaceNav({ current, onPick, inSheet = false }: { current: WorkspaceSlug | null; onPick?: () => void; inSheet?: boolean }) {
  const { ns, session } = useDesk();
  const links = session?.role === "dealer" ? [...STOCK_LINKS, ...EXCHANGE_LINKS] : EXCHANGE_LINKS;
  return (
    <nav aria-label="Workspaces" className={inSheet ? "workspace-nav sheet-nav" : "workspace-nav"}>
      <ul>
        {links.map(([slug, name]) => (
          <li key={slug}>
            <a
              href={`/desk/${ns}/${slug}`}
              aria-current={current === slug ? "page" : undefined}
              onClick={(event) => {
                follow(event);
                onPick?.();
              }}
            >
              {name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DeskTools({ current, onClose }: { current: WorkspaceSlug | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current!.showModal();
    dialog.current!.querySelector<HTMLElement>("a, button")?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="desk-tools"
      aria-label="Desk tools"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = [...dialog.current!.querySelectorAll<HTMLElement>("a, button")];
        const index = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        items[event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length]!.focus();
      }}
    >
      <div className="tools-head">
        <h2>Desk tools</h2>
        <button type="button" className="icon-button" aria-label="Close desk tools" onClick={onClose}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <WorkspaceNav current={current} onPick={onClose} />
    </dialog>
  );
}

function InlineNote() {
  const { note, alertText, refresh, signInAgain } = useDesk();
  if (!note) return null;
  const action =
    note.kind === "service" ? (
      <button type="button" className="action-link" onClick={note.retry}>
        Retry save
      </button>
    ) : note.kind === "conflict" ? (
      <button type="button" className="action-link" onClick={() => void refresh()}>
        Reload current
      </button>
    ) : (
      <button type="button" className="action-link" onClick={signInAgain}>
        Sign in again
      </button>
    );
  return (
    <div className="note">
      {action}
      {/* The alert above already says it; the note then carries only its action. */}
      {note.copy !== alertText && <p>{note.copy}</p>}
    </div>
  );
}

export function Shell({ current, children }: { current: WorkspaceSlug | null; children: ReactNode }) {
  const { ns, session, state, clock, phase, status, alertText } = useDesk();
  const [tools, setTools] = useState(false);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const counts = state ? deskCounts(state, clock) : null;
  const exchangeDesk = current !== null && EXCHANGE_WORKSPACES.includes(current);
  const stockDesk = current !== null && !exchangeDesk;
  const dealer = session?.role !== "counterpart";
  const closeTools = () => {
    setTools(false);
    requestAnimationFrame(() => toolsButton.current?.focus());
  };
  return (
    <div className="page">
      <header className="masthead">
        <div className="mast-left">
          <a className="wordmark" href={`/desk/${ns}`} onClick={follow}>
            Flan
          </a>
          <button ref={toolsButton} type="button" className="icon-button tools-button" aria-label="Open desk tools" onClick={() => setTools(true)}>
            <Menu aria-hidden="true" size={22} />
          </button>
        </div>
        {/* Unseen until the role is known, so a counterpart's tabs never visibly drop the dealer's Stock tab. */}
        <div className="folder-tabs" role="tablist" aria-label="Desks" style={phase === "loading" ? { visibility: "hidden" } : undefined}>
          {dealer && (
            <a role="tab" className="folder-tab" aria-selected={stockDesk} href={`/desk/${ns}/intake`} onClick={follow}>
              Stock
            </a>
          )}
          <a role="tab" className="folder-tab" aria-selected={exchangeDesk} href={`/desk/${ns}/offers`} onClick={follow}>
            Exchange
          </a>
        </div>
        {/* The brief names the link exactly; its lines reach assistive tech as the description instead.
            The name is content, not aria-label, so the visible lines never contradict it (WCAG 2.5.3). */}
        <a className="corner" aria-describedby={counts?.closing ? "corner-count corner-status corner-closing" : "corner-count corner-status"} href={`/desk/${ns}/offers`} onClick={follow}>
          <span className="sr-only">Open exchange circle</span>
          <span id="corner-count" className="corner-count figures" aria-hidden="true">{cornerCount(counts?.openOffers ?? 0)}</span>
          <span id="corner-status" className="corner-status" aria-hidden="true">{session?.step_up_fresh ? F.CORNER_VERIFIED : F.CORNER_VERIFY}</span>
          {counts?.closing && <span id="corner-closing" className="pill" aria-hidden="true">{F.CORNER_CLOSING}</span>}
        </a>
      </header>
      <div className="rule" aria-hidden="true" />
      <section className="status-line figures" aria-label="Desk status">
        {/* One span per sentence: a narrow screen stacks them, so the line's height is known before the counts load. */}
        {counts
          ? statusLine(counts.takenInToday, counts.pendingRecords)
              .split(/(?<=\.) /)
              .map((sentence, i) => (
                <Fragment key={i}>
                  {i > 0 && " "}
                  <span>{sentence}</span>
                </Fragment>
              ))
          : ""}
      </section>
      <main id="desk-main" className="sheet" aria-label="Specimen desk" tabIndex={-1}>
        {session && <WorkspaceNav current={current} inSheet />}
        <div className="feedback">
          <div role="status" aria-label="Desk updates" aria-live="polite" aria-atomic="true" className="desk-updates">
            {status}
          </div>
          <div role="alert" aria-label="Desk error" className={alertText ? "desk-error" : "desk-error empty"}>
            {alertText && <CircleAlert aria-hidden="true" size={16} />}
            {alertText}
          </div>
        </div>
        <InlineNote />
        {children}
      </main>
      {/* The footer arrives with the desk: drawn under "Loading desk" it would be pushed down by the workspace. */}
      {phase !== "loading" && (
        <>
          <div className="rule" aria-hidden="true" />
          <Footer />
        </>
      )}
      {tools && <DeskTools current={current} onClose={closeTools} />}
    </div>
  );
}

export function Footer() {
  return (
    <nav className="footer" aria-label="Desk footer">
      <p className="legal">
        Hollowmint Desk Co. working desk. Every dealer, coin issue and register record on this desk is invented.
      </p>
      <div className="footer-centre" aria-hidden="true" />
      <ul className="footer-links">
        <li>
          <a className="action-link" href="/help/evidence" onClick={follow}>
            Evidence policy
          </a>
        </li>
        <li>
          <a className="action-link" href="/help/keyboard" onClick={follow}>
            Keyboard guide
          </a>
        </li>
        <li>
          <a className="action-link" href="/help" onClick={follow}>
            Desk help
          </a>
        </li>
      </ul>
    </nav>
  );
}
