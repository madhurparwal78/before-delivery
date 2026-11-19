import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { configSignal, loadConfig } from '../config';
import { navigate } from '../router';
import { localeOf } from '../session';
import { Dialog, Notices } from '../ui';
import type { Workspace as WorkspaceData } from '../../shared/types';
import { useRequireMe } from '../pages/Projects';
import { Activity } from './Activity';
import { CommandPalette } from './CommandPalette';
import { CommentDialog, Comments } from './Comments';
import { hotkey, redo, undo } from './draw';
import { ExportDialog } from './ExportDialog';
import { Frames } from './Frames';
import { Layers } from './Layers';
import { Model } from './model';
import { Palette } from './Palette';
import { PreviewPanel } from './PreviewPanel';
import { Snapshots } from './Snapshots';
import { Stage } from './Stage';
import { connect, disconnect, setupNetwork } from './sync';
import { Tiles } from './Tiles';
import { Toolbar } from './Toolbar';
import { openWhenQuiet } from '../stream';
import { useModel } from './use-model';

type Layout = 'phone' | 'tablet' | 'desktop';

function useLayout(): Layout {
  const read = (): Layout => (matchMedia('(min-width: 1100px)').matches ? 'desktop' : matchMedia('(min-width: 700px)').matches ? 'tablet' : 'phone');
  const [layout, setLayout] = useState<Layout>(read);
  useEffect(() => {
    const queries = [matchMedia('(min-width: 1100px)'), matchMedia('(min-width: 700px)')];
    const update = (): void => setLayout(read());
    queries.forEach((q) => q.addEventListener('change', update));
    update();
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return layout;
}

function TopBar({ m, children }: { m: Model; children?: JSX.Element }): JSX.Element {
  useModel(m);
  const visible = configSignal.get()?.presence_visible ?? 4;
  const idleMs = (configSignal.get()?.idle_seconds ?? 300) * 1000;
  const people = [...m.presence].sort((a, b) => a.joined - b.joined);
  const now = m.businessNow();
  return (
    <header class="topbar">
      <div class="crumbs">
        <a href={`/projects/${m.projectId}`} data-route class="crumb">
          {m.projectName}
        </a>
        <h1>{m.spriteName}</h1>
      </div>
      <ul aria-label="On this sprite" class="presence">
        {people.slice(0, visible).map((person) => (
          <li key={person.id} aria-label={person.name} data-idle={String(now - person.lastActive >= idleMs)} class="person">
            <span class="dot" aria-hidden="true" />
            {person.name}
          </li>
        ))}
        {people.length > visible && (
          <li aria-label={`+${people.length - visible}`} class="person more" data-idle="false">
            +{people.length - visible}
          </li>
        )}
      </ul>
      <div role="status" aria-label="Sync status" class="sync">
        {m.syncLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      {m.canEdit && (
        <button
          type="button"
          class="pill"
          onClick={() => {
            m.exportOpen = true;
            m.changed();
          }}
        >
          Export
        </button>
      )}
      {children}
    </header>
  );
}

function LiveStrip({ m }: { m: Model }): JSX.Element {
  useModel(m);
  return (
    <div class="live-strip">
      <div role="status" aria-label="Stage announcements" class="announce">
        {m.announcement}
      </div>
      <div role="status" aria-label="List announcements" class="announce">
        {m.listAnnouncement}
      </div>
      <div role="status" aria-label="Team announcements" class="announce team">
        {m.team.map((line, i) => (
          <div key={`${i}-${line}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function CanvasArea({ m, narrow }: { m: Model; narrow: boolean }): JSX.Element {
  useModel(m);
  return (
    <div class="canvas-area">
      <Toolbar m={m} part="tools" />
      <Toolbar m={m} part="options" />
      {m.role === 'reviewer' && <p class="refusal">Reviewers can't draw</p>}
      <Stage m={m} narrow={narrow} />
    </div>
  );
}

function PreviewFor({ m }: { m: Model }): JSX.Element {
  useModel(m);
  return <PreviewPanel m={m} />;
}

function MorePanels({ m, onClose }: { m: Model; onClose: () => void }): JSX.Element {
  return (
    <Dialog label="More panels" onClose={onClose} class="sheet">
      <div class="sheet-bar">
        <h2>More panels</h2>
        <button type="button" class="pill small" onClick={onClose}>
          Close
        </button>
      </div>
      <Tiles m={m} />
      <Comments m={m} />
      <Snapshots m={m} />
      <Activity m={m} />
    </Dialog>
  );
}

const TABS = ['Canvas', 'Layers', 'Frames', 'Palette'] as const;

function Phone({ m }: { m: Model }): JSX.Element {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Canvas');
  const [more, setMore] = useState(false);
  const onKeyDown = (event: KeyboardEvent): void => {
    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (move === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + move + TABS.length) % TABS.length] ?? 'Canvas';
    setTab(next);
    queueMicrotask(() => document.getElementById(`tab-${next}`)?.focus());
  };
  const panel = (
    <div class="tab-area" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'Canvas' && <CanvasArea m={m} narrow />}
      {tab === 'Layers' && <Layers m={m} />}
      {tab === 'Frames' && (
        <>
          <Frames m={m} />
          <PreviewFor m={m} />
        </>
      )}
      {tab === 'Palette' && <Palette m={m} />}
    </div>
  );
  const dock = (
    <div class="dock">
      <div role="tablist" aria-label="Workspace" onKeyDown={onKeyDown}>
        {TABS.map((name) => (
          <button key={name} id={`tab-${name}`} type="button" role="tab" class="tab" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div class="ws phone">
      <TopBar m={m}>
        <button type="button" class="pill small" onClick={() => setMore(true)}>
          More panels
        </button>
      </TopBar>
      <LiveStrip m={m} />
      {tab === 'Canvas' ? (
        <>
          {panel}
          {dock}
        </>
      ) : (
        <>
          {dock}
          {panel}
        </>
      )}
      {more && <MorePanels m={m} onClose={() => setMore(false)} />}
    </div>
  );
}

function Tablet({ m }: { m: Model }): JSX.Element {
  const [more, setMore] = useState(false);
  return (
    <div class="ws tablet">
      <TopBar m={m} />
      <LiveStrip m={m} />
      <CanvasArea m={m} narrow={false} />
      <div class="dock-panels">
        <Palette m={m} />
        <Layers m={m} />
        <div class="stack">
          <Frames m={m} />
          <PreviewFor m={m} />
        </div>
      </div>
      <div class="more-row">
        <button type="button" class="pill" onClick={() => setMore(true)}>
          More panels
        </button>
      </div>
      {more && <MorePanels m={m} onClose={() => setMore(false)} />}
    </div>
  );
}

function Desktop({ m }: { m: Model }): JSX.Element {
  return (
    <div class="ws desktop">
      <TopBar m={m} />
      <LiveStrip m={m} />
      <div class="panes">
        <aside class="pane left">
          <Palette m={m} />
          <Layers m={m} />
        </aside>
        <section class="pane centre">
          <CanvasArea m={m} narrow={false} />
          <Frames m={m} />
        </section>
        <aside class="pane right">
          <PreviewFor m={m} />
          <Tiles m={m} />
          <Comments m={m} />
          <Snapshots m={m} />
          <Activity m={m} />
        </aside>
      </div>
    </div>
  );
}

const TEXT_ENTRY = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=file]), textarea, select, [contenteditable=""], [contenteditable="true"]';

export function WorkspacePage({ spriteId }: { spriteId: number }): JSX.Element {
  const me = useRequireMe();
  const [model, setModel] = useState<Model | null | undefined>(undefined);
  const layout = useLayout();
  const ref = useRef<Model | null>(null);

  useEffect(() => {
    if (!me) return;
    let stopped = false;
    let cancelOpen = (): void => undefined;
    void (async () => {
      await loadConfig();
      const result = await api<WorkspaceData>('GET', `/api/sprites/${spriteId}/workspace`);
      if (stopped) return;
      if (!result.ok) return setModel(null);
      const created = new Model(result.body, localeOf(me));
      ref.current = created;
      setModel(created);
      // The live channel opens once the page has settled; events missed meanwhile replay from `since`.
      cancelOpen = openWhenQuiet(() => connect(created, true));
    })();
    return () => {
      stopped = true;
      cancelOpen();
      if (ref.current) disconnect(ref.current);
    };
  }, [me?.id, spriteId]);

  useLayoutEffect(() => {
    if (!model) return;
    const stopNetwork = setupNetwork(model);
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches(TEXT_ENTRY) ?? false;
      const modal = target?.closest('dialog') !== null && target?.closest('dialog') !== undefined;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!model.commandPaletteOpen && !modal) {
          model.commandPaletteOpen = true;
          model.changed();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        void (event.shiftKey ? redo(model) : undo(model));
        return;
      }
      if (typing || modal) return;
      const inMap = target?.closest('[role=grid][aria-label=Tilemap]') !== null && target?.closest('[role=grid][aria-label=Tilemap]') !== undefined;
      if (inMap && event.key.toLowerCase() === 'c') return;
      if (hotkey(model, event)) event.preventDefault();
    };
    addEventListener('keydown', onKeyDown);
    const clock = setInterval(() => model.changed(), 15000);
    return () => {
      removeEventListener('keydown', onKeyDown);
      clearInterval(clock);
      stopNetwork();
    };
  }, [model]);

  useEffect(() => {
    if (model === null) navigate('/projects', true);
  }, [model]);

  if (!model) {
    return (
      <div class="ws loading">
        <p class="loading-outline" aria-busy="true">
          Loading workspace
        </p>
        <Notices />
      </div>
    );
  }
  return (
    <>
      {layout === 'desktop' ? <Desktop m={model} /> : layout === 'tablet' ? <Tablet m={model} /> : <Phone m={model} />}
      <CommentDialog m={model} />
      <ExportDialog m={model} />
      <CommandPalette m={model} />
      <Notices />
    </>
  );
}
