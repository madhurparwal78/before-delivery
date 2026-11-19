import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MapPayload } from '../../shared/model.ts';
import { COPY } from '../../shared/rules.ts';
import { HttpError, api } from '../api.ts';
import { Activity } from '../editor/Activity.tsx';
import { Canvas, type CanvasActions } from '../editor/Canvas.tsx';
import { Details } from '../editor/Details.tsx';
import { ExportDialog, HistoryDialog, ImportDialog, LinkDialog, SaveVersionDialog, SessionDialog, ShareDialog } from '../editor/Dialogs.tsx';
import { Glyph } from '../editor/glyphs.tsx';
import { Outline } from '../editor/Outline.tsx';
import { Announcer, ConnectionBanner, FindBar, Notices, People, RecoveredBand, TopicMenu, type MenuAction } from '../editor/Overlays.tsx';
import { Presenter, endPresentation, startPresentation, stepSlide } from '../editor/Presenter.tsx';
import { MapSession, newOpId } from '../editor/session.ts';
import { Toolbar } from '../editor/Toolbar.tsx';
import type { DetailsTab, DialogName, PanelName, Ui } from '../editor/ui.ts';
import { useSession } from '../editor/useSession.ts';
import { setInboxUnread } from '../inbox.ts';
import { location$, navigate } from '../router.ts';
import { useSignal } from '../signal.ts';
import { InboxButton } from '../ui/InboxButton.tsx';
import { Modal } from '../ui/Modal.tsx';

type Kind = 'phone' | 'tablet' | 'desk';

const kindOf = (): Kind => (window.innerWidth < 768 ? 'phone' : window.innerWidth < 1280 ? 'tablet' : 'desk');

