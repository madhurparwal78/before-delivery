import { useEffect, useRef, useState } from "react";
import type { Offer } from "../shared/types.js";
import { useDesk } from "./desk_context.js";
import { feedback } from "./feedback.js";
import { DeskHome } from "./workspaces/home.js";
import { IntakeWorkspace } from "./workspaces/intake.js";
import { AttributionWorkspace } from "./workspaces/attribution.js";
import { ReconciliationWorkspace } from "./workspaces/reconciliation.js";
import { TrayWorkspace } from "./workspaces/tray.js";
import { AlbumWorkspace } from "./workspaces/album.js";
import { ConditionWorkspace } from "./workspaces/condition.js";
import { KeepersWorkspace } from "./workspaces/keepers.js";
import { AuditWorkspace } from "./workspaces/audit.js";
import { OffersWorkspace } from "./workspaces/offers.js";
import { CounteroffersWorkspace } from "./workspaces/counteroffers.js";
import { DispatchWorkspace } from "./workspaces/dispatch.js";
import { ReceiptWorkspace } from "./workspaces/receipt.js";
import { DisputesWorkspace } from "./workspaces/disputes.js";

export type WorkspaceKey =
  | "home"
  | "intake"
  | "attribution"
  | "catalog-reconciliation"
  | "tray-placement"
  | "album"
  | "condition"
  | "keepers"
  | "audit"
  | "offers"
  | "counteroffers"
  | "dispatch"
  | "receipt"
  | "disputes";

const STOCK_WORKSPACES: { key: WorkspaceKey; label: string }[] = [
  { key: "intake", label: "Intake" },
  { key: "attribution", label: "Attribution" },
  { key: "catalog-reconciliation", label: "Catalog reconciliation" },
  { key: "tray-placement", label: "Tray placement" },
  { key: "album", label: "Album" },
  { key: "condition", label: "Condition" },
  { key: "keepers", label: "Keepers" },
  { key: "audit", label: "Stock audit" },
];

const EXCHANGE_WORKSPACES: { key: WorkspaceKey; label: string }[] = [
  { key: "offers", label: "Offers" },
  { key: "counteroffers", label: "Counteroffers" },
  { key: "dispatch", label: "Dispatch" },
  { key: "receipt", label: "Receipt" },
  { key: "disputes", label: "Disputes" },
];

export function openOfferCount(offers: Record<string, Offer>): number {
  return Object.values(offers).filter((o) => o.status === "sent" || o.status === "countered" || o.status === "accepted").length;
}

export function awaitingReceiptCount(offers: Record<string, Offer>): number {
  return Object.values(offers).filter((o) => o.status === "dispatched" || o.status === "received").length;
}

export function statusLineText(
  offers: Record<string, Offer>,
  events: { type: string; at: string }[],
  specimens: Record<string, { attribution: { register: string } }>,
): string {
  const today = new Date().toISOString().slice(0, 10);
  let takenIn = 0;
  let pending = 0;
  for (const event of events) {
    if (event.type === "specimen.created" && event.at.slice(0, 10) === today) takenIn += 1;
  }
  for (const specimen of Object.values(specimens)) {
    if (specimen.attribution.register === "pending") pending += 1;
  }
  void offers;
  return feedback("F_STATUS_LINE", { n: takenIn, m: pending });
}

interface DeskShellProps {
  namespace: string;
  role: "dealer" | "counterpart" | "outsider";
  initialWorkspace: WorkspaceKey;
}

