import { useEffect, useRef, useState } from 'react';
import { textOf } from '../../domain/blocks.ts';
import {
  DOCUMENT_STATE,
  announce as copy,
  bothKept as bothKeptCopy,
  type DocumentStateName,
} from '../../domain/copy.ts';
import { documentBlocks, documentConnectors, documentNotes, isBothKept } from '../../domain/materialise.ts';
import { BlockRow, focusBlock } from '../components/BlockRow.tsx';
import { BothKept } from '../components/BothKept.tsx';
import { CanvasView, CardBody, canvasCards, type CanvasCard, type ViewportState } from '../components/CanvasView.tsx';
import { InspectorPanel } from '../components/Shell.tsx';
import { ShareDialog } from '../components/ShareDialog.tsx';
import { useReducedMotion, useStore } from '../hooks.ts';
import { navigate, replaceQuery, useRoute } from '../router.ts';
import { focusWhenReady, whenReady } from '../focus.ts';
import { noticeSaved } from '../savedNotice.ts';
import { blocks as blockActions, documents } from '../store/actions.ts';
import { NO_FOLDER } from '../store/prefs.ts';
import { announce, setPrefs, snapshot, syncing } from '../store/store.ts';
import { CARD_WIDTH } from '../../domain/canvas.ts';
import type { BlockRecord } from '../../domain/types.ts';
import { NotFound } from './NotFound.tsx';

type ViewState = 'page' | 'dealing' | 'canvas' | 'gathering';

type DealFlight = {
  phase: 'deal';
  offsets: Record<string, { dx: number; dy: number }>;
  order: string[];
  gap: number;
  animating: boolean;
};

type GatherFlight = {
  phase: 'gather';
  ghosts: { id: string; card: CanvasCard; from: { x: number; y: number }; to: { x: number; y: number } }[];
  zoom: number;
  gap: number;
  animating: boolean;
};

type Flight = DealFlight | GatherFlight | null;

const TRAVEL = 320;
const SPREAD = 600;
const STEP = 30;

function gapFor(count: number): number {
  if (count <= 1) return 0;
  return Math.min(STEP, SPREAD / (count - 1));
}

