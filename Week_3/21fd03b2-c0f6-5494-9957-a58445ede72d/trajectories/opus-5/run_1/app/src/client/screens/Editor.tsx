import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AssetRow, CheckpointRow, ProjectRow, SceneRow } from '../../shared/api.js';
import { bannerCopy, emptyCopy, pageCopy, saveStatusCopy } from '../../shared/copy.js';
import { roundTo } from '../../shared/dmath.js';
import type { RigKind } from '../../shared/params.js';
import type { Vec3 } from '../../shared/scene.js';
import { canAdminister, canEditScenes } from '../../shared/states.js';
import { ApiFault, api } from '../api.js';
import { AccountMenu } from '../components/AccountMenu.jsx';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, ToolbarDivider, Wordmark } from '../components/Toolbar.jsx';
import { AssetsPanel } from '../editor/AssetsPanel.jsx';
import { Inspector } from '../editor/Inspector.jsx';
import { Outline } from '../editor/Outline.jsx';
import { PropsPanel } from '../editor/PropsPanel.jsx';
import { Stage, CAMERA_VIEWS, type CameraView, type CursorMark } from '../editor/Stage.jsx';
import { Telemetry } from '../editor/Telemetry.jsx';
import {
  CommandsDialog,
  ConflictDialog,
  PublishDialog,
  RestoreDialog,
  ShareDialog,
  ShortcutsDialog,
  type Command,
} from '../editor/dialogs.jsx';
import { DEFAULT_PANELS, PANEL_TITLES, useLayout, type PanelState, type PanelTitle } from '../editor/layout.js';
import { EditorSession } from '../editor/session.js';
import { announce } from '../regions.js';
import { useSession } from '../session.js';
import { NotFound } from './NotFound.jsx';

type Tool = 'Move' | 'Rotate' | 'Scale';
type DialogName = 'commands' | 'shortcuts' | 'publish' | 'share' | null;

const TEXT_INPUTS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function inTextField(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  if (!TEXT_INPUTS.has(active.tagName)) return false;
  const type = (active as HTMLInputElement).type;
  return type !== 'checkbox' && type !== 'radio' && type !== 'range';
}