function useKind(): Kind {
  const [kind, setKind] = useState<Kind>(kindOf());
  useLayoutEffect(() => {
    const onResize = (): void => setKind(kindOf());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return kind;
}

function Gone(props: { why: 'access' | 'expired' | 'revoked' | 'missing'; account: boolean }) {
  const text = {
    access: 'You no longer have access to this map.',
    expired: 'This link has expired.',
    revoked: "This link was turned off by the map's owner.",
    missing: "We couldn't find that map.",
  }[props.why];
  return (
    <main class="gone">
      <h1>{text}</h1>
      {props.account ? (
        <a class="btn btn-primary" href="/maps" onClick={(event) => { event.preventDefault(); navigate('/maps'); }}>
          Your maps
        </a>
      ) : null}
    </main>
  );
}

export function Editor(props: { mapId: string }) {
  const [state, setState] = useState<{ session: MapSession } | { gone: 'missing' } | null>(null);
  useLayoutEffect(() => {
    let live: MapSession | null = null;
    let cancelled = false;
    api<MapPayload>('GET', `/api/maps/${props.mapId}`)
      .then((payload) => {
        if (cancelled) return;
        live = new MapSession(payload);
        setState({ session: live });
      })
      .catch((error: unknown) => {
        if (!(error instanceof HttpError)) throw error;
        if (error.code === 'unauthenticated' || error.code === 'session_expired') navigate('/signin', { replace: true });
        else if (error.code === 'link_expired' || error.code === 'link_revoked') setState({ gone: 'missing' });
        else setState({ gone: 'missing' });
      });
    return () => {
      cancelled = true;
      live?.stop();
    };
  }, [props.mapId]);
  if (!state) return <main class="loading" aria-busy="true"><p role="status">Loading map</p></main>;
  if ('gone' in state) return <Gone why="missing" account />;
  return <Shell session={state.session} />;
}

function Shell(props: { session: MapSession }) {
  const { session } = props;
  useSession(session);
  const kind = useKind();
  const search = useSignal(location$);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [tab, setTab] = useState<DetailsTab>('notes');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [tools, setTools] = useState(false);
  const [outlineSheet, setOutlineSheet] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [target, setTarget] = useState('');
  const startButton = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);

  useLayoutEffect(() => {
    if (session.inboxEvent >= 0) setInboxUnread(session.inboxEvent);
  }, [session.inboxEvent]);

  useLayoutEffect(() => {
    session.onFocusBranchGone(() => navigate(`/m/${session.mapId}`, { replace: true }));
    session.onSkippedSlides((skipped) => {
      for (const skip of skipped) {
        session.notice(skip.reason === 'deleted' ? `Slide ${skip.index + 1} was skipped: its topic was deleted.` : `Slide ${skip.index + 1} was skipped: it is restricted.`);
      }
    });
  }, [session]);

  // The URL carries the selected topic, an open comment and the focused branch.
  const ready = session.size.w > 0;
  useLayoutEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(search.split('?')[1] ?? '');
    const topic = params.get('topic');
    const focus = params.get('focus');
    if (focus) {
      if (session.display.topics[focus]) {
        if (session.focusBranch !== focus) {
          session.focusBranch = focus;
          session.requestFocus(focus);
          queueMicrotask(() => session.fit());
        }
      } else {
        session.focusBranch = null;
        session.notice(COPY.missing_topic);
        navigate(`/m/${session.mapId}`, { replace: true });
      }
    } else if (session.focusBranch) {
      session.focusBranch = null;
      session.notify();
    }
    if (topic) {
      if (session.display.topics[topic]) {
        session.requestFocus(topic);
        if (params.get('comment')) {
          setTab('comments');
          setPanel('details');
        }
      } else {
        session.notice(COPY.missing_topic);
        navigate(`/m/${session.mapId}${focus ? `?focus=${focus}` : ''}`, { replace: true });
      }
    } else if (!focus && !session.focusWanted && document.activeElement === document.body) {
      session.requestFocus(session.focusId);
    }
  }, [ready, search]);

  const ui: Ui = {
    dialog,
    panel,
    tab,
    openDialog: (name) => {
      setTarget(session.focusId);
      setDialog(name);
    },
    togglePanel: (name) => setPanel(panel === name ? null : name),
    openFind: () => setFindOpen(true),
    focusBranch: () => navigate(`/m/${session.mapId}?focus=${encodeURIComponent(session.focusId)}`),
    addBoundary: () => {
      if (!session.guardEdit()) return;
      session.submit([{ op_id: newOpId(), kind: 'boundary_add', boundary_id: `b${newOpId().slice(0, 12)}`, topic_id: session.focusId, label: '' }]);
    },
    startPresentation: () => {
      startButton.current = document.activeElement as HTMLElement | null;
      void startPresentation(session).then(() => setPanel('presenter'));
    },
  };

  const openMenu = (id: string): void => {
    const element = document.querySelector<HTMLElement>(`[data-topic-id="${CSS.escape(id)}"]`);
    const rect = element?.getBoundingClientRect();
    const x = Math.max(8, Math.min(window.innerWidth - 220, rect?.left ?? 16));
    const y = Math.max(8, Math.min(window.innerHeight - 280, (rect?.bottom ?? 80) + 6));
    session.setFocus(id);
    setMenu({ id, x, y });
  };

  const actions: CanvasActions = useMemo(
    () => ({
      openMenu,
      openFind: () => setFindOpen(true),
      focusBranch: () => ui.focusBranch(),
      openLink: () => ui.openDialog('link'),
      addBoundary: () => ui.addBoundary(),
      openComment: () => setPanel('details'),
    }),
    [session],
  );

  // F6 moves around the map, the toolbar and the open panels; Escape and the arrows drive a presentation.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'F6') {
        event.preventDefault();
        const regions: (HTMLElement | null)[] = [
          document.querySelector<HTMLElement>('.tree [tabindex="0"]'),
          document.querySelector<HTMLElement>('[role="toolbar"] button'),
          document.querySelector<HTMLElement>('.rail [tabindex="0"]'),
          document.querySelector<HTMLElement>('[data-region="panel"], .side input, .side button, .side textarea'),
        ].filter((el) => el !== null);
        const containers = ['.tree', '[role="toolbar"]', '.rail', '.side, [data-region="panel"]'];
        const active = document.activeElement;
        const current = containers.findIndex((c) => active?.closest(c));
        const present = regions.map((el, at) => ({ el, at })).filter((r) => r.el !== null);
        if (present.length === 0) return;
        const index = present.findIndex((r) => r.at === current);
        const step = event.shiftKey ? -1 : 1;
        const next = present[(index + step + present.length) % present.length];
        next?.el?.focus();
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [role="tree"], dialog, [role="menu"], [role="slider"]')) return;
      const presenting = session.presentation && session.presentation.state !== 'ended';
      if (!presenting) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        void endPresentation(session).then(() => {
          setPanel(null);
          startButton.current?.focus();
          document.querySelector<HTMLElement>('button[aria-label="Start presentation"]')?.focus();
        });
      } else if (session.presentation?.state === 'live' && (event.key === 'ArrowRight' || event.key === ' ')) {
        event.preventDefault();
        void stepSlide(session, 1);
      } else if (session.presentation?.state === 'live' && event.key === 'ArrowLeft') {
        event.preventDefault();
        void stepSlide(session, -1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [session]);

  if (session.removed) return <Gone why={session.removed} account={!session.me.guest} />;

  const menuActions = (id: string): MenuAction[] => {
    const topic = session.display.topics[id];
    const list: MenuAction[] = [];
    if (session.canEdit) {
      list.push({ name: 'Add child', run: () => { session.setFocus(id); session.addChild(id); } });
      list.push({ name: 'Add sibling', run: () => { session.setFocus(id); session.addSibling(id); } });
      list.push({ name: 'Rename', run: () => session.startRename(id, null) });
    }
    list.push({ name: session.collapsed.has(id) ? 'Expand' : 'Collapse', run: () => session.toggleCollapse(id) });
    list.push({ name: 'Open details', run: () => { session.setFocus(id); setTab('notes'); setPanel('details'); } });
    if (session.canEdit && topic) list.push({ name: 'Delete', run: () => { session.setFocus(id); session.deleteSelection(); } });
    return list;
  };

  const phone = kind === 'phone';
  const railOpen = kind === 'desk' || (kind === 'tablet' && outlineOpen);
  const side = !phone && panel !== null;

  const panelBody = (which: PanelName) => {
    if (which === 'details') return <Details session={session} topicId={session.focusId} tab={tab} onTab={setTab} onClose={() => setPanel(null)} />;
    if (which === 'activity') return <Activity session={session} />;
    return <Presenter session={session} />;
  };

  return (
    <div class={`editor kind-${kind}`}>
      <Announcer session={session} />
      <header class="editor-bar">
        {phone ? (
          <button type="button" class="btn btn-secondary editor-bar-button" aria-label="Tools" onClick={() => setTools(true)}>
            <Glyph name="tools" size={18} /> <span class="bar-label">Tools</span>
          </button>
        ) : (
          <a class="editor-bar-back" href="/maps" onClick={(event) => { event.preventDefault(); navigate('/maps'); }}>
            <Glyph name="chevron" size={16} /> Your maps
          </a>
        )}
        <h1 class="editor-bar-title">{session.header.title}</h1>
        {kind !== 'desk' ? (
          <button
            type="button"
            class="btn btn-secondary editor-bar-button"
            aria-label="Outline"
            aria-expanded={phone ? undefined : outlineOpen}
            onClick={() => (phone ? setOutlineSheet(true) : setOutlineOpen(!outlineOpen))}
          >
            <Glyph name="outline" size={18} /> <span class="bar-label">Outline</span>
          </button>
        ) : null}
        <People session={session} />
        <InboxButton />
      </header>
      {phone ? null : <Toolbar session={session} ui={ui} drawer={false} />}
      <div class="workspace">
        {railOpen ? (
          <aside class="rail" aria-label="Outline">
            <Outline session={session} />
          </aside>
        ) : null}
        <div class="canvas-wrap">
          <div class="overlays">
            <Notices session={session} />
            <ConnectionBanner session={session} />
            <RecoveredBand session={session} />
          </div>
          {findOpen ? (
            <FindBar
              session={session}
              onClose={() => {
                setFindOpen(false);
                session.setFind({ query: '', assignee: '', icon: '', state: '' });
                session.requestFocus(session.focusId);
              }}
            />
          ) : null}
          <Canvas session={session} actions={actions} />
        </div>
        {side ? (
          <div class={`side side-${panel}`}>
            {panel === 'details' ? (
              <aside aria-label="Topic details" class="details-aside">
                {panelBody('details')}
              </aside>
            ) : (
              panelBody(panel)
            )}
          </div>
        ) : null}
      </div>
      {phone && tools ? (
        <Modal label="Tools" className="sheet drawer" onClose={() => setTools(false)}>
          <Toolbar session={session} ui={ui} drawer />
        </Modal>
      ) : null}
      {phone && outlineSheet ? (
        <Modal label="Outline" className="sheet" onClose={() => setOutlineSheet(false)}>
          <div class="sheet-body">
            <h2 class="dialog-title">Outline</h2>
            <Outline session={session} />
          </div>
        </Modal>
      ) : null}
      {phone && panel === 'details' ? (
        <Modal label="Topic" className="sheet" onClose={() => setPanel(null)}>
          <div class="sheet-body">{panelBody('details')}</div>
        </Modal>
      ) : null}
      {phone && panel === 'activity' ? (
        <Modal label="Activity panel" className="sheet" onClose={() => setPanel(null)}>
          <div class="sheet-body">{panelBody('activity')}</div>
        </Modal>
      ) : null}
      {phone && panel === 'presenter' ? <div class="presenter-dock">{panelBody('presenter')}</div> : null}
      {dialog === 'share' ? <ShareDialog session={session} onClose={() => setDialog(null)} /> : null}
      {dialog === 'history' ? <HistoryDialog session={session} onClose={() => setDialog(null)} /> : null}
      {dialog === 'export' ? <ExportDialog session={session} onClose={() => setDialog(null)} /> : null}
      {dialog === 'import' ? <ImportDialog session={session} target={target} onClose={() => setDialog(null)} /> : null}
      {dialog === 'save' ? <SaveVersionDialog session={session} onClose={() => setDialog(null)} /> : null}
      {dialog === 'link' ? <LinkDialog session={session} from={target} onClose={() => setDialog(null)} /> : null}
      {session.expired ? <SessionDialog session={session} /> : null}
      {menu ? <TopicMenu session={session} topicId={menu.id} anchor={{ x: menu.x, y: menu.y }} actions={menuActions(menu.id)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