export function DocumentScreen(props: { documentId: string }) {
  const state = useStore();
  const route = useRoute();
  const reduced = useReducedMotion();
  const wanted: 'page' | 'canvas' = route.query.get('view') === 'canvas' ? 'canvas' : 'page';
  const [viewState, setViewState] = useState<ViewState>(wanted);
  const [flight, setFlight] = useState<Flight>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [namingFolder, setNamingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [selected, setSelected] = useState<string | null>(route.query.get('block'));
  const table = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);

  const document_ = state.workspace.documents.get(props.documentId);
  const blocks = document_ ? documentBlocks(state.workspace, props.documentId) : [];
  const notes = document_ ? documentNotes(state.workspace, props.documentId) : [];
  const connectors = document_ ? documentConnectors(state.workspace, props.documentId) : [];
  const cards = canvasCards(state, blocks, notes);

  const stored = state.prefs.canvas[props.documentId];
  const view: ViewportState = stored ?? { zoom: 1, panX: 40, panY: 40 };
  const setView = (next: ViewportState) =>
    setPrefs({ canvas: { ...state.prefs.canvas, [props.documentId]: next } });

  const showingCanvas = viewState === 'canvas' || viewState === 'dealing';

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  const clearTimers = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  const pageRects = (): Record<string, { x: number; y: number }> => {
    const box = table.current?.getBoundingClientRect();
    const found: Record<string, { x: number; y: number }> = {};
    if (!box) return found;
    for (const block of blocks) {
      const element = table.current?.querySelector<HTMLElement>(
        `[data-block-id="${block.id}"], [data-ghost-id="${block.id}"]`,
      );
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      found[block.id] = { x: rect.left - box.left, y: rect.top - box.top };
    }
    return found;
  };

  const liveCardRects = (): Record<string, { x: number; y: number }> => {
    const box = table.current?.getBoundingClientRect();
    const found: Record<string, { x: number; y: number }> = {};
    if (!box) return found;
    for (const card of cards) {
      const element = table.current?.querySelector<HTMLElement>(
        `[data-card-id="${card.id}"], [data-ghost-card="${card.id}"]`,
      );
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      found[card.id] = { x: rect.left - box.left, y: rect.top - box.top };
    }
    return found;
  };

  const focusSelected = (target: 'page' | 'canvas', blockId: string | null) => {
    if (!blockId) return;
    if (target === 'canvas') {
      focusWhenReady(`[data-card-id="${blockId}"]`);
      return;
    }
    whenReady(`[data-block-id="${blockId}"]`, () => focusBlock(blockId));
  };

  const switchView = async () => {
    if (!document_) return;
    const goingToCanvas = !showingCanvas;
    const chosen = selected ?? blocks[0]?.id ?? null;
    const mid = flight !== null;
    /** A press during the motion turns every card back from where it is now. */
    const starts = mid || !goingToCanvas ? liveCardRects() : pageRects();

    if (goingToCanvas) await blockActions.giveSlots(props.documentId);
    const latest = snapshot();
    const freshBlocks = documentBlocks(latest.workspace, props.documentId);
    const freshCards = canvasCards(latest, freshBlocks, documentNotes(latest.workspace, props.documentId));

    clearTimers();
    replaceQuery({ view: goingToCanvas ? 'canvas' : 'page', block: chosen ?? null });
    setSelected(chosen);
    announce(goingToCanvas ? copy.canvasView(freshCards.length) : copy.pageView(freshBlocks.length));

    if (reduced) {
      setFlight(null);
      setViewState(goingToCanvas ? 'canvas' : 'page');
      focusSelected(goingToCanvas ? 'canvas' : 'page', chosen);
      return;
    }

    const gap = mid ? 0 : gapFor(freshCards.length);

    if (goingToCanvas) {
      const offsets: Record<string, { dx: number; dy: number }> = {};
      for (const card of freshCards) {
        const target = {
          x: view.panX + card.position.x * view.zoom,
          y: view.panY + card.position.y * view.zoom,
        };
        const from = starts[card.id];
        if (!from) continue;
        offsets[card.id] = { dx: from.x - target.x, dy: from.y - target.y };
      }
      setViewState('dealing');
      setFlight({ phase: 'deal', offsets, order: freshCards.map((card) => card.id), gap, animating: false });
      focusSelected('canvas', chosen);
      timers.current.push(
        window.setTimeout(() => {
          setFlight((current) =>
            current && current.phase === 'deal' ? { ...current, offsets: {}, animating: true } : current,
          );
        }, 30),
      );
      const total = gap * Math.max(freshCards.length - 1, 0) + TRAVEL + 40;
      timers.current.push(
        window.setTimeout(() => {
          setFlight(null);
          setViewState('canvas');
        }, total),
      );
      return;
    }

    setViewState('gathering');
    setFlight({
      phase: 'gather',
      ghosts: freshCards.map((card) => ({
        id: card.id,
        card,
        from: starts[card.id] ?? {
          x: view.panX + card.position.x * view.zoom,
          y: view.panY + card.position.y * view.zoom,
        },
        to: starts[card.id] ?? { x: 0, y: 0 },
      })),
      zoom: view.zoom,
      gap,
      animating: false,
    });
    focusSelected('page', chosen);
    timers.current.push(
      window.setTimeout(() => {
        const targets = pageRects();
        setFlight((current) =>
          current && current.phase === 'gather'
            ? {
                ...current,
                animating: true,
                ghosts: current.ghosts.map((ghost) => ({
                  ...ghost,
                  to: targets[ghost.id] ?? ghost.from,
                })),
              }
            : current,
        );
      }, 30),
    );
    const total = gap * Math.max(freshCards.length - 1, 0) + TRAVEL + 40;
    timers.current.push(
      window.setTimeout(() => {
        setFlight(null);
        setViewState('page');
      }, total),
    );
  };

  useEffect(() => {
    if (wanted === 'canvas' && viewState === 'page') {
      void blockActions.giveSlots(props.documentId).then(() => setViewState('canvas'));
    }
    if (wanted === 'page' && viewState === 'canvas') setViewState('page');
  }, [wanted, viewState, props.documentId]);

  useEffect(() => {
    if (viewState === 'canvas') void blockActions.giveSlots(props.documentId);
  }, [viewState, props.documentId, blocks.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'C' || event.key === 'c')) {
        event.preventDefault();
        void switchView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!document_) return <NotFound kind="document" />;

  const title = textOf(document_.title);
  const documentState: DocumentStateName = !syncing()
    ? 'local'
    : state.pending.byDocument.get(props.documentId) === 'local'
      ? 'local'
      : state.pending.byDocument.get(props.documentId) === 'waiting'
        ? 'waiting'
        : 'synced';

  const selectBlock = (blockId: string) => {
    setSelected(blockId);
    replaceQuery({ block: blockId });
  };

  const sheet = (ghost: boolean) => (
    <div className={`paper sheet${ghost ? ' sheet-ghost' : ''}`} aria-hidden={ghost ? 'true' : undefined}>
      {!ghost && (
        <>
          <textarea
            className="document-title display"
            aria-label="Document title"
            rows={1}
            value={title}
            readOnly={isBothKept(document_.title)}
            onChange={(event) => {
              void documents.setTitle(props.documentId, event.target.value).then(noticeSaved);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (blocks[0]) focusBlock(blocks[0].id);
              }
            }}
          />
          {isBothKept(document_.title) && (
            <BothKept
              entity="document"
              entityId={props.documentId}
              field="title"
              values={document_.title}
              sentence={bothKeptCopy.block}
              afterChoice={() => undefined}
            />
          )}
          <p role="group" aria-label="Document state" className="document-state">
            {DOCUMENT_STATE[documentState]}
          </p>
        </>
      )}
      <div className="blocks">
        {blocks.map((block) =>
          ghost ? (
            <GhostBlock key={block.id} block={block} />
          ) : (
            <BlockRow
              key={block.id}
              block={block}
              documentId={props.documentId}
              ordered={blocks}
              onFocus={selectBlock}
            />
          ),
        )}
      </div>
    </div>
  );

  return (
    <div className="screen document-screen">
      <div className="document-bar">
        <button
          type="button"
          className="button"
          aria-pressed={showingCanvas}
          onClick={() => void switchView()}
        >
          Switch view
        </button>
      </div>

      <div
        role="region"
        aria-label="Table"
        className="green-table"
        data-view-state={viewState}
        ref={table}
      >
        {(viewState === 'page' || viewState === 'gathering') && sheet(false)}
        {viewState === 'dealing' && sheet(true)}

        {(viewState === 'canvas' || viewState === 'dealing') && (
          <CanvasView
            documentId={props.documentId}
            cards={cards}
            connectors={connectors}
            selected={selected}
            onSelect={selectBlock}
            view={view}
            onView={setView}
            showConnectors={viewState === 'canvas'}
            flight={flight && flight.phase === 'deal' ? flight : null}
          />
        )}

        {flight && flight.phase === 'gather' && (
          <div className="ghost-canvas" aria-hidden="true">
            {flight.ghosts.map((ghost, index) => (
              <div
                key={ghost.id}
                data-ghost-card={ghost.id}
                className="paper card card-ghost"
                style={{
                  left: `${ghost.from.x}px`,
                  top: `${ghost.from.y}px`,
                  width: `${CARD_WIDTH}px`,
                  transform: flight.animating
                    ? `translate(${ghost.to.x - ghost.from.x}px, ${ghost.to.y - ghost.from.y}px) scale(${flight.zoom})`
                    : `scale(${flight.zoom})`,
                  transformOrigin: 'top left',
                  transition: flight.animating
                    ? `transform ${TRAVEL}ms cubic-bezier(0.22, 0.86, 0.25, 1) ${index * flight.gap}ms`
                    : undefined,
                }}
              >
                <CardBody card={ghost.card} />
              </div>
            ))}
          </div>
        )}
      </div>

      <InspectorPanel forceClosed={showingCanvas}>
        <div className="inspector-body">
          <label className="field">
            <span>Tags</span>
            <input
              type="text"
              value={document_.tags.join(', ')}
              onChange={(event) =>
                void documents.setTags(
                  props.documentId,
                  event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <label className="field">
            <span>Folder</span>
            <select
              value={document_.folder ?? NO_FOLDER}
              onChange={(event) =>
                void documents.setFolder(props.documentId, event.target.value === NO_FOLDER ? null : event.target.value)
              }
            >
              <option value={NO_FOLDER}>{NO_FOLDER}</option>
              {state.prefs.folders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button" onClick={() => setNamingFolder(true)}>
            New folder
          </button>
          {namingFolder && (
            <label className="field">
              <span>New folder name</span>
              <input
                type="text"
                autoFocus
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  const name = folderName.trim();
                  if (!name) return;
                  setPrefs({ folders: [...new Set([...state.prefs.folders, name])] });
                  void documents.setFolder(props.documentId, name);
                  setFolderName('');
                  setNamingFolder(false);
                }}
              />
            </label>
          )}
          <button
            type="button"
            className="button"
            aria-pressed={document_.starred}
            onClick={() => void documents.setStarred(props.documentId, !document_.starred)}
          >
            Star this document
          </button>
          <button type="button" className="button" onClick={() => setShareOpen(true)}>
            Share
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              void documents.setTrashed(props.documentId, true);
              announce(copy.movedToTrash(title || 'Untitled'));
              navigate('/');
            }}
          >
            Move to trash
          </button>
        </div>
      </InspectorPanel>

      {shareOpen && <ShareDialog documentId={props.documentId} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

function GhostBlock(props: { block: BlockRecord }) {
  const text = textOf(props.block.text);
  return (
    <div className="block" data-ghost-id={props.block.id}>
      <div className="block-body">
        <span className={`block-text block-${props.block.type}`}>{text}</span>
      </div>
    </div>
  );
}
