import { useEffect, useRef, useState } from 'react';
import { DeskProvider, useDesk } from '../lib/desk.tsx';
import { useLayout } from '../lib/layout.ts';
import { F, Ftpl, formatExpiry, formatRemaining } from '../../shared/feedback.ts';
import {
  COUNTERPART_WORKSPACES,
  WORKSPACES,
  WORKSPACE_LABEL,
  WORKSPACE_TAB,
  type DeskState,
  type WorkspaceId,
} from '../../shared/types.ts';
import { Workspace } from '../workspaces/Workspace.tsx';
import { Home } from './Home.tsx';
import { Help } from './Help.tsx';
import { Icon } from './Icon.tsx';

/** The desk shell: the frame every page carries. */

interface Route {
  kind: 'home' | 'workspace' | 'help' | 'landing';
  ns: string;
  workspace: WorkspaceId | null;
  helpPage: 'index' | 'evidence' | 'keyboard';
}

function readRoute(): Route {
  const parts = window.location.pathname.split('/').filter((part) => part !== '');
  if (parts[0] === 'help') {
    const page =
      parts[1] === 'evidence' ? 'evidence' : parts[1] === 'keyboard' ? 'keyboard' : 'index';
    return { kind: 'help', ns: '', workspace: null, helpPage: page };
  }
  if (parts[0] === 'desk' && parts[1]) {
    const candidate = parts[2] as WorkspaceId | undefined;
    const workspace = candidate && WORKSPACES.includes(candidate) ? candidate : null;
    return {
      kind: workspace ? 'workspace' : 'home',
      ns: parts[1],
      workspace,
      helpPage: 'index',
    };
  }
  return { kind: 'landing', ns: '', workspace: null, helpPage: 'index' };
}

