import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { cardEntrance, cursorGlide, dropNote, liftNote, noteLands, springSettle } from '../lib/motion.js';
import { hiddenCountLabel, noteCountLabel } from '../lib/format.js';
import { isCardBack } from './useBoardState.js';
import type { PresenceCursor } from './useBoardState.js';
import type {
  BoardCluster,
  BoardConnector,
  BoardFrame,
  BoardNote,
  BoardResponse,
} from '../../shared/protocol.js';

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export interface CanvasProps {
  readonly board: BoardResponse;
  readonly viewport: Viewport;
  readonly setViewport: (next: Viewport) => void;
  readonly cursors: ReadonlyMap<string, PresenceCursor>;
  readonly showCursorNames: boolean;
  readonly revealedNoteIds: ReadonlySet<string>;
  readonly pickedUpNoteId: string | null;
  readonly registerNoteElement: (noteId: string, element: HTMLElement | null) => void;
  readonly registerFrameElement: (frameId: string, element: HTMLElement | null) => void;
  readonly onNoteActivate: (noteId: string) => void;
  readonly onNoteKeyDown: (noteId: string, event: React.KeyboardEvent) => void;
  readonly onNoteMoved: (noteId: string, x: number, y: number, element: HTMLElement) => Promise<void>;
  readonly onNoteDroppedOnCluster: (
    noteId: string,
    frameId: string,
    clusterId: string | null,
    index: number | null,
    element: HTMLElement,
  ) => Promise<void>;
  readonly onPointerMoved: (x: number, y: number) => void;
  readonly connectFrom: string | null;
  readonly connectMode: boolean;
  readonly voting: boolean;
  readonly onAddDot: (clusterId: string) => void;
  readonly onRemoveDot: (clusterId: string) => void;
  readonly dotPending: string | null;
  readonly isFacilitator: boolean;
  readonly onFrameMenu: (frameId: string, element: HTMLElement) => void;
  /** True once the board's first entrance has played, so later notes animate on their own. */
  readonly entranceSettled: boolean;
}

export function Canvas(props: CanvasProps): JSX.Element {
  const { board, viewport, setViewport } = props;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const entranceDone = useRef(false);

  // When a board first loads, notes rise slightly and fade in one after another in Tab order.
  useLayoutEffect(() => {
    if (entranceDone.current || board.notes.length === 0) return;
    entranceDone.current = true;
    const surface = surfaceRef.current;
    if (!surface) return;
    cardEntrance([...surface.querySelectorAll<HTMLElement>('[data-note-id]')]);
  }, [board.notes.length]);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!surfaceRef.current) return;
      event.preventDefault();
      const box = surfaceRef.current.getBoundingClientRect();
      const pointerX = event.clientX - box.left;
      const pointerY = event.clientY - box.top;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewport.zoom * factor));
      // Zoom around the pointer.
      const scale = zoom / viewport.zoom;
      setViewport({
        zoom,
        x: pointerX - (pointerX - viewport.x) * scale,
        y: pointerY - (pointerY - viewport.y) * scale,
      });
    },
    [viewport, setViewport],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.target !== event.currentTarget) return;
      panState.current = {
        x: event.clientX,
        y: event.clientY,
        originX: viewport.x,
        originY: viewport.y,
      };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [viewport],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const surface = surfaceRef.current;
      if (surface) {
        const box = surface.getBoundingClientRect();
        props.onPointerMoved(
          (event.clientX - box.left - viewport.x) / viewport.zoom,
          (event.clientY - box.top - viewport.y) / viewport.zoom,
        );
      }
      const pan = panState.current;
      if (!pan) return;
      setViewport({
        zoom: viewport.zoom,
        x: pan.originX + (event.clientX - pan.x),
        y: pan.originY + (event.clientY - pan.y),
      });
    },
    [viewport, setViewport, props],
  );

  const endPan = useCallback(() => {
    panState.current = null;
  }, []);

  const notesById = new Map(board.notes.map((note) => [note.id, note]));

  return (
    <main
      className="canvas"
      aria-label="Board"
      ref={surfaceRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div
        className="canvas-surface"
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
        }}
      >
        <svg className="connector-layer" aria-hidden="true">
          {board.connectors.map((connector) => (
            <ConnectorLine key={connector.id} connector={connector} notesById={notesById} />
          ))}
        </svg>

        {board.frames.map((frame) => (
          <FrameRegion key={frame.id} frame={frame} {...props} />
        ))}

        {[...props.cursors.values()].map((cursor) => (
          <Cursor key={cursor.cursorId} cursor={cursor} showName={props.showCursorNames} />
        ))}
      </div>
    </main>
  );
}