export function Editor({
  workspaceId,
  sceneId,
}: {
  workspaceId: string;
  sceneId: string;
}): JSX.Element {
  const { me } = useSession();
  const layout = useLayout();
  const session = useMemo(() => new EditorSession(sceneId, workspaceId), [sceneId, workspaceId]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);

  const [panels, setPanels] = useState<Record<PanelTitle, PanelState>>(DEFAULT_PANELS);
  const [sheetTab, setSheetTab] = useState<PanelTitle>('Outline');
  const [tool, setTool] = useState<Tool>('Move');
  const [snap, setSnap] = useState(false);
  const [grid, setGrid] = useState(true);
  const [colliders, setColliders] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<DialogName>(null);
  const [windowsOpen, setWindowsOpen] = useState(false);
  const [restoring, setRestoring] = useState<CheckpointRow | null>(null);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);
  const [view, setView] = useState<CameraView | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const dragPanel = useRef<{ title: PanelTitle; x: number; y: number } | null>(null);

  useEffect(() => {
    void session.start();
    return () => session.stop();
  }, [session]);

  const loadProject = (): void => {
    if (!state.scene) return;
    void api<{ project: ProjectRow; scenes: SceneRow[]; assets: AssetRow[] }>(
      `/api/projects/${state.scene.projectId}`,
    )
      .then((response) => setAssets(response.assets))
      .catch(() => undefined);
  };

  useEffect(loadProject, [state.scene?.projectId]);

  const document_ = state.document;
  const selected = document_?.objects.find((object) => object.id === state.selectedId) ?? null;
  const canEdit = canEditScenes(state.role) && state.status.locks === 'ok';
  const owner = canAdminister(state.role);
  const viewOnly = !canEditScenes(state.role);
  const running = state.mode !== 'edit';
  const lockedOut = state.lockHolder !== null;

  /* ------------------------------------------------------ commands --- */

  const place = (kind: RigKind, point: Vec3): void => {
    const rounded: Vec3 = snap
      ? [roundTo(Math.round(point[0] / 0.25) * 0.25, 6), 0, roundTo(Math.round(point[2] / 0.25) * 0.25, 6)]
      : [roundTo(point[0], 6), 0, roundTo(point[2], 6)];
    session.addRig(kind, rounded);
  };

  const nudge = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!selected || !canEdit || running || lockedOut) return;
    const fine = event.shiftKey;
    const step = snap ? 0.25 : fine ? 0.01 : 0.1;
    const key = event.key;
    if (tool === 'Move') {
      const axes: Record<string, number> = {
        ArrowLeft: 0,
        ArrowRight: 0,
        PageUp: 1,
        PageDown: 1,
        ArrowUp: 2,
        ArrowDown: 2,
      };
      const axis = axes[key];
      if (axis === undefined) return;
      event.preventDefault();
      const direction =
        key === 'ArrowRight' || key === 'PageUp' || key === 'ArrowDown' ? 1 : -1;
      const next = [...selected.position];
      let moved = next[axis] + step * direction;
      if (snap) moved = Math.round(moved / 0.25) * 0.25;
      next[axis] = moved;
      session.setTransform(
        selected.id,
        'position',
        next.map((part) => roundTo(part, 6)),
      );
      return;
    }
    if (tool === 'Rotate' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      const degrees = (snap ? 15 : 5) * (key === 'ArrowRight' ? 1 : -1);
      const current = 2 * Math.atan2(selected.rotation[1], selected.rotation[3]);
      const next = current + (degrees * Math.PI) / 180;
      session.setTransform(selected.id, 'rotation', [
        0,
        roundTo(Math.sin(next / 2), 6),
        0,
        roundTo(Math.cos(next / 2), 6),
      ]);
      return;
    }
    if (tool === 'Scale' && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault();
      const delta = key === 'ArrowUp' ? 0.1 : -0.1;
      const next = selected.scale.map((part) => roundTo(Math.max(0.01, part + delta), 6));
      session.setTransform(selected.id, 'scale', next);
    }
  };

  const commands: Command[] = useMemo(() => {
    const list: Command[] = [
      { label: 'Run', run: () => session.startRun() },
      { label: 'Stop', run: () => session.stopRun() },
      { label: 'Pause', run: () => session.pauseRun() },
      { label: 'Step', run: () => session.stepRun() },
      { label: 'Add ramp', run: () => session.addRig('ramp', [0, 0, 0]) },
      { label: 'Add pendulum', run: () => session.addRig('pendulum', [0, 0, 0]) },
      { label: 'Add launcher', run: () => session.addRig('launcher', [0, 0, 0]) },
      { label: 'Add crate', run: () => session.addRig('crate', [0, 0, 0]) },
      { label: 'Toggle snap', run: () => setSnap((value) => !value) },
      { label: 'Toggle grid', run: () => setGrid((value) => !value) },
      { label: 'Undo', run: () => session.undo() },
      { label: 'Redo', run: () => session.redo() },
      {
        label: 'New checkpoint',
        run: () => {
          setPanels((current) => ({ ...current, Assets: { ...current.Assets, open: true } }));
          setSheetTab('Assets');
        },
      },
      { label: 'Open publish', run: () => setDialog('publish') },
      { label: 'Open share', run: () => setDialog('share') },
      { label: 'Reset layout', run: () => setPanels(DEFAULT_PANELS) },
    ];
    for (const object of document_?.objects ?? [])
      list.push({ label: `Select ${object.name}`, run: () => void session.select(object.id) });
    return list;
  }, [document_, session]);

  /* ----------------------------------------------------- shortcuts --- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDialog('commands');
        return;
      }
      if (dialog !== null || state.conflict !== null || restoring !== null) return;
      if (inTextField()) return;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) session.redo();
        else session.undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        session.redo();
        return;
      }
      if (modifier) return;
      switch (event.key) {
        case 'r':
        case 'R':
          event.preventDefault();
          if (state.mode === 'edit') session.startRun();
          else session.stopRun();
          break;
        case 'p':
        case 'P':
          session.pauseRun();
          break;
        case 'n':
        case 'N':
          session.stepRun();
          break;
        case 'Escape':
          if (state.mode !== 'edit') session.stopRun();
          else void session.select(null);
          break;
        case 'w':
        case 'W':
          setTool('Move');
          break;
        case 'e':
        case 'E':
          setTool('Rotate');
          break;
        case 't':
        case 'T':
          setTool('Scale');
          break;
        case 's':
        case 'S':
          setSnap((value) => !value);
          break;
        case 'g':
        case 'G':
          setGrid((value) => !value);
          break;
        case 'f':
        case 'F':
          setView('Iso');
          break;
        case 'F2':
          if (state.selectedId && canEdit) setRenameRequest(state.selectedId);
          break;
        case 'Delete':
        case 'Backspace':
          if (state.selectedId && canEdit && !running) session.remove(state.selectedId);
          break;
        case '?':
          setDialog('shortcuts');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, dialog, state.mode, state.selectedId, state.conflict, restoring, canEdit, running]);

  /* ------------------------------------------------------- restore --- */

  const restore = async (checkpoint: CheckpointRow): Promise<void> => {
    setRestoring(null);
    try {
      await api(`/api/scenes/${sceneId}/checkpoints/${checkpoint.id}/restore`, {
        method: 'POST',
        body: {},
      });
      announce('save', saveStatusCopy.restored(checkpoint.label));
      void session.loadCheckpoints();
    } catch (error) {
      if (!(error instanceof ApiFault)) return;
      if (error.code === 'locks_held') announce('save', saveStatusCopy.restoreRefused);
      else announce('notices', error.message);
    }
  };

  if (state.missing) return <NotFound />;

  const cursors: CursorMark[] = state.people
    .filter((person) => person.userId !== session.myUserId && person.cursor !== null)
    .map((person) => ({
      key: person.userId,
      label: person.displayName,
      point: person.cursor as Vec3,
    }));

  const extents = new Map<string, number>(
    assets
      .filter((asset) => asset.extentMetres !== null)
      .map((asset) => [asset.id, asset.extentMetres as number]),
  );

  const panelContent = (title: PanelTitle): JSX.Element => {
    if (!document_) return <p className="empty">{pageCopy.loading}</p>;
    if (title === 'Outline')
      return (
        <Outline
          document={document_}
          selectedId={state.selectedId}
          locks={state.locks}
          hiddenIds={hiddenIds}
          canEdit={canEdit && !running}
          myUserId={session.myUserId}
          renameRequest={renameRequest}
          onRenameHandled={() => setRenameRequest(null)}
          onSelect={(objectId) => void session.select(objectId)}
          onRename={(objectId, name) => session.rename(objectId, name)}
          onToggleHidden={(objectId) =>
            setHiddenIds((current) => {
              const next = new Set(current);
              if (next.has(objectId)) next.delete(objectId);
              else next.add(objectId);
              return next;
            })
          }
          onAdd={() => {
            setPanels((current) => ({ ...current, Props: { ...current.Props, open: true } }));
            setSheetTab('Props');
          }}
        />
      );
    if (title === 'Inspector')
      return (
        <Inspector
          document={document_}
          selected={selected}
          readOnly={viewOnly || lockedOut || running}
          lockHolder={state.lockHolder}
          onSetParam={(objectId, key, value) => session.setParam(objectId, key, value)}
          onSetPosition={(objectId, axis, value) => {
            const object = document_.objects.find((candidate) => candidate.id === objectId);
            if (!object) return;
            const next = [...object.position];
            next[axis] = value;
            session.setTransform(objectId, 'position', next);
          }}
          onSetSceneName={(name) => session.setSceneField('name', name)}
          onSetGravity={(value) => session.setSceneField('gravity', value)}
          onFieldError={(key, invalid) => session.markFieldError(key, invalid)}
        />
      );
    if (title === 'Props')
      return (
        <PropsPanel
          models={assets.filter((asset) => asset.extentMetres !== null)}
          canEdit={canEdit && !running}
          onAddRig={(kind) => session.addRig(kind, [0, 0, 0])}
          onAddModel={(asset) => session.addModel(asset, [0, 0, 0])}
        />
      );
    return (
      <AssetsPanel
        projectId={state.scene?.projectId ?? ''}
        sceneId={sceneId}
        assets={assets}
        checkpoints={state.checkpoints}
        canEdit={canEdit && !running}
        onAssetsChanged={loadProject}
        onCheckpointSaved={() => void session.loadCheckpoints()}
        onRestoreRequest={(checkpoint) => setRestoring(checkpoint)}
      />
    );
  };

  const panelFrame = (title: PanelTitle, index: number): JSX.Element | null => {
    const panel = panels[title];
    if (!panel.open || running) return null;
    const offsets: Record<PanelTitle, React.CSSProperties> = {
      Outline: { left: 8, top: 112 },
      Props: { left: 8, bottom: 32 },
      Inspector: { right: 8, top: 150 },
      Assets: { left: 290, bottom: 8, width: 430 },
    };
    const style: React.CSSProperties = panel.offset
      ? { left: panel.offset.x, top: panel.offset.y }
      : offsets[title];
    return (
      <section
        key={title}
        className={panel.maximised ? 'panel floating maximised' : 'panel floating'}
        aria-label={title}
        style={panel.maximised ? undefined : style}
      >
        <header
          className="panel-head"
          onPointerDown={(event) => {
            dragPanel.current = { title, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const active = dragPanel.current;
            if (!active || active.title !== title) return;
            const box = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const dx = event.clientX - active.x;
            const dy = event.clientY - active.y;
            dragPanel.current = { title, x: event.clientX, y: event.clientY };
            setPanels((current) => ({
              ...current,
              [title]: {
                ...current[title],
                offset: { x: box.left + dx, y: box.top + dy },
              },
            }));
          }}
          onPointerUp={() => {
            dragPanel.current = null;
          }}
        >
          <h2 className="panel-title">{title}</h2>
          <span className="spacer" />
          <button
            type="button"
            className="ghost"
            aria-label={`Maximise ${title}`}
            onClick={() =>
              setPanels((current) => ({
                ...current,
                [title]: { ...current[title], maximised: !current[title].maximised },
              }))
            }
          >
            []
          </button>
          <button
            type="button"
            className="ghost"
            aria-label={`Close ${title}`}
            onClick={() =>
              setPanels((current) => ({
                ...current,
                [title]: { ...current[title], open: false },
              }))
            }
          >
            x
          </button>
        </header>
        <div className="panel-body" data-index={index}>
          {panelContent(title)}
        </div>
      </section>
    );
  };

  return (
    <div className="editor">
      <Toolbar>
        <button
          type="button"
          data-chip
          className={running ? 'chip go' : 'chip'}
          onClick={() => (state.mode === 'edit' ? session.startRun() : session.stopRun())}
        >
          {state.mode === 'edit' ? 'Run' : 'Stop'}
        </button>
        <button
          type="button"
          data-chip
          className="chip"
          disabled={state.mode === 'edit'}
          onClick={() => session.pauseRun()}
        >
          {state.mode === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          data-chip
          className="chip"
          disabled={state.mode === 'edit'}
          onClick={() => session.stepRun()}
        >
          Step
        </button>
        <ToolbarDivider />
        {(['Move', 'Rotate', 'Scale'] as const).map((name) => (
          <button
            key={name}
            type="button"
            data-chip
            className="chip"
            aria-pressed={tool === name}
            onClick={() => setTool(name)}
          >
            {name}
          </button>
        ))}
        <ToolbarDivider />
        <button
          type="button"
          data-chip
          className="chip"
          aria-pressed={snap}
          onClick={() => setSnap((value) => !value)}
        >
          Snap
        </button>
        <button
          type="button"
          data-chip
          className="chip"
          aria-pressed={grid}
          onClick={() => setGrid((value) => !value)}
        >
          Grid
        </button>
        <button
          type="button"
          data-chip
          className="chip"
          aria-pressed={colliders}
          onClick={() => setColliders((value) => !value)}
        >
          Colliders
        </button>
        <ToolbarDivider />
        <a
          className="chip lilac"
          data-chip
          href={state.scene ? `/w/${workspaceId}/p/${state.scene.projectId}` : `/w/${workspaceId}`}
        >
          Labs
        </a>
        <button
          type="button"
          data-chip
          className="chip lilac"
          aria-pressed={panels.Assets.open}
          onClick={() => {
            setPanels((current) => ({
              ...current,
              Assets: { ...current.Assets, open: !current.Assets.open },
            }));
            setSheetTab('Assets');
          }}
        >
          Assets
        </button>
        <button
          type="button"
          data-chip
          className="chip"
          disabled={!owner}
          aria-description={owner ? undefined : 'Only the workspace owner can share or publish.'}
          title={owner ? undefined : 'Only the workspace owner can share or publish.'}
          onClick={() => setDialog('share')}
        >
          Share
          {owner ? null : (
            <span aria-hidden="true" className="muted">
              {' '}
              [#]
            </span>
          )}
        </button>
        <button
          type="button"
          data-chip
          className="chip publish"
          disabled={!owner}
          aria-description={owner ? undefined : 'Only the workspace owner can share or publish.'}
          title={owner ? undefined : 'Only the workspace owner can share or publish.'}
          onClick={() => setDialog('publish')}
        >
          Publish
          {owner ? null : (
            <span aria-hidden="true" className="muted">
              {' '}
              [#]
            </span>
          )}
        </button>
        <button
          type="button"
          data-chip
          className="chip"
          aria-haspopup="menu"
          aria-expanded={windowsOpen}
          onClick={() => setWindowsOpen((value) => !value)}
        >
          Windows
        </button>
        <button type="button" data-chip className="chip" onClick={() => setDialog('shortcuts')}>
          Shortcuts
        </button>
        <ToolbarDivider />
        {state.status.locks === 'down' ? (
          <span className="muted">{emptyCopy.presenceDown}</span>
        ) : (
          <ul className="people" aria-label="People here">
            {state.people.map((person) => (
              <li key={person.userId}>{person.displayName}</li>
            ))}
          </ul>
        )}
        {viewOnly ? (
          <span className="pill-status" role="status">
            View only
          </span>
        ) : null}
        <ToolbarDivider />
        {me ? <AccountMenu me={me} workspaceId={workspaceId} /> : null}
        <Wordmark />
      </Toolbar>

      {windowsOpen ? (
        <div className="menu" role="menu" aria-label="Windows" style={{ top: 40 }}>
          {PANEL_TITLES.map((title) => (
            <button
              key={title}
              type="button"
              role="menuitemcheckbox"
              aria-checked={panels[title].open}
              onClick={() =>
                setPanels((current) => ({
                  ...current,
                  [title]: { ...current[title], open: !current[title].open },
                }))
              }
            >
              {title}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setPanels(DEFAULT_PANELS);
              setWindowsOpen(false);
            }}
          >
            Reset layout
          </button>
        </div>
      ) : null}

      {state.status.locks === 'down' ? (
        <div className="banner" role="alert">
          {bannerCopy.locks}
        </div>
      ) : null}
      {state.status.storage === 'down' ? (
        <div className="banner" role="alert">
          {bannerCopy.storage}
        </div>
      ) : null}

      <div className="editor-split">
        <div className="stage-wrap">
          <Stage
            document={document_}
            bodies={state.bodies}
            selectedId={state.selectedId}
            hiddenIds={hiddenIds}
            grid={grid}
            colliders={colliders}
            extents={extents}
            cursors={cursors}
            view={view}
            onPick={(objectId) => void session.select(objectId)}
            onHover={(point) => session.setCursor(point)}
            onKeyDown={nudge}
            onDropAt={(point, payload) => {
              if (!canEdit || running) return;
              if (payload.startsWith('rig:')) place(payload.slice(4) as RigKind, point);
              else if (payload.startsWith('model:')) {
                const asset = assets.find((candidate) => candidate.id === payload.slice(6));
                if (asset) session.addModel(asset, [roundTo(point[0], 6), 0, roundTo(point[2], 6)]);
              }
            }}
          />
          <Telemetry
            fps={state.fps}
            frameMs={state.frameMs}
            step={state.step}
            stateHash={state.stateHash}
          />
          {running ? (
            <>
              <span className="mode-pill" role="status" aria-label="Mode">
                {state.mode === 'paused' ? 'PAUSED' : 'RUNNING'}
              </span>
              <span className="centre-mark" role="img" aria-label="Centre mark">
                +
              </span>
            </>
          ) : (
            <div className="camera-widget" role="group" aria-label="Camera view">
              {CAMERA_VIEWS.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={
                    name === 'Iso'
                      ? 'chip iso'
                      : name === 'Top' || name === 'Bottom'
                        ? 'chip vertical'
                        : name === 'Front' || name === 'Back'
                          ? 'chip depth'
                          : 'chip horizontal'
                  }
                  onClick={() => setView(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {layout === 'floating' ? PANEL_TITLES.map((title, index) => panelFrame(title, index)) : null}
        </div>

        {layout === 'docked' && !running ? (
          <div className="docked-column">
            {PANEL_TITLES.filter((title) => panels[title].open).map((title) => (
              <section key={title} aria-label={title}>
                <div className="panel-head">
                  <h2 className="panel-title">{title}</h2>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`Close ${title}`}
                    onClick={() =>
                      setPanels((current) => ({
                        ...current,
                        [title]: { ...current[title], open: false },
                      }))
                    }
                  >
                    x
                  </button>
                </div>
                <div className="panel-body">{panelContent(title)}</div>
              </section>
            ))}
          </div>
        ) : null}
      </div>

      {layout === 'phone' && !running ? (
        <div className="sheet">
          <div role="tablist" aria-label="Panels">
            {PANEL_TITLES.map((title) => (
              <button
                key={title}
                type="button"
                role="tab"
                aria-selected={sheetTab === title}
                onClick={() => setSheetTab(title)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                  event.preventDefault();
                  const index = PANEL_TITLES.indexOf(sheetTab);
                  const next =
                    (index + (event.key === 'ArrowRight' ? 1 : -1) + PANEL_TITLES.length) %
                    PANEL_TITLES.length;
                  setSheetTab(PANEL_TITLES[next]);
                }}
                data-sheet-tab={title}
              >
                {title}
              </button>
            ))}
          </div>
          <section
            className="panel-body"
            aria-label={sheetTab}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              document
                .querySelector<HTMLElement>(`[data-sheet-tab="${sheetTab}"]`)
                ?.focus();
            }}
          >
            {panelContent(sheetTab)}
          </section>
        </div>
      ) : null}

      {dialog === 'commands' ? (
        <CommandsDialog commands={commands} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'shortcuts' ? <ShortcutsDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'publish' && state.scene && document_ ? (
        <PublishDialog
          scene={state.scene}
          document={document_}
          checkpoints={state.checkpoints}
          onClose={() => setDialog(null)}
          onPublished={() => void session.loadCheckpoints()}
        />
      ) : null}
      {dialog === 'share' && state.scene ? (
        <ShareDialog projectId={state.scene.projectId} onClose={() => setDialog(null)} />
      ) : null}
      {restoring ? (
        <RestoreDialog
          checkpoint={restoring}
          onClose={() => setRestoring(null)}
          onRestore={() => void restore(restoring)}
        />
      ) : null}
      {state.conflict ? (
        <ConflictDialog
          onKeepMine={() => void session.resolveConflict('mine')}
          onUseTheirs={() => void session.resolveConflict('theirs')}
        />
      ) : null}
      <LiveRegions />
    </div>
  );
}
