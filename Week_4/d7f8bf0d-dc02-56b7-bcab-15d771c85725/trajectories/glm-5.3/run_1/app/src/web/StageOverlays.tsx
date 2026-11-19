import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, get, newKey, ApiFailure } from './apiClient';
import type { ViewUrlState } from './store/types';
import type { StoreState } from './store/store';
import type { StageHandle } from './stage';
import type { Piece, SessionSnapshot } from '../shared/domain';
import { Glyph, type GlyphName } from './Glyphs';
import { parseLengthToMm, displayLength, displayElevationStep, fastClockLabel } from '../shared/scaleUnits';
import { PieceInspector, ConflictSheet, DeadlockSheet } from './Dialogs';
import { StageItemsList } from './StageItemsList';

interface StageOverlaysProps {
  url: ViewUrlState;
  setUrl: (patch: Partial<ViewUrlState>) => void;
  state: StoreState;
  store: ReturnType<typeof import('./store/store').useStore>;
  announce: (message: string) => void;
  announceFor: (actionId: string, message: string) => void;
  setError: (message: string | null) => void;
  stageRef: React.MutableRefObject<StageHandle | null>;
  reducedMotion: boolean;
  lastAnnounce: { message: string; actionId: string } | null;
}

const TILE_PIECES: { label: string; glyph: GlyphName; piece: Record<string, unknown> }[] = [
  { label: 'Straight 12 in', glyph: 'straight', piece: { kind: 'straight', length_mm: 305 } },
  { label: 'Straight 6 in', glyph: 'straight', piece: { kind: 'straight', length_mm: 152 } },
  { label: 'Curve left', glyph: 'curve-left', piece: { kind: 'curve', radius_mm: 1067, angle_deg: 15, hand: 'left' } },
  { label: 'Curve right', glyph: 'curve-right', piece: { kind: 'curve', radius_mm: 1067, angle_deg: 15, hand: 'right' } },
  { label: 'Turnout left', glyph: 'turnout-left', piece: { kind: 'turnout', frog_number: 6, length_mm: 305, hand: 'left' } },
  { label: 'Turnout right', glyph: 'turnout-right', piece: { kind: 'turnout', frog_number: 6, length_mm: 305, hand: 'right' } },
  { label: 'Rise', glyph: 'rise', piece: { kind: 'straight', length_mm: 1219, rise_mm: 19 } },
  { label: 'Fall', glyph: 'fall', piece: { kind: 'straight', length_mm: 1219, rise_mm: -19 } },
];

export function StageOverlays(props: StageOverlaysProps): React.ReactElement {
  const { url, setUrl, state, store, announce, announceFor, setError, stageRef, reducedMotion } = props;
  const buildMode = url.mode !== 'operate';
  const session = state.session;
  const layout = state.layout;
  const role = state.me?.memberships.find((m) => m.workspace_id === url.workspace)?.role ?? 'member';

  // ---------- pending command keys ----------
  const pendingKeyRef = useRef<string | null>(null);
  const [pendingTile, setPendingTile] = useState<string | null>(null);

  const addPiece = useCallback(async (label: string, piece: Record<string, unknown>) => {
    if (!layout) return;
    const module = layout.content.modules.find((m) => !m.trashed && m.open_ends.length > 0);
    const selectedEnd = url.end
      ? layout.content.modules.flatMap((m) => m.open_ends).find((o) => o.id === url.end)
      : module?.open_ends[0];
    if (!selectedEnd || !module) {
      setError('Select an open end first.');
      return;
    }
    // One append command goes out with one key; further presses reuse it.
    if (pendingKeyRef.current && pendingTile === label) return;
    const key = pendingKeyRef.current ?? newKey();
    pendingKeyRef.current = key;
    setPendingTile(label);
    announceFor('add-piece', 'Adding piece.');
    try {
      await api('POST', `/api/workspaces/${url.workspace}/layouts/${layout.id}/modules/${module.id}/pieces`, {
        revision: layout.revision,
        open_end_id: selectedEnd.id,
        piece,
      }, key);
      await store.loadLayout(url.workspace ?? '', layout.id);
      announceFor('add-piece', 'Piece added.');
    } catch (e) {
      if (e instanceof ApiFailure) {
        if (e.extra && typeof e.extra === 'object' && 'findings' in e.extra) {
          const findings = e.extra.findings as { message: string }[];
          setError(findings.map((f) => f.message).join(' ') || e.message);
        } else {
          setError(e.message);
        }
        announceFor('add-piece', e.message);
      } else {
        setError('Something went wrong.');
      }
    } finally {
      pendingKeyRef.current = null;
      setPendingTile(null);
    }
  }, [layout, url.workspace, url.end, store, announceFor, setError, pendingTile]);

  // ---------- undo ----------
  const undoLastPiece = useCallback(async () => {
    if (!layout) return;
    announceFor('remove-piece', 'Removing piece.');
    const module = layout.content.modules.find((m) => !m.trashed && m.pieces.length > 0);
    if (!module) return;
    const last = module.pieces[module.pieces.length - 1];
    if (!last) return;
    try {
      await api('POST', `/api/workspaces/${url.workspace}/layouts/${layout.id}/modules/${module.id}/pieces/${last.id}/remove`, {
        revision: layout.revision,
      }, newKey());
      await store.loadLayout(url.workspace ?? '', layout.id);
      announceFor('remove-piece', 'Piece removed.');
    } catch (e) {
      if (e instanceof ApiFailure) setError(e.message);
    }
  }, [layout, url.workspace, store, announceFor, setError]);

  // ---------- heading dial ----------
  const rotateHeading = useCallback(() => {
    const controls = stageRef.current?.controls;
    if (!controls) return;
    controls.rotate(45);
    setUrl({ heading: controls.heading });
  }, [stageRef, setUrl]);

  // ---------- mode switch ----------
  const switchMode = useCallback(() => {
    if (buildMode) {
      if (!session) {
        setUrl({ mode: 'operate', sheet: 'sessions' });
        return;
      }
      setUrl({ mode: 'operate', sheet: null });
    } else {
      setUrl({ mode: 'build', sheet: null });
    }
  }, [buildMode, session, setUrl]);

  return (
    <>
      {/* the roving stage items list */}
      <StageItemsList url={url} setUrl={setUrl} state={state} />

      {buildMode ? (
        <>
          {/* Build actions above the tile rail */}
          <div style={{ position: 'fixed', bottom: 84, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, zIndex: 40, flexWrap: 'wrap', justifyContent: 'center' }}>
            <AddModuleButton url={url} layout={layout} store={store} announceFor={announceFor} setError={setError} />
            <button className="lipped pale" onClick={undoLastPiece}>Undo last piece</button>
            <TrashModuleButton url={url} layout={layout} store={store} announceFor={announceFor} setError={setError} />
            <CheckLayoutButton url={url} layout={layout} announceFor={announceFor} setError={setError} />
            <SaveVersionButton url={url} layout={layout} store={store} announceFor={announceFor} setError={setError} />
          </div>

          {/* tile rail */}
          <div className="tile-rail" role="toolbar" aria-label="Track pieces" data-testid="tile-rail">
            {TILE_PIECES.map((tile) => (
              <button
                key={tile.label}
                className="tile"
                aria-label={tile.label}
                onClick={() => void addPiece(tile.label, tile.piece)}
                aria-disabled={pendingTile !== null && pendingTile !== tile.label}
              >
                <Glyph name={tile.glyph} />
                <span className="tile-ring" />
              </button>
            ))}
            <button className="tile" aria-label="Undo last piece" onClick={undoLastPiece}>
              <Glyph name="undo" />
              <span className="tile-ring" />
            </button>
          </div>
        </>
      ) : (
        <OperateOverlays
          url={url}
          setUrl={setUrl}
          state={state}
          store={store}
          announceFor={announceFor}
          setError={setError}
          role={role}
          reducedMotion={reducedMotion}
        />
      )}

      {/* heading dial */}
      <button className="heading-dial" aria-label="Rotate heading" data-testid="heading-dial" onClick={rotateHeading}>
        <span className="ticks" />
        <span className="needle" style={{ transform: `rotate(${url.heading ?? 0}deg)` }}>
          <svg viewBox="0 0 50 50" width="50" height="50">
            <path d="M25 4l7 20-7-6-7 6z" fill="#1848c2" />
          </svg>
        </span>
      </button>

      {/* Build and Operate switch */}
      <div className="mode-switch-card">
        <span className={`glyph ${buildMode ? 'active' : ''}`}><Glyph name="build" /></span>
        <button
          className="mode-toggle"
          role="switch"
          aria-label="Operate mode"
          aria-checked={!buildMode}
          data-testid="mode-switch"
          onClick={switchMode}
        >
          <span className="knob" />
        </button>
        <span className={`glyph ${!buildMode ? 'active' : ''}`}><Glyph name="operate" /></span>
      </div>

      {/* sheets */}
      {url.sheet ? (
        <SheetHost
          url={url}
          setUrl={setUrl}
          state={state}
          store={store}
          announceFor={announceFor}
          setError={setError}
          role={role}
        />
      ) : null}
      {url.dialog === 'piece-inspector' && url.piece ? (
        <PieceInspector url={url} layout={layout} store={store} announceFor={announceFor} setError={setError} setUrl={setUrl} />
      ) : null}
      {url.dialog === 'conflict' ? (
        <ConflictSheet url={url} session={session} store={store} announceFor={announceFor} setError={setError} />
      ) : null}
      {url.dialog === 'deadlock' ? (
        <DeadlockSheet url={url} session={session} store={store} announceFor={announceFor} setError={setError} />
      ) : null}
    </>
  );
}