function ConnectorLine({
  connector,
  notesById,
}: {
  connector: BoardConnector;
  notesById: ReadonlyMap<string, BoardNote>;
}): JSX.Element | null {
  const from = notesById.get(connector.fromNoteId);
  const to = notesById.get(connector.toNoteId);
  if (!from || !to) return null;
  return (
    <line
      className="connector"
      x1={from.x + 90}
      y1={from.y + 32}
      x2={to.x + 90}
      y2={to.y + 32}
    />
  );
}

function FrameRegion(props: CanvasProps & { frame: BoardFrame }): JSX.Element {
  const { frame, board } = props;
  const clusters = board.clusters.filter((cluster) => cluster.frameId === frame.id);
  const clusteredNoteIds = new Set(clusters.flatMap((cluster) => [...cluster.noteIds]));
  const loose = board.notes.filter(
    (note) => note.frameId === frame.id && !clusteredNoteIds.has(note.id),
  );
  const counter = frame.hiddenCount > 0 ? hiddenCountLabel(frame.hiddenCount) : noteCountLabel(frame.noteCount);

  return (
    <section
      className="frame"
      role="region"
      aria-label={frame.title}
      ref={(element) => props.registerFrameElement(frame.id, element)}
      tabIndex={-1}
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
    >
      <div className="frame-head">
        <h2 tabIndex={-1}>{frame.title}</h2>
        <span className="frame-counter mono">{counter}</span>
        {props.isFacilitator && (
          <button
            type="button"
            className="quiet frame-options"
            onClick={(event) => props.onFrameMenu(frame.id, event.currentTarget)}
          >
            Frame options
          </button>
        )}
      </div>

      {clusters.map((cluster) => (
        <ClusterGroup key={cluster.id} cluster={cluster} {...props} />
      ))}

      {loose.map((note) => (
        <Note key={note.id} note={note} {...props} />
      ))}
    </section>
  );
}

function ClusterGroup(props: CanvasProps & { cluster: BoardCluster }): JSX.Element {
  const { cluster, board } = props;
  const notesById = new Map(board.notes.map((note) => [note.id, note]));
  const notes = cluster.noteIds.flatMap((id) => {
    const note = notesById.get(id);
    return note ? [note] : [];
  });

  return (
    <div
      className="cluster"
      role="group"
      aria-label={`Cluster: ${cluster.title}`}
      style={{ left: cluster.x - 0, top: cluster.y - 0 }}
      data-cluster-id={cluster.id}
    >
      <p className="cluster-title">{cluster.title}</p>
      <span className="cluster-count mono">{noteCountLabel(cluster.noteCount)}</span>
      <ul className="cluster-notes">
        {notes.map((note) => (
          <li key={note.id}>
            <Note note={note} inCluster {...props} />
          </li>
        ))}
      </ul>
      {props.voting && !props.isFacilitator && (
        <div className="cluster-dots">
          <button
            type="button"
            disabled={props.dotPending === cluster.id}
            onClick={() => props.onAddDot(cluster.id)}
          >
            {`Add dot to ${cluster.title}`}
          </button>
          <button
            type="button"
            disabled={props.dotPending === cluster.id}
            onClick={() => props.onRemoveDot(cluster.id)}
          >
            {`Remove dot from ${cluster.title}`}
          </button>
          <span className="mono">{`${cluster.myDots ?? 0} of yours`}</span>
        </div>
      )}
      {props.isFacilitator && typeof cluster.dotTotal === 'number' && (
        <span className="mono cluster-total">{`${cluster.dotTotal} dots`}</span>
      )}
    </div>
  );
}

interface NoteProps extends CanvasProps {
  readonly note: BoardNote;
  readonly inCluster?: boolean;
}

