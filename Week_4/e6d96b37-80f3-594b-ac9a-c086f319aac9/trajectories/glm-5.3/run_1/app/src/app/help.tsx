import { useEffect, useState } from "react";
import { getJson } from "./desk_context.js";
import type { SessionInfo } from "../shared/types.js";
import { feedback } from "./feedback.js";

function shell(inner: React.ReactNode): React.ReactElement {
  return (
    <div className="desk-page">
      <hr className="desk-rule" aria-hidden="true" />
      <header className="desk-header">
        <a className="desk-wordmark" href="/desk/hollowmint">Flan</a>
      </header>
      <hr className="desk-rule" aria-hidden="true" />
      <p className="desk-status" aria-label="Desk status">{feedback("F_STATUS_LINE", { n: 0, m: 0 })}</p>
      <main className="desk-sheet" aria-label="Specimen desk">
        {inner}
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
    </div>
  );
}

export function HelpPage(): React.ReactElement {
  return shell(
    <article>
      <h2 className="desk-main-heading">Desk help</h2>
      <div className="fact-box">
        <h3>Flan desk:</h3>
        <ul>
          <li>Open the Stock tab to take in, attribute, shelve and audit specimens.</li>
          <li>Open the Exchange tab to send and answer reciprocal swaps.</li>
          <li>Every confirmed change goes through its review dialog first.</li>
        </ul>
      </div>
    </article>,
  );
}

export function EvidencePolicyPage(): React.ReactElement {
  return shell(
    <article>
      <h2 className="desk-main-heading">Evidence policy</h2>
      <div className="fact-box">
        <h3>Frozen evidence:</h3>
        <ul>
          <li>Freezing a packing manifest copies each item's latest obverse photograph into an immutable dispatch object.</li>
          <li>A private evidence link works only for the dispute's parties and expires.</li>
          <li>Revoking a link ends access at once.</li>
        </ul>
      </div>
    </article>,
  );
}

export function KeyboardGuidePage(): React.ReactElement {
  return shell(
    <article>
      <h2 className="desk-main-heading">Keyboard guide</h2>
      <div className="fact-box">
        <h3>Every key path:</h3>
        <ul>
          <li>Tab moves between controls; Space picks up a source; Enter stages it on the focused destination; Escape cancels the pickup.</li>
          <li>Reorder lists: Space picks up the focused item, ArrowUp and ArrowDown move it, Enter drops it, Escape returns it.</li>
          <li>Zoom sliders: ArrowRight and ArrowUp zoom in, ArrowLeft and ArrowDown zoom out, Home selects the minimum, End the maximum.</li>
          <li>Wipe sliders: Arrows change by 1, Page Up and Page Down by 10, Home selects 0, End selects 100.</li>
          <li>Markers: with the marker focused, arrows move 1 image unit and Shift with an arrow moves 10.</li>
          <li>Audit cells: ArrowRight and ArrowLeft select the next and previous cell, ArrowDown and ArrowUp go one row down and up.</li>
          <li>Review dialogs: Escape cancels; Tab and Shift+Tab wrap inside the dialog.</li>
        </ul>
      </div>
    </article>,
  );
}

export function Router(): React.ReactElement {
  const path = window.location.pathname;
  const [session, setSession] = useState<SessionInfo | null>(null);
  useEffect(() => {
    void getJson<SessionInfo>("/api/session").then(setSession).catch(() => undefined);
  }, []);
  if (path === "/help/evidence") return <EvidencePolicyPage />;
  if (path === "/help/keyboard") return <KeyboardGuidePage />;
  void session;
  return <HelpPage />;
}
