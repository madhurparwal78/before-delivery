import { useEffect, useMemo, useRef, useState } from 'react';
import type { DrawingObject, MeResponse, Point } from '../../shared/api';
import { BLOCK_NAMES } from '../../shared/api';
import { copy } from '../../shared/copy';
import { formatLength, type Units } from '../../shared/format';
import { ApiFailure, errorCopy, request } from '../api';
import {
  announce,
  Announcements,
  AppLink,
  Dialog,
  isPhone,
  useOutsideClose,
  useStorageOutage,
  useViewport,
} from '../shell';
import { Canvas } from './Canvas';
import {
  CommandReferenceDialog,
  EditConflictDialog,
  ExportDialog,
  SaveAsDialog,
  ShareDialog,
} from './dialogs';
import {
  ActivityPanel,
  BlocksPanel,
  IssuesPanel,
  LayersPanel,
  PANEL_TABS,
  PropertiesPanel,
  TracesPanel,
  XrefsPanel,
  type LayerOperation,
} from './panels';
import { useEditor, type DraftingAids } from './useEditor';

const RIBBON: Record<string, Array<{ label: string; command: string }>> = {
  Draw: [
    { label: 'Line', command: 'LINE' },
    { label: 'Polyline', command: 'PLINE' },
    { label: 'Circle', command: 'CIRCLE' },
    { label: 'Arc', command: 'ARC' },
    { label: 'Rectangle', command: 'RECTANG' },
    { label: 'Polygon', command: 'POLYGON' },
    { label: 'Spline', command: 'SPLINE' },
  ],
  Annotate: [
    { label: 'Text', command: 'MTEXT' },
    { label: 'Linear', command: 'DIMLINEAR' },
    { label: 'Aligned', command: 'DIMALIGNED' },
    { label: 'Radius', command: 'DIMRADIUS' },
    { label: 'Angular', command: 'DIMANGULAR' },
  ],
  Modify: [
    { label: 'Move', command: 'MOVE' },
    { label: 'Copy', command: 'COPY' },
    { label: 'Rotate', command: 'ROTATE' },
    { label: 'Mirror', command: 'MIRROR' },
    { label: 'Scale', command: 'SCALE' },
    { label: 'Trim', command: 'TRIM' },
    { label: 'Extend', command: 'EXTEND' },
    { label: 'Fillet', command: 'FILLET' },
    { label: 'Offset', command: 'OFFSET' },
    { label: 'Erase', command: 'ERASE' },
  ],
};

const AIDS: Array<keyof DraftingAids> = ['OSNAP', 'ORTHO', 'POLAR', 'SNAP & GRID', 'OTRACK'];
const AID_KEYS: Record<string, keyof DraftingAids> = {
  F3: 'OSNAP',
  F8: 'ORTHO',
  F9: 'SNAP & GRID',
  F10: 'POLAR',
  F11: 'OTRACK',
};

