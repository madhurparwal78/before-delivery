import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, FileText, Menu as MenuIcon, Settings as SettingsIcon, Table2, LayoutTemplate, Trash2, X } from "lucide-react";
import { today } from "../domain/dates.ts";
import { isCalendarDate } from "../domain/records.ts";
import { announcement, confirmation } from "../store/announcer.ts";
import type { AccountSession } from "../store/deviceStore.ts";
import { location } from "../store/router.ts";
import { chooseKeep, chooseUpload, dismissNotice, status, storageAvailable } from "../store/sync.ts";
import { getMeta, listedDocuments, session, useWorkspace, waitingAttachments } from "../store/workspace.ts";
import { Dialog, Link, NotFound, overlayRoot } from "./common.tsx";
import { DocumentList, startNewDocument } from "./DocumentList.tsx";
import { DocumentView, InspectorSlot } from "./DocumentView.tsx";
import { useModal, usePresence, useViewport } from "./hooks.ts";
import { Journal } from "./Journal.tsx";
import { RecordsList, TableView } from "./Records.tsx";
import { Settings } from "./Settings.tsx";
import { SignInDialog } from "./SignIn.tsx";
import { Templates } from "./Templates.tsx";
import { Trash } from "./Trash.tsx";

const NAV = [
  { href: "/", label: "Documents", icon: FileText },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/records", label: "Records", icon: Table2 },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function Navigation({ path, onChoose }: { path: string; onChoose?: () => void }) {
  return (
    <ul className="nav-list">
      {NAV.map(({ href, label, icon: Icon }) => {
        const current = href === "/" ? path === "/" || path.startsWith("/doc/") : path.startsWith(href);
        return (
          <li key={href}>
            <Link href={href} className="nav-link" aria-current={current ? "page" : undefined} onClick={onChoose}><Icon aria-hidden="true" />{label}</Link>
          </li>
        );
      })}
    </ul>
  );
}

const DRAWER_EXIT: Keyframe[] = [{ transform: "none", opacity: 1 }, { transform: "translateX(-24px)", opacity: 0 }];

function Drawer({ open, path, onClose }: { open: boolean; path: string; onClose: () => void }) {
  const { mounted, ref } = usePresence<HTMLElement>(open, DRAWER_EXIT);
  useModal(ref, onClose, open && mounted);
  if (!mounted) return null;
  return createPortal(
    <div className="scrim scrim-drawer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <nav ref={ref} aria-label="Workspace" className="drawer">
        <Navigation path={path} onChoose={onClose} />
        <button type="button" className="button drawer-close" onClick={onClose}><X aria-hidden="true" />Close navigation</button>
      </nav>
    </div>,
    overlayRoot(),
  );
}

function Screen() {
  const { path, query } = location.use();
  if (path === "/") return <DocumentList />;
  if (path === "/trash") return <Trash />;
  if (path === "/records") return <RecordsList />;
  if (path === "/templates") return <Templates />;
  if (path === "/settings") return <Settings />;
  if (path === "/journal") return <Journal key={today()} date={today()} />;
  const journal = /^\/journal\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (journal?.[1] && isCalendarDate(journal[1])) return <Journal date={journal[1]} />;
  const document = /^\/doc\/([^/]+)$/.exec(path);
  if (document?.[1]) {
    const id = decodeURIComponent(document[1]);
    return <DocumentView key={id} documentId={id} query={query} />;
  }
  const table = /^\/records\/([^/]+)$/.exec(path);
  if (table?.[1]) {
    const id = decodeURIComponent(table[1]);
    return <TableView key={id} tableId={id} query={query} />;
  }
  return <NotFound heading="We could not find that page." />;
}

function UploadChoice({ account, onClose }: { account: AccountSession; onClose: () => void }) {
  const count = listedDocuments().length;
  return (
    <Dialog name="Upload this workspace?" onClose={onClose}>
      <p>This device holds {count} documents. Nothing leaves this device until you choose.</p>
      <div className="dialog-actions">
        <button type="button" className="button" data-first-focus onClick={() => { chooseUpload(account); onClose(); }}>Upload this workspace</button>
        <button type="button" className="button" onClick={() => { chooseKeep(account); onClose(); }}>Keep it on this device</button>
      </div>
    </Dialog>
  );
}

function Notices() {
  const meta = getMeta();
  const storage = storageAvailable.use();
  const [dismissedStorage, setDismissedStorage] = useState(false);
  const storageDown = !storage && session() !== null && waitingAttachments().length > 0;
  useEffect(() => {
    if (!storageDown) setDismissedStorage(false);
  }, [storageDown]);
  return (
    <section aria-label="Notices" className="notices">
      {storageDown && !dismissedStorage && (
        <div className="notice">
          <p>Attachment storage is unavailable. Waiting files stay on this device.</p>
          <button type="button" className="button" onClick={() => setDismissedStorage(true)}>Dismiss notice</button>
        </div>
      )}
      {meta.notices.map((text) => (
        <div key={text} className="notice">
          <p>{text}</p>
          <button type="button" className="button" onClick={() => dismissNotice(text)}>Dismiss notice</button>
        </div>
      ))}
    </section>
  );
}

function Brand() {
  return (
    <Link href="/" className="brand">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2h12l4 4v16H4z" /></svg>
      Oddment
    </Link>
  );
}

function SyncStatusLine() {
  const shown = status.use();
  return <div role="status" aria-label="Sync status" className="sync-status" data-sync-state={shown.state}>{shown.sentence}</div>;
}

function Announcements() {
  const text = announcement.use();
  return <div role="status" aria-label="Announcements" aria-live="polite" className="sr-only">{text}</div>;
}

function Confirmation() {
  const text = confirmation.use();
  return text ? <div className="confirmation" aria-hidden="true">{text}</div> : null;
}

export function App() {
  useWorkspace();
  const { path } = location.use();
  const viewport = useViewport();
  const account = session();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [choiceDeferred, setChoiceDeferred] = useState(false);
  const [inspectorSlot, setInspectorSlot] = useState<HTMLDivElement | null>(null);
  const main = useRef<HTMLElement>(null);
  const needsChoice = account !== null && getMeta().choices[account.user.id] === undefined && !choiceDeferred && !signingIn;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyN") {
        event.preventDefault();
        startNewDocument();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div id="shell" className={`shell shell-${viewport}`}>
        <a
          className="skip"
          href="#main"
          onClick={(event) => {
            event.preventDefault();
            main.current?.focus();
          }}
        >
          Skip to main content
        </a>
        <header className="banner">
          <div className="banner-start">
            {viewport !== "desktop" && (
              <button type="button" className="button" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
                <MenuIcon aria-hidden="true" />
              </button>
            )}
            <Brand />
          </div>
          <SyncStatusLine />
          {account
            ? <span className="account-email">{account.user.email}</span>
            : <button type="button" className="button" onClick={() => setSigningIn(true)}>Sign in</button>}
        </header>
        <Notices />
        <div className="panes">
          {viewport === "desktop" && <nav aria-label="Workspace" className="rail"><Navigation path={path} /></nav>}
          <InspectorSlot.Provider value={inspectorSlot}>
            <main id="main" ref={main} tabIndex={-1} className="main"><Screen /></main>
          </InspectorSlot.Provider>
          <div ref={setInspectorSlot} className="inspector-slot" />
        </div>
      </div>
      <Drawer open={drawerOpen} path={path} onClose={() => setDrawerOpen(false)} />
      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
      {needsChoice && <UploadChoice account={account} onClose={() => setChoiceDeferred(true)} />}
      <Announcements />
      <Confirmation />
    </>
  );
}