function Note(props: NoteProps): JSX.Element {
  const { note } = props;
  const ref = useRef<HTMLButtonElement>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastAt: number;
    velocityX: number;
    velocityY: number;
    moved: boolean;
  } | null>(null);

  const back = isCardBack(note) && !props.revealedNoteIds.has(note.id);
  const entranceSettled = props.entranceSettled;

  useEffect(() => {
    props.registerNoteElement(note.id, ref.current);
    // A note that lands after the board's first render fades in from slightly smaller.
    if (ref.current !== null && entranceSettled) noteLands(ref.current);
    return () => props.registerNoteElement(note.id, null);
    // The element identity is stable for the note's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (props.pickedUpNoteId === note.id) liftNote(element);
    else dropNote(element);
  }, [props.pickedUpNoteId, note.id]);

  const accessibleName = (): string => {
    if (back) return 'Hidden note';
    if (note.facilitatorOnly === true) return `Facilitator-only note: ${note.text ?? ''}`;
    if (note.kind === 'image') return 'Image note';
    if (note.revealed) return `Note: ${note.text ?? ''}`;
    return `Your note: ${note.text ?? ''}`;
  };

  // The facilitator's card backs show who wrote each note but never the text.
  const backLabel = note.authorName === undefined ? 'Hidden note' : `Hidden note by ${note.authorName}`;

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    if (back) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocityX: 0,
      velocityY: 0,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    const drag = dragState.current;
    const element = ref.current;
    if (!drag || !element) return;
    const dx = (event.clientX - drag.startX) / props.viewport.zoom;
    const dy = (event.clientY - drag.startY) / props.viewport.zoom;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastAt);
    drag.velocityX = ((event.clientX - drag.lastX) / elapsed) * 1000;
    drag.velocityY = ((event.clientY - drag.lastY) / elapsed) * 1000;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastAt = now;
    // The note follows the pointer exactly; this is the one motion not browser-managed.
    element.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    element.classList.add('note-dragging');
  }

  async function onPointerUp(event: React.PointerEvent<HTMLButtonElement>): Promise<void> {
    const drag = dragState.current;
    const element = ref.current;
    dragState.current = null;
    if (!drag || !element) return;
    element.classList.remove('note-dragging');
    if (!drag.moved) return;

    const dx = (event.clientX - drag.startX) / props.viewport.zoom;
    const dy = (event.clientY - drag.startY) / props.viewport.zoom;
    element.style.transform = '';

    // On release the note springs into its resting place, carrying its release speed.
    springSettle(element, { x: dx, y: dy }, { x: drag.velocityX, y: drag.velocityY });

    const dropped = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((candidate) => candidate instanceof HTMLElement && candidate.dataset.clusterId !== undefined);
    const clusterId = dropped instanceof HTMLElement ? (dropped.dataset.clusterId ?? null) : null;

    if (clusterId !== null && note.revealed) {
      await props.onNoteDroppedOnCluster(note.id, note.frameId, clusterId, null, element);
      return;
    }
    await props.onNoteMoved(note.id, note.x + dx, note.y + dy, element);
  }

  const className = [
    'note',
    back ? 'note-back' : 'note-front',
    note.facilitatorOnly === true ? 'note-private' : '',
    props.inCluster === true ? 'note-in-cluster' : '',
    props.connectFrom === note.id ? 'note-connect-source' : '',
  ]
    .filter((part) => part !== '')
    .join(' ');

  const style = props.inCluster === true ? undefined : { left: note.x, top: note.y };

  if (back) {
    // A card back holds no text nodes at all, not even visually hidden ones.
    return (
      <button
        type="button"
        ref={ref}
        className={className}
        style={style}
        data-note-id={note.id}
        aria-label={backLabel}
        onKeyDown={(event) => props.onNoteKeyDown(note.id, event)}
      >
        {note.authorName === undefined ? null : (
          <span className="note-author" aria-hidden="true">
            {note.authorName}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      ref={ref}
      className={className}
      style={style}
      data-note-id={note.id}
      aria-label={accessibleName()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => void onPointerUp(event)}
      onKeyDown={(event) => props.onNoteKeyDown(note.id, event)}
      onDoubleClick={() => props.onNoteActivate(note.id)}
      onClick={() => props.connectMode && props.onNoteActivate(note.id)}
    >
      {note.kind === 'image' && note.imageUrl ? (
        <img src={note.imageUrl} alt="" className="note-image" />
      ) : (
        <span className="note-text">{note.text}</span>
      )}
    </button>
  );
}

function Cursor({ cursor, showName }: { cursor: PresenceCursor; showName: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef({ x: cursor.x, y: cursor.y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    cursorGlide(element, last.current, { x: cursor.x, y: cursor.y });
    last.current = { x: cursor.x, y: cursor.y };
  }, [cursor.x, cursor.y]);

  return (
    <div
      className="cursor"
      ref={ref}
      aria-hidden="true"
      style={{
        transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`,
        // Each collaborator's halo is a soft round glow in that collaborator's hue.
        ['--cursor-hue' as string]: String(cursor.hue),
      }}
    >
      <span className="cursor-halo" />
      <span className="cursor-point" />
      {showName && cursor.name !== undefined && <span className="cursor-name">{cursor.name}</span>}
    </div>
  );
}