export function navigate(to: string): void {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function Desk(): JSX.Element {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const update = (): void => setRoute(readRoute());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  if (route.kind === 'help') return <Help page={route.helpPage} />;
  if (route.kind === 'landing') return <Landing />;
  return (
    <DeskProvider ns={route.ns}>
      <Shell route={route} />
    </DeskProvider>
  );
}

function Landing(): JSX.Element {
  useEffect(() => {
    void fetch('/api/session', { credentials: 'same-origin' })
      .then((reply) => reply.json() as Promise<{ namespace: string; subject: string }>)
      .then((session) => {
        // No completed session yet, so sign in first.
        window.location.replace(
          session.subject === '' ? '/auth/login?return_to=%2F' : `/desk/${session.namespace}`,
        );
      })
      .catch(() => window.location.replace('/auth/login?return_to=%2F'));
  }, []);
  return (
    <main id="desk-main" aria-label="Specimen desk" tabIndex={-1} className="sheet">
      <p>Opening the desk.</p>
    </main>
  );
}

/* -- derived shell values, all taken from the server --------------------- */

export interface Counts {
  openOffers: number;
  awaitingReceipt: number;
  dealerSpecimens: number;
  occupiedCells: number;
  takenInToday: number;
  cataloguePending: number;
  closing: boolean;
}

function countsOf(state: DeskState | null, serverNow: Date | null): Counts {
  const empty: Counts = {
    openOffers: 0,
    awaitingReceipt: 0,
    dealerSpecimens: 0,
    occupiedCells: 0,
    takenInToday: 0,
    cataloguePending: 0,
    closing: false,
  };
  if (!state) return empty;

  const counts = { ...empty };
  for (const offer of Object.values(state.offers)) {
    if (offer.status === 'sent' || offer.status === 'countered' || offer.status === 'accepted') {
      counts.openOffers += 1;
      if (offer.closing) counts.closing = true;
    }
    if (offer.status === 'dispatched' || offer.status === 'received') {
      counts.awaitingReceipt += 1;
    }
  }
  for (const specimen of Object.values(state.specimens)) {
    if (
      specimen.owner === 'dealer' &&
      specimen.status !== 'transferred' &&
      specimen.status !== 'missing'
    ) {
      counts.dealerSpecimens += 1;
    }
    if (specimen.attribution.register === 'pending') counts.cataloguePending += 1;
  }
  for (const cell of Object.values(state.tray)) if (cell.specimen) counts.occupiedCells += 1;

  // "Today" is the namespace-clock UTC date, which only the server knows.
  const today = (serverNow ?? new Date()).toISOString().slice(0, 10);
  for (const event of state.events) {
    if (event.type === 'specimen.created' && event.at.slice(0, 10) === today) {
      counts.takenInToday += 1;
    }
  }
  return counts;
}

/* -- the shell ----------------------------------------------------------- */

function Shell({ route }: { route: Route }): JSX.Element {
  const desk = useDesk();
  const layout = useLayout();
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const counts = countsOf(desk.state, desk.serverNow);
  const isCounterpart = desk.session?.role === 'counterpart';
  const tab = route.workspace ? WORKSPACE_TAB[route.workspace] : null;

  return (
    <div className="desk" data-layout={layout}>
      <header className="masthead">
        <div className="slate-rule" />
        <div className="masthead-row">
          <a
            className="wordmark target"
            href={`/desk/${desk.ns}`}
            onClick={linkTo(`/desk/${desk.ns}`)}
          >
            Flan
          </a>
          {layout === 'phone' ? (
            <button
              type="button"
              className="tools-open target"
              ref={toolsButton}
              onClick={() => setToolsOpen(true)}
            >
              Open desk tools
            </button>
          ) : null}
          <div className="tab-wipe masthead-tabs" role="tablist" aria-label="Desk">
            {!isCounterpart ? (
              <button
                type="button"
                role="tab"
                className="folder-tab target"
                aria-selected={tab === 'stock'}
                onClick={() => navigate(`/desk/${desk.ns}/intake`)}
              >
                Stock
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              className="folder-tab target"
              aria-selected={tab === 'exchange'}
              onClick={() => navigate(`/desk/${desk.ns}/offers`)}
            >
              Exchange
            </button>
          </div>
          <a
            className="corner-block target"
            href={`/desk/${desk.ns}/offers`}
            onClick={linkTo(`/desk/${desk.ns}/offers`)}
            aria-label="Open exchange circle"
          >
            <span className="corner-line">{Ftpl.corner(counts.openOffers)}</span>
            <span className="corner-line">
              {desk.session?.step_up_fresh ? F.CORNER_VERIFIED : F.CORNER_VERIFY}
            </span>
            {counts.closing ? <span className="corner-pill">{F.CORNER_CLOSING}</span> : null}
          </a>
        </div>
      </header>

      <section className="desk-status" aria-label="Desk status">
        {Ftpl.statusLine(counts.takenInToday, counts.cataloguePending)}
      </section>

      <StatusRegions />

      <main id="desk-main" className="sheet" aria-label="Specimen desk" tabIndex={-1}>
        {layout !== 'phone' ? <WorkspaceNav ns={desk.ns} current={route.workspace} /> : null}
        {route.kind === 'home' ? (
          <Home counts={counts} />
        ) : route.workspace ? (
          <Workspace id={route.workspace} />
        ) : null}
      </main>

      <div className="slate-rule footer-rule" />
      <nav className="desk-footer" aria-label="Desk footer">
        <p className="legal">Flan — Hollowmint Desk Co. Invented stock, invented register.</p>
        {layout !== 'phone' ? <span className="footer-gap" /> : null}
        <span className="footer-links">
          <a className="teal-action" href="/help/evidence">
            Evidence policy
          </a>
          <a className="teal-action" href="/help/keyboard">
            Keyboard guide
          </a>
          <a className="teal-action" href="/help">
            Desk help
          </a>
        </span>
      </nav>

      {toolsOpen ? (
        <div className="review-scrim">
          <div
            className="review review-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Desk tools"
          >
            <h2 className="review-title">Desk tools</h2>
            <WorkspaceNav
              ns={desk.ns}
              current={route.workspace}
              onPick={() => setToolsOpen(false)}
            />
            <div className="review-actions">
              <button
                type="button"
                className="target"
                onClick={() => {
                  setToolsOpen(false);
                  toolsButton.current?.focus();
                }}
              >
                Close desk tools
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function linkTo(path: string): (event: React.MouseEvent) => void {
  return (event) => {
    event.preventDefault();
    navigate(path);
  };
}

/** G07 and G08: present on every page before any async work. */
function StatusRegions(): JSX.Element {
  const desk = useDesk();
  return (
    <>
      <div
        className="live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Desk updates"
      >
        {desk.feedback.status}
      </div>
      <div className="live" role="alert" aria-label="Desk error">
        {desk.feedback.error}
      </div>
      <InlineNote />
    </>
  );
}

/** Pending, offline and conflict states are teal-edged inline notes. */
function InlineNote(): JSX.Element | null {
  const desk = useDesk();
  const { feedback } = desk;
  const copy = feedback.error || (desk.offline ? F.OFFLINE : '');
  if (!copy || (feedback.action === null && !desk.offline)) return null;
  return (
    <div className="note shell-note">
      <p>{copy}</p>
      {feedback.action === 'reload' ? (
        <button type="button" className="teal-action target" onClick={() => desk.refresh()}>
          <Icon name="rotate-ccw" />
          Reload current
        </button>
      ) : null}
      {feedback.action === 'retry' ? (
        <button
          type="button"
          className="teal-action target"
          disabled={desk.busy}
          onClick={() => desk.resume()}
        >
          <Icon name="rotate-ccw" />
          Retry save
        </button>
      ) : null}
      {feedback.action === 'sign-in' ? (
        <a
          className="teal-action target"
          href={`/auth/login?return_to=${encodeURIComponent(window.location.pathname)}`}
        >
          <Icon name="shield-check" />
          Sign in again
        </a>
      ) : null}
    </div>
  );
}

function WorkspaceNav({
  ns,
  current,
  onPick,
}: {
  ns: string;
  current: WorkspaceId | null;
  onPick?: () => void;
}): JSX.Element {
  const desk = useDesk();
  const allowed = desk.session?.role === 'counterpart' ? COUNTERPART_WORKSPACES : [...WORKSPACES];
  return (
    <nav className="workspaces" aria-label="Workspaces">
      {allowed.map((workspace) => (
        <a
          key={workspace}
          className={
            workspace === current ? 'workspace-link current target' : 'workspace-link target'
          }
          href={`/desk/${ns}/${workspace}`}
          onClick={(event) => {
            event.preventDefault();
            navigate(`/desk/${ns}/${workspace}`);
            onPick?.();
          }}
        >
          {WORKSPACE_LABEL[workspace]}
        </a>
      ))}
    </nav>
  );
}

/** N09 and each G34 row read the server's window, never the device clock. */
export function windowText(offer: {
  status: string;
  remaining_seconds: number | null;
  expires_at: string | null;
}): string {
  if (offer.status === 'accepted') return F.WINDOW_ACCEPTED;
  if (offer.status === 'expired') {
    return Ftpl.windowClosed(offer.expires_at ? formatExpiry(offer.expires_at) : '');
  }
  if (
    (offer.status === 'sent' || offer.status === 'countered') &&
    offer.remaining_seconds !== null &&
    offer.expires_at !== null
  ) {
    return Ftpl.window(formatRemaining(offer.remaining_seconds), formatExpiry(offer.expires_at));
  }
  return '';
}