export function DeskShell({ namespace, role, initialWorkspace }: DeskShellProps): React.ReactElement {
  const desk = useDesk();
  const [workspace, setWorkspace] = useState<WorkspaceKey>(initialWorkspace);
  const [toolsOpen, setToolsOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/desk\/[^/]+\/([a-z-]+)/);
    if (match && isWorkspace(match[1])) setWorkspace(match[1] as WorkspaceKey);
  }, []);

  const isDealer = role === "dealer";
  const openOffers = desk.state ? openOfferCount(desk.state.offers) : 0;
  const awaiting = desk.state ? awaitingReceiptCount(desk.state.offers) : 0;
  const cornerClosing = desk.state ? Object.values(desk.state.offers).some((o) => o.closing) : false;
  const stepUpFresh = desk.session?.step_up_fresh ?? false;

  const stockTabSelected = STOCK_WORKSPACES.some((w) => w.key === workspace);
  const exchangeTabSelected = EXCHANGE_WORKSPACES.some((w) => w.key === workspace);

  const navigate = (key: WorkspaceKey) => {
    setWorkspace(key);
    setToolsOpen(false);
    const path = key === "home" ? `/desk/${namespace}` : `/desk/${namespace}/${key}`;
    window.history.pushState({}, "", path);
    mainRef.current?.focus();
  };

  const links = isDealer ? [...STOCK_WORKSPACES, ...EXCHANGE_WORKSPACES] : EXCHANGE_WORKSPACES;
  const statusText = desk.state
    ? statusLineText(desk.state.offers, desk.state.events, desk.state.specimens)
    : feedback("F_STATUS_LINE", { n: 0, m: 0 });

  return (
    <div className="desk-page">
      <hr className="desk-rule" aria-hidden="true" />
      <header className="desk-header">
        <a className="desk-wordmark" href={`/desk/${namespace}`} onClick={(e) => { e.preventDefault(); navigate("home"); }}>
          Flan
        </a>
        <nav className="desk-tabs" aria-label="Desk tabs">
          {isDealer && (
            <button
              className="tab"
              role="tab"
              aria-selected={stockTabSelected}
              onClick={() => navigate(stockTabSelected ? workspace : "intake")}
            >
              Stock
            </button>
          )}
          <button
            className="tab"
            role="tab"
            aria-selected={exchangeTabSelected}
            onClick={() => navigate(exchangeTabSelected ? workspace : "offers")}
          >
            Exchange
          </button>
        </nav>
        <div className="desk-corner">
          <a href={`/desk/${namespace}/offers`} onClick={(e) => { e.preventDefault(); navigate("offers"); }}>
            <span className="corner-line">{feedback("F_CORNER", { n: openOffers })}</span>
            <span className="corner-line">{stepUpFresh ? feedback("F_CORNER_VERIFIED") : feedback("F_CORNER_VERIFY")}</span>
            {cornerClosing && <span className="amber-pill">{feedback("F_CORNER_CLOSING")}</span>}
          </a>
        </div>
      </header>
      <hr className="desk-rule" aria-hidden="true" />
      <p className="desk-status" aria-label="Desk status">{statusText}</p>
      <main className="desk-sheet" aria-label="Specimen desk" ref={mainRef} tabIndex={-1}>
        {role === "outsider" ? (
          <p>{feedback("F_HIDDEN")}</p>
        ) : (
          <>
            <nav className="workspace-nav" aria-label="Workspaces" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {links.map((link) => (
                <button key={link.key} className="btn" onClick={() => navigate(link.key)}>
                  {link.label}
                </button>
              ))}
            </nav>
            <WorkspaceRouter workspace={workspace} namespace={namespace} />
          </>
        )}
      </main>
      <hr className="desk-rule" aria-hidden="true" />
      <footer className="desk-footer" aria-label="Desk footer">
        <div>© Hollowmint Desk Co.</div>
        <div className="footer-centre" />
        <div className="footer-links">
          <a href="/help/evidence">Evidence policy</a>
          <a href="/help/keyboard">Keyboard guide</a>
          <a href="/help">Desk help</a>
        </div>
      </footer>
      <div className="desk-live-status" role="status" aria-live="polite" id="desk-updates">
        {desk.pending ?? desk.announcement ?? ""}
      </div>
      <div className="desk-live-alert" role="alert" id="desk-error">
        {desk.error ?? ""}
      </div>
      {toolsOpen && (
        <div
          className="dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setToolsOpen(false);
              toolsButtonRef.current?.focus();
            }
          }}
        >
          <div className="review-dialog" role="dialog" aria-modal="true" aria-label="Desk tools">
            <h2>Desk tools</h2>
            <nav aria-label="Workspaces" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {links.map((link) => (
                <button key={link.key} className="btn" onClick={() => navigate(link.key)}>
                  {link.label}
                </button>
              ))}
            </nav>
            <div className="review-actions">
              <button
                className="btn"
                onClick={() => {
                  setToolsOpen(false);
                  toolsButtonRef.current?.focus();
                }}
              >
                Close desk tools
              </button>
            </div>
          </div>
        </div>
      )}
      <button ref={toolsButtonRef} className="btn desk-tools-open" onClick={() => setToolsOpen(true)} style={{ display: "none" }} aria-hidden="true" tabIndex={-1}>
        Open desk tools
      </button>
    </div>
  );
}

function isWorkspace(value: string): value is WorkspaceKey {
  return (
    value === "home" ||
    value === "intake" ||
    value === "attribution" ||
    value === "catalog-reconciliation" ||
    value === "tray-placement" ||
    value === "album" ||
    value === "condition" ||
    value === "keepers" ||
    value === "audit" ||
    value === "offers" ||
    value === "counteroffers" ||
    value === "dispatch" ||
    value === "receipt" ||
    value === "disputes"
  );
}

function WorkspaceRouter({ workspace, namespace }: { workspace: WorkspaceKey; namespace: string }): React.ReactElement {
  switch (workspace) {
    case "home":
      return <DeskHome namespace={namespace} />;
    case "intake":
      return <IntakeWorkspace />;
    case "attribution":
      return <AttributionWorkspace />;
    case "catalog-reconciliation":
      return <ReconciliationWorkspace />;
    case "tray-placement":
      return <TrayWorkspace />;
    case "album":
      return <AlbumWorkspace />;
    case "condition":
      return <ConditionWorkspace />;
    case "keepers":
      return <KeepersWorkspace />;
    case "audit":
      return <AuditWorkspace />;
    case "offers":
      return <OffersWorkspace />;
    case "counteroffers":
      return <CounteroffersWorkspace />;
    case "dispatch":
      return <DispatchWorkspace />;
    case "receipt":
      return <ReceiptWorkspace />;
    case "disputes":
      return <DisputesWorkspace />;
    default:
      return <DeskHome namespace={namespace} />;
  }
}