export function EditorPage(props: {
  drawingId: string;
  linkToken: string | null;
  me: MeResponse | null;
  onLinkDead: (status: 'expired' | 'revoked') => void;
  linkExpiryLabel: string | null;
}): JSX.Element {
  const viewport = useViewport();
  const phone = isPhone(viewport.width);
  const overlayPanel = !phone && viewport.width <= 1100;
  const storageDown = useStorageOutage();
  const model = useEditor({
    drawingId: props.drawingId,
    actorName: props.me?.user.name ?? 'Reviewer',
    linkToken: props.linkToken,
    onLinkDead: props.onLinkDead,
  });
  const {
    drawing,
    machine,
    selection,
    setSelection,
    selected,
    aids,
    toggleAid,
    sync,
    collaborators,
    activity,
    issues,
    trial,
    conflict,
    loadLatest,
    changed,
    trace,
    authoredTraces,
    rememberAuthored,
    openTrace,
    panel,
    setPanel,
    runBase,
    insertDefaults,
    historyLines,
    reload,
  } = model;

  const [commandText, setCommandText] = useState('');
  const [ribbonTab, setRibbonTab] = useState<'Draw' | 'Annotate' | 'Modify'>('Draw');
  const [layout, setLayout] = useState('Model');
  const [coordinates, setCoordinates] = useState<Point>([0, 0]);
  const [zoom, setZoom] = useState(100);
  const [layerError, setLayerError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'reference' | 'export' | 'share' | 'saveas' | null>(null);
  const [sheet, setSheet] = useState<'tools' | 'panels' | null>(null);
  const [fileMenu, setFileMenu] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [dragPreview, setDragPreview] = useState<DrawingObject | null>(null);
  const [playback, setPlayback] = useState<DrawingObject[] | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string }>>([]);
  const commandRef = useRef<HTMLInputElement>(null);
  const layersGridRef = useRef<HTMLTableElement>(null);
  const layoutBarRef = useRef<HTMLDivElement>(null);
  const blocksFirstRef = useRef<HTMLButtonElement>(null);

  const access = drawing?.access ?? 'view';
  const isOwner = access === 'owner';
  const readOnly = access === 'view' || access === 'markup' || trial.ended;
  const units: Units = drawing?.units ?? 'mm';

  useEffect(() => {
    if (drawing !== null) commandRef.current?.focus();
  }, [drawing === null]);

  useEffect(() => {
    setPanelOpen(true);
    if (panel === 'Layers') layersGridRef.current?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus();
    if (panel === 'Blocks') blocksFirstRef.current?.focus();
  }, [panel]);

  useEffect(() => {
    if (props.linkToken !== null || drawing === null) return;
    void request<{ items: Array<{ id: string; kind: string; name: string }> }>('GET', '/api/folders/root').then(
      (result) =>
        setCandidates(
          result.items
            .filter((item) => item.kind === 'drawing' && item.id !== props.drawingId)
            .map((item) => ({ id: item.id, name: item.name })),
        ),
    );
  }, [props.linkToken, props.drawingId, drawing === null]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const inTextField =
        target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (event.key === 'F1') {
        event.preventDefault();
        setDialog('reference');
        return;
      }
      const aid = AID_KEYS[event.key];
      if (aid !== undefined) {
        event.preventDefault();
        toggleAid(aid);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setDialog('export');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        if (inTextField && target !== commandRef.current) return;
        event.preventDefault();
        machine.start(event.key.toLowerCase() === 'z' ? 'UNDO' : 'REDO');
        return;
      }
      if (event.key === 'Escape') {
        if (machine.activeCommand !== null) {
          event.preventDefault();
          machine.cancel();
        } else if (overlayPanel) {
          setPanelOpen(false);
        } else if (selection.length > 0) {
          setSelection([]);
        }
        return;
      }
      if (inTextField) return;
      if (event.key === '+' || event.key === '=' || event.key === '-') {
        event.preventDefault();
        model.zoomByRef.current(event.key === '-' ? 1 / 1.25 : 1.25);
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        commandRef.current?.focus();
        setCommandText((current) => current + event.key);
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, toggleAid, selection.length, overlayPanel]);

  const startCommand = (command: string): void => {
    setSheet(null);
    machine.start(command);
    commandRef.current?.focus();
  };

  const submitLine = (): void => {
    const text = commandText;
    setCommandText('');
    setSheet(null);
    machine.submit(text);
  };

  const layerOperation = async (operation: LayerOperation): Promise<void> => {
    setLayerError(null);
    const before = drawing?.layers.map((layer) => layer.name) ?? [];
    try {
      await request('POST', `/api/drawings/${props.drawingId}/commands`, {
        base_version: drawing?.version ?? 0,
        command: 'LAYER',
        args: operation,
      });
      const next = await reload();
      const after = next?.layers ?? [];
      if (operation.op === 'new') {
        const created = after.map((layer) => layer.name).find((name) => !before.includes(name));
        if (created !== undefined) announce(copy.announce.layerCreated(created));
      }
      if (operation.op === 'rename' && operation.name !== undefined && operation.new_name !== undefined) {
        announce(copy.announce.layerRenamed(operation.name, operation.new_name));
      }
      if (operation.op === 'current' && operation.name !== undefined) {
        announce(copy.announce.layerCurrent(operation.name));
      }
      if (operation.op === 'delete' && operation.name !== undefined) {
        announce(copy.announce.layerDeleted(operation.name));
      }
      if (operation.op === 'set' && operation.name !== undefined) {
        if (operation.on !== undefined) announce(copy.announce.layerOn(operation.name, operation.on));
        if (operation.frozen !== undefined) announce(copy.announce.layerFreeze(operation.name, operation.frozen));
        if (operation.locked !== undefined) announce(copy.announce.layerLock(operation.name, operation.locked));
        if (operation.color !== undefined) announce(copy.announce.layerColor(operation.name, operation.color));
        if (operation.linetype !== undefined) {
          announce(copy.announce.layerLinetype(operation.name, operation.linetype));
        }
        if (operation.lineweight !== undefined) {
          announce(copy.announce.layerLineweight(operation.name, operation.lineweight));
        }
      }
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const name = operation.name ?? '';
        const message =
          failure.code === 'layer_zero'
            ? operation.op === 'rename'
              ? copy.layerError.renameZero
              : copy.layerError.deleteZero
            : failure.code === 'layer_current'
              ? operation.op === 'delete'
                ? copy.layerError.deleteCurrent(name)
                : copy.layerError.freezeCurrent(name)
              : failure.code === 'layer_locked'
                ? copy.layerError.deleteLocked(name)
                : failure.code === 'layer_in_use'
                  ? copy.layerError.deleteInUse(name, Number(failure.extra.objects ?? 0))
                  : (failure.field('name') ?? errorCopy(failure, 'command'));
        setLayerError(message);
        announce(message);
      }
    }
  };

  const propertyChange = async (change: { handles: string[]; set: Record<string, unknown> }): Promise<void> => {
    await runBase('PROPERTIES', change);
  };

  const modelChange = async (next: { units?: Units; plot_style?: string }): Promise<void> => {
    const result = await runBase('PROPERTIES', { model: next });
    if (result !== null && next.units !== undefined) announce(copy.announce.unitsChanged(next.units));
  };

  const onGripDrag = (handle: string, index: number, point: Point, done: boolean): void => {
    const object = drawing?.objects.find((candidate) => candidate.handle === handle);
    if (object === undefined || object.type !== 'line') return;
    const next: DrawingObject = {
      ...object,
      start: index === 0 ? point : object.start,
      end: index === 1 ? point : object.end,
      length: Math.hypot(
        (index === 1 ? point[0] : object.end[0]) - (index === 0 ? point[0] : object.start[0]),
        (index === 1 ? point[1] : object.end[1]) - (index === 0 ? point[1] : object.start[1]),
      ),
    };
    setDragPreview(next);
    if (!done) return;
    setDragPreview(null);
    void propertyChange({ handles: [handle], set: index === 0 ? { start: point } : { end: point } });
  };

  const traceGeometry = trace?.objects ?? [];
  const activeTraceForMachine = trace !== null && trace.state === 'open' ? trace : null;

  const playTrace = async (id: string): Promise<void> => {
    await openTrace(id);
    const result = await request<{ trace: { objects: DrawingObject[]; state: string } }>(
      'GET',
      `/api/traces/${id}`,
    );
    if (result.trace.state !== 'open') {
      setPlayback(result.trace.objects);
      window.setTimeout(() => setPlayback(null), 2000);
    }
  };

  const submitTrace = async (id: string): Promise<void> => {
    setSubmitPending(true);
    try {
      await request('POST', `/api/traces/${id}/submit`, {});
      await reload();
      await openTrace(id);
    } catch (failure) {
      if (failure instanceof ApiFailure) announce(errorCopy(failure));
    } finally {
      setSubmitPending(false);
    }
  };

  const currentLayout = drawing?.layouts.find((candidate) => candidate.name === layout);
  const accessLabel =
    access === 'owner' || access === 'edit'
      ? copy.access.canEdit
      : access === 'markup'
        ? copy.access.markupOnly
        : copy.access.viewOnly;

  const panelBody = useMemo(() => {
    if (drawing === null) return null;
    switch (panel) {
      case 'Properties':
        return (
          <PropertiesPanel
            drawing={drawing}
            selection={selected}
            units={units}
            dragPreview={dragPreview}
            readOnly={readOnly}
            onChange={(change) => void propertyChange(change)}
            onModelChange={(next) => void modelChange(next)}
          />
        );
      case 'Layers':
        return (
          <LayersPanel
            layers={drawing.layers}
            error={layerError}
            readOnly={readOnly}
            onOperation={(operation) => void layerOperation(operation)}
            gridRef={layersGridRef}
          />
        );
      case 'Blocks':
        return (
          <BlocksPanel
            blocks={BLOCK_NAMES}
            readOnly={readOnly}
            firstButtonRef={blocksFirstRef}
            onInsert={(name, scale, rotation) => {
              insertDefaults.current = { block: name, scale, rotation };
              startCommand('INSERT');
            }}
          />
        );
      case 'Xrefs':
        return (
          <XrefsPanel
            drawing={drawing}
            candidates={candidates}
            readOnly={readOnly}
            onAttach={(id) => {
              const name = candidates.find((candidate) => candidate.id === id)?.name ?? '';
              void runBase('XREF', { op: 'attach', drawing_id: id }).then((result) => {
                if (result !== null) announce(copy.announce.xrefAttached(name));
              });
            }}
            onOperation={(op, xrefId) => void runBase('XREF', { op, xref_id: xrefId })}
          />
        );
      case 'Traces':
        return (
          <TracesPanel
            traces={drawing.traces}
            activeTraceId={trace?.id ?? null}
            canCreate={access !== 'view'}
            isOwner={isOwner}
            actorName={props.me?.user.name ?? ''}
            authoredTraces={authoredTraces}
            submitPending={submitPending}
            onCreate={(name) => {
              void request<{ trace: { id: string } }>('POST', `/api/drawings/${props.drawingId}/traces`, { name })
                .then(async (result) => {
                  rememberAuthored(result.trace.id);
                  await reload();
                  await openTrace(result.trace.id);
                })
                .catch((failure: unknown) => {
                  if (failure instanceof ApiFailure) announce(errorCopy(failure));
                });
            }}
            onOpen={(id) => void playTrace(id)}
            onSubmit={(id) => void submitTrace(id)}
            onClose={(id) => {
              void request('POST', `/api/traces/${id}/close`, {}).then(() => void reload());
            }}
          />
        );
      case 'Activity':
        return <ActivityPanel entries={activity} />;
      case 'Issues':
        return (
          <IssuesPanel
            issues={issues}
            isOwner={isOwner}
            onResolve={(number) => {
              void request('POST', `/api/drawings/${props.drawingId}/issues/${number}/resolve`, {}).then(() =>
                undefined,
              );
            }}
          />
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, panel, selected, units, dragPreview, readOnly, layerError, candidates, trace, activity, issues, submitPending]);

  if (drawing === null) {
    return (
      <div className="editor-shell">
        <Announcements />
        <p style={{ padding: '1rem' }}>Opening the drawing…</p>
      </div>
    );
  }

  const ribbonDisabled = access === 'view' || (access === 'markup' && activeTraceForMachine === null);

  const fileActions = (
    <>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => setDialog('saveas')}>
        Save as
      </button>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => setDialog('export')}>
        Print
      </button>
      {isOwner ? (
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setDialog('share')}>
          Share
        </button>
      ) : null}
      <button type="button" className="btn btn-quiet btn-small" onClick={() => setDialog('reference')}>
        Learning material
      </button>
    </>
  );

  return (
    <div className="editor-shell">
      <Announcements />

      <header className="editor-header">
        <nav aria-label="Breadcrumb">
          <AppLink to="/drawings">My Drawings</AppLink> / {drawing.name}
        </nav>
        {phone ? (
          <>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setFileMenu(true)}>
              File actions
            </button>
            {fileMenu ? (
              <FileActionsMenu
                onClose={() => setFileMenu(false)}
                isOwner={isOwner}
                onPick={(action) => {
                  setFileMenu(false);
                  setDialog(action);
                }}
              />
            ) : null}
          </>
        ) : (
          fileActions
        )}
        <button type="button" className="btn btn-quiet btn-small" onClick={() => startCommand('UNDO')}>
          Undo
        </button>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => startCommand('REDO')}>
          Redo
        </button>
        <span className="spacer" />
        <span className="chip" role="status" aria-label="Sync">
          {sync.state === 'syncing'
            ? copy.sync.syncing
            : sync.state === 'paused'
              ? copy.sync.paused
              : sync.state === 'conflict'
                ? copy.sync.conflict(sync.version)
                : copy.sync.synced(sync.version)}
        </span>
        <ul className="collaborators" aria-label="Collaborators">
          {collaborators.map((person) => (
            <li className="chip" key={person.name}>
              {copy.sync.collaborator(person.name, person.state)}
            </li>
          ))}
        </ul>
        {isOwner ? (
          <span className="chip" role="status" aria-label="Trial">
            {copy.trial.status(trial.days_left, trial.ended)}
          </span>
        ) : null}
        <span className="chip" role="status" aria-label="Access">
          {accessLabel}
        </span>
        {props.linkExpiryLabel !== null ? (
          <span className="chip" role="status" aria-label="Link">
            {props.linkExpiryLabel}
          </span>
        ) : null}
      </header>

      {phone ? null : (
        <div className="ribbon">
          <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
            {(['Draw', 'Annotate', 'Modify'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={ribbonTab === tab}
                tabIndex={ribbonTab === tab ? 0 : -1}
                onClick={() => setRibbonTab(tab)}
                onKeyDown={(event) => {
                  const order = ['Draw', 'Annotate', 'Modify'] as const;
                  const index = order.indexOf(ribbonTab);
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    setRibbonTab(order[(index + 1) % order.length]!);
                  }
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    setRibbonTab(order[(index + order.length - 1) % order.length]!);
                  }
                }}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="ribbon-buttons" role="tabpanel" aria-label={ribbonTab}>
            {RIBBON[ribbonTab]!.map((entry) => (
              <button
                key={entry.label}
                type="button"
                className="btn btn-quiet btn-small"
                aria-disabled={ribbonDisabled ? true : undefined}
                onClick={() => startCommand(entry.command)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {model.valkeyPaused ? (
        <div className="banner" role="status" aria-label="Service status">
          {copy.outage.valkey}
        </div>
      ) : null}
      {storageDown ? (
        <div className="banner" role="status" aria-label="Service status">
          {copy.outage.minio}
        </div>
      ) : null}
      {trial.ended ? <div className="banner">{copy.trial.endedBanner}</div> : null}
      {trace !== null ? (
        <div className="banner" role="status" aria-label="Trace">
          {copy.traces.status(trace.name)}
        </div>
      ) : null}

      <div className="editor-main">
        {phone ? null : (
          <div className="panel-rail" role="tablist" aria-label="Editor panels">
            {PANEL_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={panel === tab.id}
                tabIndex={panel === tab.id ? 0 : -1}
                onClick={() => {
                  if (overlayPanel && panel === tab.id) setPanelOpen(!panelOpen);
                  else {
                    setPanel(tab.id);
                    setPanelOpen(true);
                  }
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {phone ? null : (
          <div className="editor-panel" hidden={overlayPanel && !panelOpen}>
            {panelBody}
          </div>
        )}

        <Canvas
          drawing={drawing}
          traceObjects={traceGeometry}
          dimBase={trace !== null}
          aids={aids}
          selection={selection}
          changed={changed}
          playback={playback}
          layout={layout}
          viewportScale={currentLayout?.viewport_scale ?? null}
          awaitingPoint={machine.awaitingPoint}
          awaitingSelection={machine.awaitingSelection}
          lastPoint={machine.referencePoint}
          onPick={(point) => machine.pick(point)}
          onSelect={(handle, additive) => {
            if (machine.awaitingSelection) machine.pickHandle(handle, null);
            else setSelection(additive ? [...new Set([...selection, handle])] : [handle]);
          }}
          onClearSelection={() => setSelection([])}
          onCoordinates={setCoordinates}
          onZoom={setZoom}
          installZoom={(extents, by) => {
            model.zoomExtentsRef.current = extents;
            model.zoomByRef.current = by;
          }}
          onGripDrag={onGripDrag}
        >
          <div className="view-controls">
            <ViewMenu label="Top" />
            <ViewMenu label="2D Wireframe" />
          </div>
        </Canvas>
      </div>

      <div className="layout-bar" role="tablist" aria-label="Layouts" ref={layoutBarRef}>
        {drawing.layouts.map((entry) => (
          <button
            key={entry.name}
            type="button"
            role="tab"
            aria-selected={layout === entry.name}
            tabIndex={layout === entry.name ? 0 : -1}
            onClick={() => setLayout(entry.name)}
          >
            {entry.name}
          </button>
        ))}
        <button
          type="button"
          aria-label="New layout"
          onClick={() => {
            const before = drawing.layouts.map((entry) => entry.name);
            void runBase('LAYOUT', { op: 'new' }).then(async (result) => {
              if (result === null) return;
              const next = await reload();
              const added = next?.layouts.find((entry) => !before.includes(entry.name));
              if (added === undefined) return;
              setLayout(added.name);
              window.setTimeout(() => {
                layoutBarRef.current
                  ?.querySelector<HTMLElement>(`[role="tab"][aria-selected="true"]`)
                  ?.focus();
              }, 0);
            });
          }}
        >
          +
        </button>
        {currentLayout?.viewport_scale !== undefined ? (
          <span className="chip">{currentLayout.viewport_scale}</span>
        ) : null}
      </div>

      <div className="status-bar">
        {phone ? (
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setSheet('tools')}>
            Tools
          </button>
        ) : (
          <div className="toolbar" role="toolbar" aria-label="Drafting aids" style={{ margin: 0 }}>
            {AIDS.map((aid) => (
              <button
                key={aid}
                type="button"
                className="btn btn-quiet btn-small"
                aria-pressed={aids[aid]}
                onClick={() => toggleAid(aid)}
              >
                {aid}
              </button>
            ))}
          </div>
        )}
        {phone ? (
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setSheet('panels')}>
            Panels
          </button>
        ) : null}
        <span className="spacer" />
        <span className="chip" role="status" aria-label="Coordinates">
          {`${formatLength(coordinates[0], units)}, ${formatLength(coordinates[1], units)}`}
        </span>
        <span className="chip" role="status" aria-label="Zoom">
          {`Zoom ${zoom}%`}
        </span>
        <span className="chip" role="status" aria-label="Space">
          {layout === 'Model' ? 'MODEL' : 'PAPER'}
        </span>
      </div>

      <div className="command-area">
        <div className="command-history" role="log" aria-label="Command history">
          {historyLines.slice(-40).map((line, index) => (
            <div key={`${index}-${line}`}>{line}</div>
          ))}
        </div>
        <span className="sr-only" role="status" aria-label="Command prompt">
          {machine.currentPrompt()}
        </span>
        <div className="command-input-row">
          <span className="command-prompt" aria-hidden="true">
            {machine.currentPrompt()}
          </span>
          <input
            ref={commandRef}
            aria-label="Command"
            placeholder="Type a command"
            value={commandText}
            onChange={(event) => setCommandText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitLine();
                return;
              }
              if (event.key === ' ' && !machine.awaitingText) {
                event.preventDefault();
                submitLine();
              }
            }}
          />
        </div>
      </div>

      {dialog === 'reference' ? <CommandReferenceDialog onClose={() => closeDialog(setDialog, commandRef)} /> : null}
      {dialog === 'export' ? (
        <ExportDialog
          drawingId={props.drawingId}
          layouts={drawing.layouts.map((entry) => entry.name)}
          currentLayout={layout}
          isOwner={isOwner}
          onClose={() => closeDialog(setDialog, commandRef)}
        />
      ) : null}
      {dialog === 'share' ? (
        <ShareDialog drawingId={props.drawingId} onClose={() => closeDialog(setDialog, commandRef)} />
      ) : null}
      {dialog === 'saveas' ? (
        <SaveAsDialog
          defaultName={`${drawing.name.replace(/\.dxf$/i, '')} copy.dxf`}
          onClose={() => closeDialog(setDialog, commandRef)}
          onSave={(name) => {
            void request('POST', `/api/drawings/${props.drawingId}/copy`, { name })
              .then(() => closeDialog(setDialog, commandRef))
              .catch((failure: unknown) => {
                if (failure instanceof ApiFailure) announce(errorCopy(failure));
              });
          }}
        />
      ) : null}
      {conflict !== null ? (
        <EditConflictDialog
          changedCount={conflict}
          onLoadLatest={() => {
            loadLatest();
            commandRef.current?.focus();
          }}
        />
      ) : null}

      {sheet === 'tools' ? (
        <Dialog title="Tools" sheet onClose={() => setSheet(null)}>
          <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
            {(['Draw', 'Annotate', 'Modify'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={ribbonTab === tab}
                tabIndex={ribbonTab === tab ? 0 : -1}
                onClick={() => setRibbonTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="ribbon-buttons">
            {RIBBON[ribbonTab]!.map((entry) => (
              <button
                key={entry.label}
                type="button"
                className="btn btn-quiet btn-small"
                aria-disabled={ribbonDisabled ? true : undefined}
                onClick={() => {
                  setSheet(null);
                  startCommand(entry.command);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="toolbar" role="toolbar" aria-label="Drafting aids">
            {AIDS.map((aid) => (
              <button
                key={aid}
                type="button"
                className="btn btn-quiet btn-small"
                aria-pressed={aids[aid]}
                onClick={() => toggleAid(aid)}
              >
                {aid}
              </button>
            ))}
          </div>
        </Dialog>
      ) : null}

      {sheet === 'panels' ? (
        <Dialog title="Panels" sheet onClose={() => setSheet(null)}>
          <div className="ribbon-tabs" role="tablist" aria-label="Editor panels">
            {PANEL_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={panel === tab.id}
                tabIndex={panel === tab.id ? 0 : -1}
                onClick={() => setPanel(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {panelBody}
        </Dialog>
      ) : null}
    </div>
  );
}

function closeDialog(
  setDialog: (value: null) => void,
  commandRef: React.RefObject<HTMLInputElement>,
): void {
  setDialog(null);
  commandRef.current?.focus();
}

function ViewMenu(props: { label: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(() => setOpen(false));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => setOpen(!open)}>
        {props.label}
      </button>
      {open ? (
        <div className="menu" role="menu" aria-label={props.label}>
          <button type="button" role="menuitemradio" aria-checked="true" onClick={() => setOpen(false)}>
            {props.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FileActionsMenu(props: {
  onClose: () => void;
  isOwner: boolean;
  onPick: (action: 'saveas' | 'export' | 'share' | 'reference') => void;
}): JSX.Element {
  const ref = useOutsideClose(props.onClose);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="menu" role="menu" aria-label="File actions">
        <button type="button" role="menuitem" onClick={() => props.onPick('saveas')}>
          Save as
        </button>
        <button type="button" role="menuitem" onClick={() => props.onPick('export')}>
          Print
        </button>
        {props.isOwner ? (
          <button type="button" role="menuitem" onClick={() => props.onPick('share')}>
            Share
          </button>
        ) : null}
        <button type="button" role="menuitem" onClick={() => props.onPick('reference')}>
          Learning material
        </button>
      </div>
    </div>
  );
}