// ---------- build buttons ----------

function AddModuleButton(props: { url: ViewUrlState; layout: StoreState['layout']; store: StageOverlaysProps['store']; announceFor: StageOverlaysProps['announceFor']; setError: StageOverlaysProps['setError'] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [endplate, setEndplate] = useState('single');
  const run = useCommandRun();
  return (
    <>
      <button className="lipped" onClick={() => setOpen(true)}>Add module</button>
      {open ? (
        <div className="dialog-backdrop" style={{ zIndex: 75 }}>
          <div className="dialog" role="dialog" aria-label="Add module">
            <h2>Add module</h2>
            <div className="field">
              <label htmlFor="module-name">Module name</label>
              <input id="module-name" type="textbox" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="module-endplate">Endplate</label>
              <select id="module-endplate" value={endplate} onChange={(e) => setEndplate(e.target.value)}>
                <option value="single">Single</option>
                <option value="double">Double</option>
              </select>
            </div>
            <div className="actions">
              <button className="lipped pale" onClick={() => setOpen(false)}>Cancel</button>
              <button className="lipped" onClick={() => void run(async () => {
                if (!props.layout) return;
                const widthMm = endplate === 'double' ? 660 : 610;
                const offsets = endplate === 'double' ? [-25, 25] : [0];
                await api('POST', `/api/workspaces/${props.url.workspace}/layouts/${props.layout.id}/modules`, {
                  revision: props.layout.revision,
                  name,
                  endplates: [
                    { end: 'A', width_mm: widthMm, track_offsets_mm: offsets },
                    { end: 'B', width_mm: widthMm, track_offsets_mm: offsets },
                  ],
                }, newKey());
                await props.store.loadLayout(props.url.workspace ?? '', props.layout.id);
                props.announceFor('add-module', 'Module added.');
                setOpen(false);
              }, 'Adding module.', props.announceFor, props.setError)}>Create module</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function TrashModuleButton(props: { url: ViewUrlState; layout: StoreState['layout']; store: StageOverlaysProps['store']; announceFor: StageOverlaysProps['announceFor']; setError: StageOverlaysProps['setError'] }): React.ReactElement {
  const run = useCommandRun();
  const canTrash = Boolean(props.layout && props.layout.content.modules.some((m) => !m.trashed));
  return (
    <button className="lipped orange" data-testid="trash-module" disabled={!canTrash} onClick={() => void run(async () => {
      if (!props.layout) return;
      const module = props.layout.content.modules.find((m) => !m.trashed);
      if (!module) return;
      await api('POST', `/api/workspaces/${props.url.workspace}/layouts/${props.layout.id}/modules/${module.id}/trash`, {
        revision: props.layout.revision,
      }, newKey());
      await props.store.loadLayout(props.url.workspace ?? '', props.layout.id);
      props.announceFor('trash', 'Moved to trash.');
    }, 'Moving to trash.', props.announceFor, props.setError)}>Trash module</button>
  );
}

function CheckLayoutButton(props: { url: ViewUrlState; layout: StoreState['layout']; announceFor: StageOverlaysProps['announceFor']; setError: StageOverlaysProps['setError'] }): React.ReactElement {
  const run = useCommandRun();
  return (
    <button className="lipped green" onClick={() => void run(async () => {
      if (!props.layout) return;
      const result = await api<{ passed: boolean; findings: { message: string }[] }>('POST', `/api/workspaces/${props.url.workspace}/layouts/${props.layout.id}/check`, {}, newKey());
      if (result.passed) {
        props.announceFor('check', 'Layout passes every rule.');
      } else {
        props.announceFor('check', `Layout has ${result.findings.length} findings.`);
        props.setError(result.findings.map((f) => f.message).join(' '));
      }
    }, 'Checking layout.', props.announceFor, props.setError)}>Check layout</button>
  );
}

function SaveVersionButton(props: { url: ViewUrlState; layout: StoreState['layout']; store: StageOverlaysProps['store']; announceFor: StageOverlaysProps['announceFor']; setError: StageOverlaysProps['setError'] }): React.ReactElement {
  const run = useCommandRun();
  return (
    <button className="lipped" onClick={() => void run(async () => {
      if (!props.layout) return;
      const result = await api<{ version: { number: number } }>('POST', `/api/workspaces/${props.url.workspace}/layouts/${props.layout.id}/versions`, {
        revision: props.layout.revision,
        label: `Issue ${new Date().toISOString().slice(0, 10)}`,
      }, newKey());
      await props.store.loadLayout(props.url.workspace ?? '', props.layout.id);
      props.announceFor('save-version', `Version ${result.version.number} saved.`);
    }, 'Saving version.', props.announceFor, props.setError)}>Save version</button>
  );
}

/** A tiny runner for pending/announce/error copy. */
function useCommandRun() {
  return useCallback(async (fn: () => Promise<void>, pending: string, announceFor: (id: string, m: string) => void, setError: (m: string | null) => void) => {
    announceFor('command', pending);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiFailure) setError(e.message);
      else setError('Something went wrong.');
    }
  }, []);
}

// ---------- operate overlays ----------

interface OperateOverlaysProps {
  url: ViewUrlState;
  setUrl: (patch: Partial<ViewUrlState>) => void;
  state: StoreState;
  store: StageOverlaysProps['store'];
  announceFor: (actionId: string, message: string) => void;
  setError: (message: string | null) => void;
  role: string;
  reducedMotion: boolean;
}

function OperateOverlays(props: OperateOverlaysProps): React.ReactElement {
  const { url, setUrl, state, store, announceFor, setError } = props;
  const session = state.session;
  const trains = session?.trains ?? [];
  const blocks = session?.blocks ?? [];
  const selectedTrain = trains.find((t) => t.id === url.train) ?? null;
  const [destination, setDestination] = useState('');
  const [via, setVia] = useState('');
  const [timeLimit, setTimeLimit] = useState(60);
  const [preview, setPreview] = useState<{ text: string; blocks: string[]; conflictBlock: string | null } | null>(null);
  const [blockSearch, setBlockSearch] = useState('');
  const [blockResults, setBlockResults] = useState<{ id: string; number: number; name: string; kind: string }[]>([]);
  const [schematicOpen, setSchematicOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const latestInputRef = useRef(0);

  // Only the answer to the newest input may change the preview.
  const previewFor = useCallback(async (inputId: number, dest: string, viaBlock: string) => {
    if (!session || !selectedTrain || !dest) {
      setPreview(null);
      return;
    }
    try {
      const result = await api<{ route_block_ids: string[]; clear: boolean; conflict_block_id: string | null; other_train_number: string | null }>(
        'POST',
        `/api/workspaces/${url.workspace}/sessions/${session.id}/trains/${selectedTrain.id}/route-preview`,
        { destination_block_id: dest, via_block_id: viaBlock || null },
      );
      if (inputId !== latestInputRef.current) return;
      const numbers = result.route_block_ids.map((id) => session.blocks.find((b) => b.id === id)?.number ?? 0);
      if (result.clear) {
        setPreview({ text: `Route: ${numbers.join(', ')}`, blocks: result.route_block_ids, conflictBlock: null });
      } else {
        const conflictName = session.blocks.find((b) => b.id === result.conflict_block_id)?.name ?? '';
        setPreview({ text: `Blocked at Block ${conflictName} by Train ${result.other_train_number ?? ''}`, blocks: result.route_block_ids, conflictBlock: result.conflict_block_id });
      }
    } catch (e) {
      if (inputId !== latestInputRef.current) return;
      if (e instanceof ApiFailure) {
        setPreview({ text: e.message, blocks: [], conflictBlock: null });
      }
    }
  }, [session, selectedTrain, url.workspace]);

  const schedulePreview = useCallback((dest: string, viaBlock: string) => {
    const inputId = ++latestInputRef.current;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void previewFor(inputId, dest, viaBlock);
    }, 250);
  }, [previewFor]);

  const onDestinationChange = useCallback((value: string) => {
    setDestination(value);
    schedulePreview(value, via);
  }, [schedulePreview, via]);

  const onViaChange = useCallback((value: string) => {
    setVia(value);
    schedulePreview(destination, value);
  }, [schedulePreview, destination]);

  // Block search: results only for the newest input.
  useEffect(() => {
    if (!blockSearch) {
      setBlockResults([]);
      return;
    }
    const inputId = ++latestInputRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const result = await get<{ blocks: { id: string; number: number; name: string; kind: string }[] }>(
          `/api/workspaces/${url.workspace}/sessions/${session?.id}/blocks?q=${encodeURIComponent(blockSearch)}`,
        );
        if (inputId === latestInputRef.current) setBlockResults(result.blocks);
      } catch {
        // ignore
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [blockSearch, session?.id, url.workspace]);

  const highball = useCallback(async () => {
    if (!session || !selectedTrain || !destination) return;
    announceFor('highball', `Requesting the road for Train ${selectedTrain.number}.`);
    try {
      const result = await api<{ authority: { block_ids: string[] }; session: SessionSnapshot }>(
        'POST',
        `/api/workspaces/${url.workspace}/sessions/${session.id}/trains/${selectedTrain.id}/authorities`,
        {
          revision: selectedTrain.revision,
          destination_block_id: destination,
          via_block_id: via || null,
          time_limit_fast_seconds: timeLimit * 60,
        },
        newKey(),
      );
      await store.loadSession(url.workspace ?? '', session.id);
      const destName = result.session.blocks.find((b) => b.id === destination)?.name ?? '';
      announceFor('highball', `Train ${selectedTrain.number} has the road to ${destName}, ${result.authority.block_ids.length} blocks.`);
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor('highball', e.message);
        if (e.code === 'route_conflict') {
          setUrl({ dialog: 'conflict', train: selectedTrain.id });
        }
      }
    }
  }, [session, selectedTrain, destination, via, timeLimit, url.workspace, store, announceFor, setUrl]);

  const recall = useCallback(async () => {
    if (!session || !selectedTrain) return;
    announceFor('recall', `Recalling Train ${selectedTrain.number}.`);
    try {
      const result = await api<SessionSnapshot>(
        'POST',
        `/api/workspaces/${url.workspace}/sessions/${session.id}/trains/${selectedTrain.id}/recall`,
        { revision: selectedTrain.revision },
        newKey(),
      );
      await store.loadSession(url.workspace ?? '', session.id);
      const blockName = result.blocks.find((b) => b.id === selectedTrain.start_block_id)?.name ?? '';
      announceFor('recall', `Train ${selectedTrain.number} recalled to ${blockName}.`);
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor('recall', e.message);
        if (e.code === 'recall_blocked') setUrl({ dialog: 'conflict', train: selectedTrain.id });
      }
    }
  }, [session, selectedTrain, url.workspace, store, announceFor, setUrl]);

  const cancelAuthority = useCallback(async () => {
    if (!session || !selectedTrain?.authority_id) return;
    const authority = session.authorities.find((a) => a.id === selectedTrain.authority_id);
    if (!authority) return;
    announceFor('cancel-authority', 'Cancelling authority.');
    try {
      await api('POST', `/api/workspaces/${url.workspace}/sessions/${session.id}/authorities/${authority.id}/cancel`, {
        revision: authority.revision,
      }, newKey());
      await store.loadSession(url.workspace ?? '', session.id);
      announceFor('cancel-authority', 'Authority released.');
    } catch (e) {
      if (e instanceof ApiFailure) announceFor('cancel-authority', e.message);
    }
  }, [session, selectedTrain, url.workspace, store, announceFor]);

  return (
    <>
      {/* round buttons */}
      <div className="round-cluster">
        <button
          className="round-button"
          aria-label="Highball"
          data-testid="highball"
          disabled={!selectedTrain || !destination}
          onClick={highball}
        >
          <Glyph name="play" />
        </button>
        <button
          className="round-button"
          aria-label="Recall"
          data-testid="recall"
          disabled={!selectedTrain}
          onClick={recall}
        >
          <Glyph name="return" />
        </button>
      </div>

      {/* trains list and the roving stage items list */}
      <div style={{ position: 'fixed', left: 14, bottom: 84, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 38 }}>
        <ul
          role="listbox"
          aria-label="Trains"
          style={{ listStyle: 'none', margin: 0, padding: '6px 10px', background: 'rgba(255,255,255,0.9)', borderRadius: 10, border: '3px solid #1848c2', minWidth: 190 }}
        >
          {trains.length === 0 ? <li style={{ padding: 6 }}>Nothing here yet.</li> : trains.map((t) => (
            <li
              key={t.id}
              role="option"
              aria-selected={t.id === url.train}
              tabIndex={0}
              style={{ padding: '6px 4px', fontWeight: t.id === url.train ? 700 : 400, cursor: 'pointer', minHeight: 44 }}
              onClick={() => setUrl({ train: t.id })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setUrl({ train: t.id });
              }}
            >
              Train {t.number}
            </li>
          ))}
        </ul>
      </div>

      {/* route panel and schematic on desktop */}
      <div className="schematic-panel">
        <div className="route-panel" role="region" aria-label="Route" data-testid="route-panel">
          <div className="field">
            <label htmlFor="destination-block">Destination block</label>
            <select id="destination-block" value={destination} onChange={(e) => onDestinationChange(e.target.value)}>
              <option value="">Choose a destination</option>
              {blocks.filter((b) => b.id !== selectedTrain?.head_block_id).map((b) => (
                <option key={b.id} value={b.id}>Block {b.number} {b.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="via-block">Via block</label>
            <select id="via-block" value={via} onChange={(e) => onViaChange(e.target.value)}>
              <option value="">No block</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>Block {b.number} {b.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="time-limit">Time limit</label>
            <input
              id="time-limit"
              type="number"
              role="spinbutton"
              min={1}
              max={720}
              value={timeLimit}
              onChange={(e) => setTimeLimit(Number(e.target.value))}
            />
          </div>
          <button className="lipped orange" onClick={cancelAuthority} disabled={!selectedTrain?.authority_id}>
            Cancel authority
          </button>
          <div className="field">
            <label htmlFor="block-search">Block search</label>
            <input
              id="block-search"
              type="search"
              role="searchbox"
              aria-label="Block search"
              value={blockSearch}
              onChange={(e) => setBlockSearch(e.target.value)}
            />
          </div>
          {blockResults.length > 0 ? (
            <ul role="listbox" aria-label="Block results" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {blockResults.map((b) => (
                <li key={b.id} role="option" aria-selected="false" style={{ padding: '6px 0' }}>
                  Block {b.number} {b.name}
                </li>
              ))}
            </ul>
          ) : null}
          {preview ? (
            <p data-testid="route-preview" style={{ margin: 0, fontWeight: 700 }}>{preview.text}</p>
          ) : null}
        </div>

        <div className="schematic-table" style={{ maxHeight: '40vh' }}>
          <table aria-label="Block schematic">
            <tbody>
              {blocks.map((b) => (
                <tr key={b.id} data-testid={`block-row-${b.number}`}>
                  <td className="numeric">{b.number}</td>
                  <td>{b.name}</td>
                  <td data-testid={`block-state-${b.number}`} className={`state-word ${b.state === 'out_of_service' ? 'out-of-service' : b.state}`}>
                    {b.state === 'out_of_service' ? 'Out of service' : b.state === 'occupied' ? 'Occupied' : b.state === 'reserved' ? 'Reserved' : 'Free'}
                  </td>
                  <td className="numeric">{b.train_number ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ---------- sheet host ----------

interface SheetHostProps {
  url: ViewUrlState;
  setUrl: (patch: Partial<ViewUrlState>) => void;
  state: StoreState;
  store: StageOverlaysProps['store'];
  announceFor: (actionId: string, message: string) => void;
  setError: (message: string | null) => void;
  role: string;
}

const SHEET_TITLES: Record<string, string> = {
  layouts: 'Layouts',
  versions: 'Versions',
  timetable: 'Timetable',
  'crew-packets': 'Crew packets',
  members: 'Members',
  standards: 'Standards',
  history: 'History',
  trash: 'Trash',
  sessions: 'Sessions',
};

function SheetHost(props: SheetHostProps): React.ReactElement {
  const { url, setUrl } = props;
  const title = SHEET_TITLES[url.sheet ?? ''] ?? 'Sheet';
  return (
    <div className={`sheet ${url.sheet === 'timetable' ? 'wide' : ''}`} role="dialog" aria-label={title} data-testid={`sheet-${url.sheet}`}>
      <div className="sheet-head">
        <h2>{title}</h2>
        <button className="lipped pale" onClick={() => setUrl({ sheet: null })}>Close</button>
      </div>
      <div className="sheet-body">
        {url.sheet === 'layouts' ? <LayoutsSheet {...props} /> : null}
        {url.sheet === 'versions' ? <VersionsSheet {...props} /> : null}
        {url.sheet === 'timetable' ? <TimetableSheet {...props} /> : null}
        {url.sheet === 'crew-packets' ? <CrewPacketsSheet {...props} /> : null}
        {url.sheet === 'members' ? <MembersSheet {...props} /> : null}
        {url.sheet === 'standards' ? <StandardsSheet {...props} /> : null}
        {url.sheet === 'history' ? <HistorySheet {...props} /> : null}
        {url.sheet === 'trash' ? <TrashSheet {...props} /> : null}
        {url.sheet === 'sessions' ? <SessionsSheet {...props} /> : null}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }): React.ReactElement {
  return (
    <div className="empty-state">
      <svg viewBox="0 0 84 84" fill="none" stroke="currentColor" strokeWidth="3">
        <rect x="12" y="24" width="60" height="36" rx="8" />
        <path d="M24 42h36M42 24v36" />
      </svg>
      <p>Nothing here yet.</p>
    </div>
  );
}

function LayoutsSheet({ url, setUrl, state, store, announceFor, setError }: SheetHostProps): React.ReactElement {
  const [name, setName] = useState('');
  const [layouts, setLayouts] = useState<{ id: string; name: string; revision: number; counts: { modules: number; pieces: number; blocks: number; trash: number } }[]>([]);
  useEffect(() => {
    if (!url.workspace) return;
    void get<{ layouts: typeof layouts }>(`/api/workspaces/${url.workspace}/layouts`).then((r) => setLayouts(r.layouts)).catch(() => undefined);
  }, [url.workspace, state.layout?.revision]);

  return (
    <>
      <div className="row-list">
        {layouts.length === 0 ? <EmptyState label="Layouts" /> : layouts.map((l) => (
          <div className="row" key={l.id} data-testid={`layout-row-${l.id}`}>
            <span>{l.name} <span className="numeric">· {l.counts.modules} modules, {l.counts.pieces} pieces, {l.counts.blocks} blocks</span></span>
            <button className="lipped" onClick={() => {
              setUrl({ layout: l.id, sheet: null });
              void store.loadLayout(url.workspace ?? '', l.id);
            }}>Open</button>
          </div>
        ))}
      </div>
      <div className="field" style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input aria-label="Layout name" type="textbox" value={name} onChange={(e) => setName(e.target.value)} placeholder="Layout name" />
        <button className="lipped" disabled={name.trim() === ''} onClick={() => void (async () => {
          try {
            const result = await api<{ layout: { id: string } }>('POST', `/api/workspaces/${url.workspace}/layouts`, { name }, newKey());
            setName('');
            setUrl({ layout: result.layout.id, sheet: null });
            await store.loadLayout(url.workspace ?? '', result.layout.id);
            announceFor('create-layout', 'Layout created.');
          } catch (e) {
            if (e instanceof ApiFailure) setError(e.message);
          }
        })()}>Create layout</button>
      </div>
    </>
  );
}

function VersionsSheet({ url, state, store, announceFor, setError }: SheetHostProps): React.ReactElement {
  const [versions, setVersions] = useState<{ id: string; number: number; state: string; label: string; canonical_hash: string; revision: number }[]>([]);
  const load = useCallback(() => {
    if (!url.workspace || !state.layout) return;
    void get<{ versions: typeof versions }>(`/api/workspaces/${url.workspace}/layouts/${state.layout.id}/versions`)
      .then((r) => setVersions(r.versions)).catch(() => undefined);
  }, [url.workspace, state.layout]);
  useEffect(load, [load]);

  const versionCommand = async (versionId: string, command: 'validate' | 'publish' | 'restore', version: { number: number; revision: number; state: string }) => {
    const pending = command === 'validate' ? `Validating version ${version.number}.` : command === 'publish' ? `Publishing version ${version.number}.` : `Restoring version ${version.number}.`;
    announceFor(command, pending);
    try {
      if (!state.layout) return;
      if (command === 'restore') {
        await api('POST', `/api/workspaces/${url.workspace}/layouts/${state.layout.id}/versions/${versionId}/restore`, { revision: state.layout.revision }, newKey());
        await store.loadLayout(url.workspace ?? '', state.layout.id);
        announceFor('restore', `Restored as version ${version.number}.`);
      } else {
        const result = await api<{ version: { number: number } }>('POST', `/api/workspaces/${url.workspace}/layouts/${state.layout.id}/versions/${versionId}/${command}`, { revision: version.revision }, newKey());
        if (command === 'validate') {
          announceFor('validate', `Version ${version.number} validated.`);
        } else {
          announceFor('publish', `Version ${version.number} published.`);
        }
      }
      load();
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor(command, e.message);
        setError(e.message);
      }
    }
  };

  return (
    <div className="row-list">
      {versions.length === 0 ? <EmptyState label="Versions" /> : versions.map((v) => (
        <div className="row" key={v.id} data-testid={`version-row-${v.number}`}>
          <span>
            <span className="numeric">Version {v.number}</span> · {v.state} · {v.label}
            <br />
            <span style={{ fontSize: 12 }}>{v.canonical_hash.slice(0, 16)}</span>
          </span>
          <span style={{ display: 'flex', gap: 6 }}>
            {v.state === 'Draft' ? <button className="lipped" onClick={() => void versionCommand(v.id, 'validate', v)}>Validate</button> : null}
            {v.state === 'Validated' ? <button className="lipped" onClick={() => void versionCommand(v.id, 'publish', v)}>Publish</button> : null}
            {v.state === 'Published' ? <button className="lipped green" onClick={() => void versionCommand(v.id, 'restore', v)}>Restore</button> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function TimetableSheet({ url, state, announceFor, setError }: SheetHostProps): React.ReactElement {
  const layout = state.layout;
  const [departs, setDeparts] = useState<Record<string, string>>({});
  const [renameOpen, setRenameOpen] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  useEffect(() => {
    if (!layout) return;
    const next: Record<string, string> = {};
    for (const entry of layout.content.timetable.entries) {
      next[entry.id] = fastClockLabel(entry.depart_fast_seconds);
    }
    setDeparts(next);
  }, [layout?.working_hash]);

  if (!layout) return <EmptyState label="Timetable" />;

  const trainsById = new Map(layout.content.trains.map((t) => [t.id, t]));
  const stationsById = new Map(layout.content.stations.map((s) => [s.id, s]));

  return (
    <>
      <table aria-label="Timetable">
        <tbody>
          {layout.content.timetable.entries.map((entry) => (
            <tr key={entry.id} data-testid={`timetable-row-${entry.id}`}>
              <td>{trainsById.get(entry.train_id)?.number ?? entry.train_id}</td>
              <td>
                {stationsById.get(entry.station_id)?.name ?? entry.station_id}
                {renameOpen === entry.station_id ? null : (
                  <button
                    className="lipped pale"
                    style={{ minHeight: 32, padding: '0 8px', marginLeft: 6 }}
                    aria-label={`Rename station ${stationsById.get(entry.station_id)?.name ?? ''}`}
                    onClick={() => {
                      setRenameOpen(entry.station_id);
                      setRenameValue(stationsById.get(entry.station_id)?.name ?? '');
                    }}
                  >Rename</button>
                )}
              </td>
              <td>
                <input
                  aria-label="Depart"
                  role="spinbutton"
                  type="time"
                  step={1}
                  value={departs[entry.id] ?? '00:00:00'}
                  onChange={(e) => setDeparts((d) => ({ ...d, [entry.id]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {renameOpen ? (
        <div className="dialog-backdrop" style={{ zIndex: 82 }}>
          <div className="dialog" role="dialog" aria-label="Rename">
            <h2>Rename</h2>
            <div className="field">
              <label htmlFor="rename-name">New name</label>
              <input id="rename-name" type="textbox" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
            </div>
            <div className="actions">
              <button className="lipped" onClick={() => void (async () => {
                announceFor('rename', 'Saving name.');
                try {
                  await api('PATCH', `/api/workspaces/${url.workspace}/layouts/${layout.id}/stations/${renameOpen}`, {
                    revision: layout.revision,
                    name: renameValue,
                  }, newKey());
                  announceFor('rename', `Renamed to ${renameValue}.`);
                  setRenameOpen(null);
                } catch (e) {
                  if (e instanceof ApiFailure) setError(e.message);
                }
              })()}>Save name</button>
            </div>
          </div>
        </div>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <button className="lipped" onClick={() => void (async () => {
          announceFor('save-timetable', 'Saving timetable.');
          try {
            const entries = layout.content.timetable.entries.map((entry) => ({
              id: entry.id,
              train_id: entry.train_id,
              station_id: entry.station_id,
              depart_fast_seconds: parseHms(departs[entry.id] ?? '00:00:00'),
            }));
            await api('PUT', `/api/workspaces/${url.workspace}/layouts/${layout.id}/timetable`, {
              revision: layout.revision,
              entries,
            }, newKey());
            announceFor('save-timetable', 'Timetable saved.');
          } catch (e) {
            if (e instanceof ApiFailure) setError(e.message);
          }
        })()}>Save timetable</button>
      </div>
    </>
  );
}

function parseHms(value: string): number {
  const [h = '0', m = '0', s = '0'] = value.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function CrewPacketsSheet({ url, state, store, announceFor, setError }: SheetHostProps): React.ReactElement {
  const session = state.session;
  const [packets, setPackets] = useState<{ id: string; state: string; session_version: number; byte_length: number | null; failure: string | null }[]>([]);
  const [preview, setPreview] = useState<{ session_version: number; content: Record<string, unknown>; content_hash: string } | null>(null);

  const load = useCallback(() => {
    if (!url.workspace || !session) return;
    void get<{ packets: typeof packets }>(`/api/workspaces/${url.workspace}/sessions/${session.id}/packets`).then((r) => setPackets(r.packets)).catch(() => undefined);
    void get<{ session_version: number; content: Record<string, unknown>; content_hash: string }>(`/api/workspaces/${url.workspace}/sessions/${session.id}/packets/preview`).then(setPreview).catch(() => undefined);
  }, [url.workspace, session?.id, session?.revision]);
  useEffect(load, [load]);

  if (!session) {
    return <EmptyState label="Crew packets" />;
  }

  return (
    <>
      {preview ? (
        <div data-testid="next-packet-preview" style={{ border: '2px solid #b9c3e8', borderRadius: 10, padding: 10, marginBottom: 12 }}>
          <strong>Next packet preview</strong> · Session version {preview.session_version} · hash {preview.content_hash.slice(0, 12)}
        </div>
      ) : null}
      {state.outage.gotenbergDown ? (
        <p style={{ fontWeight: 700, color: '#d95d00' }}>The PDF service is not answering. New packets will fail until it returns.</p>
      ) : null}
      <div className="row-list">
        {packets.length === 0 ? <EmptyState label="Crew packets" /> : packets.map((p) => (
          <div className="row" key={p.id} data-testid={`packet-row-${p.id}`}>
            <span>
              <span className="numeric">{p.id.slice(0, 8)}</span> · {p.state} · version {p.session_version}
              {p.failure ? <em style={{ display: 'block', fontSize: 13 }}>Failed: {p.failure === 'gotenberg_unreachable' ? 'the PDF service did not answer' : 'live updates were paused'}</em> : null}
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              {p.state === 'Ready' || p.state === 'Superseded' ? (
                <a
                  className="lipped pale"
                  href={`/api/workspaces/${url.workspace}/sessions/${session.id}/packets/${p.id}/pdf`}
                  download
                >Download PDF</a>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="lipped" onClick={() => void (async () => {
          announceFor('issue-packet', 'Issuing crew packet.');
          try {
            await api('POST', `/api/workspaces/${url.workspace}/sessions/${session.id}/packets`, { revision: session.session_version }, newKey());
            announceFor('issue-packet', 'Issuing crew packet.');
            load();
          } catch (e) {
            if (e instanceof ApiFailure) setError(e.message);
          }
        })()}>Issue packet</button>
      </div>
    </>
  );
}

function MembersSheet({ url, state, announceFor, setError }: SheetHostProps): React.ReactElement {
  const [members, setMembers] = useState<{ user_id: string; display_name: string; email: string; role: string; revision: number }[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('member');
  const load = useCallback(() => {
    if (!url.workspace) return;
    void get<{ members: typeof members }>(`/api/workspaces/${url.workspace}/members`).then((r) => setMembers(r.members)).catch(() => undefined);
  }, [url.workspace]);
  useEffect(load, [load]);

  return (
    <>
      <div className="row-list">
        {members.map((m) => (
          <div className="row" key={m.user_id} data-testid={`member-row-${m.user_id}`}>
            <span>{m.display_name} · {m.email} · {m.role}</span>
          </div>
        ))}
      </div>
      <h3 style={{ marginTop: 18 }}>Add member</h3>
      <div className="field"><label htmlFor="member-name">Display name</label><input id="member-name" type="textbox" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
      <div className="field"><label htmlFor="member-email">Email</label><input id="member-email" type="textbox" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="member-password">Password</label><input id="member-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div className="field">
        <label htmlFor="member-role">Role</label>
        <select id="member-role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="manager">Manager</option>
          <option value="member">Member</option>
          <option value="operator">Operator</option>
        </select>
      </div>
      <button className="lipped" onClick={() => void (async () => {
        announceFor('add-member', 'Adding member.');
        try {
          await api('POST', `/api/workspaces/${url.workspace}/members`, { display_name: displayName, email, password, role }, newKey());
          announceFor('add-member', 'Member added.');
          setDisplayName(''); setEmail(''); setPassword('');
          load();
        } catch (e) {
          if (e instanceof ApiFailure) setError(e.message);
        }
      })()}>Save member</button>
    </>
  );
}

function StandardsSheet({ url, announceFor, setError }: SheetHostProps): React.ReactElement {
  const [profile, setProfile] = useState<{ endplate_single_mm: number; endplate_double_mm: number; double_track_offset_mm: number; end_straight_mm: number; min_radius_mm: number; max_grade_tenths_percent: number; min_frog_number: number; reverse_curve_straight_mm: number; elevation_step_hundredths_mm: number; display_units: 'in' | 'mm'; revision: number } | null>(null);
  const load = useCallback(() => {
    if (!url.workspace) return;
    void get<typeof profile & { revision: number }>(`/api/workspaces/${url.workspace}/standards`).then((r) => setProfile(r)).catch(() => undefined);
  }, [url.workspace]);
  useEffect(load, [load]);

  if (!profile) return <EmptyState label="Standards" />;
  const units = profile.display_units;

  const lengthField = (key: 'endplate_single_mm' | 'endplate_double_mm' | 'double_track_offset_mm' | 'end_straight_mm' | 'min_radius_mm' | 'reverse_curve_straight_mm', label: string): React.ReactElement => (
    <div className="field">
      <label htmlFor={`std-${key}`}>{label}</label>
      <input
        id={`std-${key}`}
        type="number"
        role="spinbutton"
        step={units === 'in' ? 0.125 : 1}
        value={units === 'in' ? Number((profile[key] / 25.4).toFixed(3)) : profile[key]}
        onChange={(e) => {
          const mm = parseLengthToMm(e.target.value, units);
          if (mm !== null) setProfile({ ...profile, [key]: mm });
        }}
      />
    </div>
  );

  return (
    <>
      {lengthField('endplate_single_mm', 'Single endplate')}
      {lengthField('endplate_double_mm', 'Double endplate')}
      {lengthField('double_track_offset_mm', 'Double track offset')}
      {lengthField('end_straight_mm', 'End straight')}
      {lengthField('min_radius_mm', 'Minimum radius')}
      <div className="field">
        <label htmlFor="std-grade">Maximum grade</label>
        <input
          id="std-grade"
          type="number"
          role="spinbutton"
          step={0.1}
          value={(profile.max_grade_tenths_percent / 10).toFixed(1)}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (!Number.isNaN(value)) setProfile({ ...profile, max_grade_tenths_percent: Math.round(value * 10) });
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="std-frog">Minimum turnout</label>
        <input
          id="std-frog"
          type="number"
          role="spinbutton"
          step={1}
          value={profile.min_frog_number}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isInteger(value) && value > 0) setProfile({ ...profile, min_frog_number: value });
          }}
        />
      </div>
      {lengthField('reverse_curve_straight_mm', 'Reverse curve straight')}
      <div className="field">
        <label htmlFor="std-elevation">Elevation step</label>
        <input
          id="std-elevation"
          type="number"
          role="spinbutton"
          step={units === 'in' ? 0.125 : 0.05}
          value={units === 'in' ? Number((profile.elevation_step_hundredths_mm / 100 / 25.4).toFixed(3)) : profile.elevation_step_hundredths_mm / 100}
          onChange={(e) => {
            if (units === 'in') {
              const mm = parseLengthToMm(e.target.value, 'in');
              if (mm !== null) setProfile({ ...profile, elevation_step_hundredths_mm: mm * 100 });
            } else {
              const mm = Number(e.target.value);
              if (!Number.isNaN(mm)) setProfile({ ...profile, elevation_step_hundredths_mm: Math.round(mm * 100) });
            }
          }}
        />
      </div>
      <fieldset className="field">
        <legend>Display units</legend>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 44 }}>
          <input type="radio" name="units" checked={units === 'in'} onChange={() => setProfile({ ...profile, display_units: 'in' })} /> Inches
        </label>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 44 }}>
          <input type="radio" name="units" checked={units === 'mm'} onChange={() => setProfile({ ...profile, display_units: 'mm' })} /> Millimetres
        </label>
      </fieldset>
      <button className="lipped" onClick={() => void (async () => {
        announceFor('save-standards', 'Saving standards.');
        try {
          const { revision, ...profileFields } = profile;
          await api('PUT', `/api/workspaces/${url.workspace}/standards`, { revision, ...profileFields }, newKey());
          announceFor('save-standards', 'Standards saved.');
          load();
        } catch (e) {
          if (e instanceof ApiFailure) setError(e.message);
        }
      })()}>Save standards</button>
    </>
  );
}

function HistorySheet({ url, state }: SheetHostProps): React.ReactElement {
  const [history, setHistory] = useState<{ id: string; actor: string; at: string; action: string; object_id: string | null; from: string | null; to: string | null }[]>([]);
  useEffect(() => {
    if (!url.workspace || !state.layout) return;
    void get<{ history: typeof history }>(`/api/workspaces/${url.workspace}/layouts/${state.layout.id}/history`).then((r) => setHistory(r.history)).catch(() => undefined);
  }, [url.workspace, state.layout?.revision, state.layout?.working_hash]);

  return (
    <div className="row-list">
      {history.length === 0 ? <EmptyState label="History" /> : history.map((h) => (
        <div className="row" key={h.id}>
          <span>
            <strong>{h.action === 'purged' ? 'Purged module' : h.action}</strong>
            <br />
            <span style={{ fontSize: 13 }}>{h.actor} · {new Date(h.at).toLocaleString()}{h.from !== null ? ` · from ${h.from}` : ''}{h.to !== null ? ` · to ${h.to}` : ''}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function TrashSheet({ url, state, store, announceFor, setError }: SheetHostProps): React.ReactElement {
  const [modules, setModules] = useState<{ id: string; name: string; trashed_by: string | null; trashed_at: string | null }[]>([]);
  const load = useCallback(() => {
    if (!url.workspace || !state.layout) return;
    void get<{ modules: typeof modules }>(`/api/workspaces/${url.workspace}/layouts/${state.layout.id}/trash`).then((r) => setModules(r.modules)).catch(() => undefined);
  }, [url.workspace, state.layout?.id, state.layout?.revision]);
  useEffect(load, [load]);

  return (
    <div className="row-list">
      {modules.length === 0 ? <EmptyState label="Trash" /> : modules.map((m) => (
        <div className="row" key={m.id} data-testid={`trash-row-${m.id}`}>
          <span>{m.name} · trashed by {m.trashed_by ?? 'unknown'}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="lipped" onClick={() => void (async () => {
              announceFor('undo', 'Undoing.');
              try {
                if (!state.layout) return;
                await api('POST', `/api/workspaces/${url.workspace}/layouts/${state.layout.id}/trash/${m.id}/undo`, { revision: state.layout.revision }, newKey());
                await store.loadLayout(url.workspace ?? '', state.layout.id);
                announceFor('undo', 'Module restored.');
                load();
              } catch (e) {
                if (e instanceof ApiFailure) setError(e.message);
              }
            })()}>Undo</button>
            <button className="lipped orange" onClick={() => void (async () => {
              announceFor('purge', 'Purging.');
              try {
                if (!state.layout) return;
                await api('POST', `/api/workspaces/${url.workspace}/layouts/${state.layout.id}/trash/${m.id}/purge`, { revision: state.layout.revision }, newKey());
                await store.loadLayout(url.workspace ?? '', state.layout.id);
                announceFor('purge', 'Purged.');
                load();
              } catch (e) {
                if (e instanceof ApiFailure) setError(e.message);
              }
            })()}>Purge</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function SessionsSheet({ url, setUrl, state, store, announceFor, setError }: SheetHostProps): React.ReactElement {
  const [sessions, setSessions] = useState<{ id: string; name: string; status: string; tick: number; layout_version_number: number }[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [versionId, setVersionId] = useState('');
  const [ratio, setRatio] = useState(6);
  const [versions, setVersions] = useState<{ id: string; number: number; state: string; label: string }[]>([]);
  const [extraOpen, setExtraOpen] = useState(false);

  const load = useCallback(() => {
    if (!url.workspace) return;
    void get<{ sessions: typeof sessions }>(`/api/workspaces/${url.workspace}/sessions`).then((r) => setSessions(r.sessions)).catch(() => undefined);
  }, [url.workspace]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!url.workspace || !state.layout) return;
    void get<{ versions: typeof versions }>(`/api/workspaces/${url.workspace}/layouts/${state.layout.id}/versions`)
      .then((r) => {
        const published = r.versions.filter((v) => v.state === 'Published');
        setVersions(published);
        if (published[published.length - 1]) setVersionId(published[published.length - 1]!.id);
      }).catch(() => undefined);
  }, [url.workspace, state.layout?.id]);

  const sessionCommand = async (sessionId: string, command: 'start' | 'hold' | 'resume' | 'end', snapshot: { status: string; control_revision: number }) => {
    const pending = command === 'start' ? 'Starting session.' : command === 'hold' ? 'Holding session.' : command === 'resume' ? 'Resuming session.' : 'Ending session.';
    announceFor(command, pending);
    try {
      const result = await api<import('../shared/domain').SessionSnapshot>('POST', `/api/workspaces/${url.workspace}/sessions/${sessionId}/${command}`, {
        revision: snapshot.control_revision,
      }, newKey());
      await store.loadSession(url.workspace ?? '', sessionId);
      if (command === 'hold') announceFor('hold', `Session held at tick ${result.tick}.`);
      else if (command === 'resume') announceFor('resume', `Session resumed at tick ${result.tick}.`);
      else if (command === 'start') announceFor('start', 'Session running.');
      else announceFor('end', 'Session ended.');
      load();
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor(command, e.message);
        setError(e.message);
      }
    }
  };

  return (
    <>
      <div className="row-list">
        {sessions.map((s) => (
          <div className="row" key={s.id} style={{ flexWrap: 'wrap' }}>
            <span>
              <strong>{s.name}</strong>
              <br />
              <span style={{ fontSize: 13 }}>{s.status} · tick {s.tick} · version {s.layout_version_number}</span>
            </span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="lipped" onClick={() => {
                setUrl({ session: s.id, mode: 'operate', sheet: null, train: null, block: null });
                void store.loadSession(url.workspace ?? '', s.id);
              }}>Open</button>
              {s.status === 'Scheduled' ? <button className="lipped green" onClick={() => void sessionCommand(s.id, 'start', { status: s.status, control_revision: 0 })}>Start</button> : null}
              {s.status === 'Running' ? <button className="lipped orange" onClick={() => void (async () => {
                const snapshot = await get<import('../shared/domain').SessionSnapshot>(`/api/workspaces/${url.workspace}/sessions/${s.id}`);
                await sessionCommand(s.id, 'hold', snapshot);
              })()}>Hold</button> : null}
              {s.status === 'Held' || s.status === 'Interrupted' ? <button className="lipped green" onClick={() => void (async () => {
                const snapshot = await get<import('../shared/domain').SessionSnapshot>(`/api/workspaces/${url.workspace}/sessions/${s.id}`);
                await sessionCommand(s.id, 'resume', snapshot);
              })()}>Resume</button> : null}
              {s.status !== 'Ended' ? <button className="lipped pale" onClick={() => void (async () => {
                const snapshot = await get<import('../shared/domain').SessionSnapshot>(`/api/workspaces/${url.workspace}/sessions/${s.id}`);
                await sessionCommand(s.id, 'end', snapshot);
              })()}>End session</button> : null}
              <button className="lipped pale" onClick={() => {
                setUrl({ session: s.id, sheet: 'crew-packets', mode: 'operate' });
              }}>Packets</button>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="lipped" onClick={() => setNewOpen(true)}>New session</button>
        {state.session ? <button className="lipped pale" onClick={() => setExtraOpen(true)}>Add extra train</button> : null}
      </div>

      {newOpen ? (
        <div className="dialog-backdrop" style={{ zIndex: 82 }}>
          <div className="dialog" role="dialog" aria-label="New session">
            <h2>New session</h2>
            <div className="field">
              <label htmlFor="session-name">Session name</label>
              <input id="session-name" type="textbox" value={sessionName} onChange={(e) => setSessionName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="session-version">Published version</label>
              <select id="session-version" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>Version {v.number} {v.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="session-ratio">Clock ratio</label>
              <input id="session-ratio" type="number" role="spinbutton" min={1} max={12} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} />
            </div>
            <div className="actions">
              <button className="lipped pale" onClick={() => setNewOpen(false)}>Cancel</button>
              <button className="lipped" onClick={() => void (async () => {
                announceFor('create-session', 'Creating session.');
                try {
                  const snapshot = await api<import('../shared/domain').SessionSnapshot>('POST', `/api/workspaces/${url.workspace}/sessions`, {
                    name: sessionName,
                    layout_version_id: versionId,
                    ratio,
                  }, newKey());
                  announceFor('create-session', 'Session created.');
                  setNewOpen(false);
                  setUrl({ session: snapshot.id, mode: 'operate', sheet: null });
                  load();
                } catch (e) {
                  if (e instanceof ApiFailure) {
                    announceFor('create-session', e.message);
                    setError(e.message);
                  }
                }
              })()}>Create session</button>
            </div>
          </div>
        </div>
      ) : null}

      {extraOpen && state.session ? (
        <ExtraTrainDialog
          url={url}
          state={state}
          store={store}
          announceFor={announceFor}
          setError={setError}
          onClose={() => setExtraOpen(false)}
        />
      ) : null}
    </>
  );
}

function ExtraTrainDialog({ url, state, store, announceFor, setError, onClose }: {
  url: ViewUrlState;
  state: StoreState;
  store: SheetHostProps['store'];
  announceFor: (actionId: string, message: string) => void;
  setError: (message: string | null) => void;
  onClose: () => void;
}): React.ReactElement {
  const session = state.session;
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [length, setLength] = useState(1200);
  const [speed, setSpeed] = useState(40);
  const [direction, setDirection] = useState('east');
  const [startBlock, setStartBlock] = useState('');

  if (!session) return <></>;

  return (
    <div className="dialog-backdrop" style={{ zIndex: 83 }}>
      <div className="dialog" role="dialog" aria-label="Add extra train">
        <h2>Add extra train</h2>
        <div className="field"><label htmlFor="train-number">Train number</label><input id="train-number" type="textbox" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
        <div className="field"><label htmlFor="train-name">Train name</label><input id="train-name" type="textbox" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="train-length">Length (mm)</label><input id="train-length" type="number" role="spinbutton" min={300} max={2400} value={length} onChange={(e) => setLength(Number(e.target.value))} /></div>
        <div className="field"><label htmlFor="train-speed">Speed (mph)</label><input id="train-speed" type="number" role="spinbutton" min={5} max={60} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></div>
        <div className="field">
          <label htmlFor="train-direction">Direction</label>
          <select id="train-direction" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="east">East</option>
            <option value="west">West</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="train-start">Start block</label>
          <select id="train-start" value={startBlock} onChange={(e) => setStartBlock(e.target.value)}>
            <option value="">Choose a block</option>
            {session.blocks.map((b) => (
              <option key={b.id} value={b.id}>Block {b.number} {b.name}</option>
            ))}
          </select>
        </div>
        <div className="actions">
          <button className="lipped pale" onClick={onClose}>Cancel</button>
          <button className="lipped" onClick={() => void (async () => {
            announceFor('add-train', 'Adding train.');
            try {
              const snapshot = await api<import('../shared/domain').SessionSnapshot>('POST', `/api/workspaces/${url.workspace}/sessions/${session.id}/trains`, {
                revision: session.session_version,
                number,
                name,
                length_mm: length,
                speed_mph: speed,
                direction,
                start_block_id: startBlock,
              }, newKey());
              await store.loadSession(url.workspace ?? '', session.id);
              announceFor('add-train', `Train ${number} added. Session version ${snapshot.session_version}.`);
              onClose();
            } catch (e) {
              if (e instanceof ApiFailure) {
                announceFor('add-train', e.message);
                setError(e.message);
              }
            }
          })()}>Add train</button>
        </div>
      </div>
    </div>
  );
}
