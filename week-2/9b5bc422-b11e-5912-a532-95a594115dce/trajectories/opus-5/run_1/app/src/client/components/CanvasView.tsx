import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize, Minus, Plus, StickyNote } from 'lucide-react';
import { textOf } from '../../domain/blocks.ts';
import { announce as copy } from '../../domain/copy.ts';
import { CARD_WIDTH, clampZoom, fitToView, zoomAbout, zoomPercent } from '../../domain/canvas.ts';
import { isBothKept } from '../../domain/materialise.ts';
import type { BlockRecord, ConnectorRecord, NoteRecord, WorldPosition } from '../../domain/types.ts';
import { nameOfBlock, nameOfNote } from '../blockNaming.ts';
import { focusWhenReady } from '../focus.ts';
import { blocks as blockActions, connectors as connectorActions, notes as noteActions } from '../store/actions.ts';
import { announce, type State } from '../store/store.ts';
import { BothKept } from './BothKept.tsx';
import { bothKept as bothKeptCopy } from '../../domain/copy.ts';
import { RecordTableBlockBody } from './BlockRow.tsx';

export type CanvasCard = {
  id: string;
  kind: 'block' | 'note';
  type: string;
  name: string;
  label: string;
  position: WorldPosition;
  block?: BlockRecord;
  note?: NoteRecord;
};

export type ViewportState = { zoom: number; panX: number; panY: number };

export function canvasCards(
  state: State,
  blocks: BlockRecord[],
  notes: NoteRecord[],
): CanvasCard[] {
  const cards: CanvasCard[] = [];
  for (const block of blocks) {
    const name = nameOfBlock(state, block);
    cards.push({
      id: block.id,
      kind: 'block',
      type: block.type,
      name,
      label: name.split(': ')[1] ?? name,
      position: block.position ?? { x: 0, y: 0 },
      block,
    });
  }
  for (const note of notes) {
    const name = nameOfNote(state, note);
    cards.push({
      id: note.id,
      kind: 'note',
      type: 'note',
      name,
      label: name.split(': ')[1] ?? name,
      position: note.position,
      note,
    });
  }
  return cards;
}

export function CardBody(props: { card: CanvasCard }) {
  const { card } = props;
  if (card.kind === 'note') return <span className="card-text">{textOf(card.note!.text)}</span>;
  const block = card.block as BlockRecord;
  if (block.type === 'divider') return <hr />;
  if (block.type === 'table' && block.tableId) return <RecordTableBlockBody tableId={block.tableId} />;
  return <span className="card-text">{textOf(block.text)}</span>;
}

export type CardFlight = {
  offsets: Record<string, { dx: number; dy: number }>;
  order: string[];
  gap: number;
  animating: boolean;
};

export function CanvasView(props: {
  documentId: string;
  cards: CanvasCard[];
  connectors: ConnectorRecord[];
  selected: string | null;
  onSelect: (id: string) => void;
  view: ViewportState;
  onView: (view: ViewportState) => void;
  showConnectors: boolean;
  flight?: CardFlight | null;
}) {
  const region = useRef<HTMLDivElement | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; origin: WorldPosition } | null>(null);
  const touches = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ distance: number; view: ViewportState; centre: { x: number; y: number } } | null>(null);
  const pan = useRef<{ x: number; y: number; view: ViewportState } | null>(null);

  const { zoom, panX, panY } = props.view;

  useLayoutEffect(() => {
    const measured: Record<string, number> = {};
    for (const card of props.cards) {
      const element = region.current?.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
      if (element) measured[card.id] = element.offsetHeight;
    }
    setHeights((current) => {
      const same = props.cards.every((card) => current[card.id] === measured[card.id]);
      return same ? current : measured;
    });
  }, [props.cards, zoom]);

  const focusCard = (cardId: string) => {
    focusWhenReady(`[data-card-id="${cardId}"]`);
  };

  const moveCard = async (card: CanvasCard, position: WorldPosition, tell: boolean) => {
    if (card.kind === 'note') await noteActions.setPosition(card.id, position);
    else await blockActions.setPosition(card.id, position);
    if (tell) announce(copy.cardMoved(card.label, Math.round(position.x), Math.round(position.y)));
  };

  const nudge = async (card: CanvasCard, dx: number, dy: number) => {
    const position = { x: card.position.x + dx, y: card.position.y + dy };
    await moveCard(card, position, true);
  };

  const setZoom = (next: number, about?: { x: number; y: number }) => {
    const box = region.current?.getBoundingClientRect();
    const centre = about ?? { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
    props.onView(zoomAbout(props.view, next / props.view.zoom, centre));
  };

  const fit = () => {
    const box = region.current?.getBoundingClientRect();
    if (!box) return;
    props.onView(
      fitToView(
        props.cards.map((card) => ({
          x: card.position.x,
          y: card.position.y,
          width: CARD_WIDTH,
          height: (heights[card.id] ?? 120) / zoom,
        })),
        { width: box.width, height: box.height },
      ),
    );
  };

  const onRegionKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (event.altKey && key.startsWith('Arrow')) {
      event.preventDefault();
      const step = 50;
      props.onView({
        zoom,
        panX: panX + (key === 'ArrowLeft' ? step : key === 'ArrowRight' ? -step : 0),
        panY: panY + (key === 'ArrowUp' ? step : key === 'ArrowDown' ? -step : 0),
      });
      return;
    }
    if (key === '+' || key === '=') {
      event.preventDefault();
      setZoom(clampZoom(zoom * 1.25));
      return;
    }
    if (key === '-') {
      event.preventDefault();
      setZoom(clampZoom(zoom / 1.25));
      return;
    }
    if (key === '0') {
      event.preventDefault();
      setZoom(1);
      return;
    }
    if (key === '!' || (key === '1' && event.shiftKey)) {
      event.preventDefault();
      fit();
      return;
    }
    if ((key === 'n' || key === 'N') && !editing) {
      event.preventDefault();
      await newNote();
    }
  };

  const newNote = async () => {
    const noteId = await noteActions.create(props.documentId, {
      x: Math.round((-panX + 60) / zoom),
      y: Math.round((-panY + 60) / zoom),
    });
    focusCard(noteId);
  };

  const onCardKeyDown = async (event: React.KeyboardEvent<HTMLElement>, card: CanvasCard) => {
    const key = event.key;
    if (key.startsWith('Arrow') && !event.altKey) {
      event.preventDefault();
      const step = event.shiftKey ? 50 : 10;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      await nudge(card, dx, dy);
      return;
    }
    if (key === 'c' || key === 'C') {
      event.preventDefault();
      setConnectFrom(card.id);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      if (connectFrom && connectFrom !== card.id) {
        const outcome = await connectorActions.toggle(props.documentId, connectFrom, card.id);
        setConnectFrom(null);
        announce(outcome === 'added' ? copy.connected : copy.connectionRemoved);
        return;
      }
      if (card.kind === 'note' || card.block) setEditing(card.id);
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      setConnectFrom(null);
      return;
    }
    if (key === 'Delete' && card.kind === 'note') {
      event.preventDefault();
      await noteActions.remove(card.id);
    }
  };

  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const point = { x: event.clientX - box.left, y: event.clientY - box.top };
        props.onView(zoomAbout(props.view, event.deltaY < 0 ? 1.1 : 1 / 1.1, point));
        return;
      }
      props.onView({ zoom, panX: panX - event.deltaX, panY: panY - event.deltaY });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [props, zoom, panX, panY]);

  const cardAt = (id: string) => props.cards.find((card) => card.id === id);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-card-id]');
    const id = target?.dataset.cardId ?? null;
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.current.size === 2) {
        const [first, second] = [...touches.current.values()];
        const box = region.current?.getBoundingClientRect();
        pinch.current = {
          distance: Math.hypot(first.x - second.x, first.y - second.y),
          view: props.view,
          centre: {
            x: (first.x + second.x) / 2 - (box?.left ?? 0),
            y: (first.y + second.y) / 2 - (box?.top ?? 0),
          },
        };
        pan.current = null;
        drag.current = null;
        return;
      }
      if (id && id === props.selected) {
        const card = cardAt(id);
        if (card) drag.current = { id, startX: event.clientX, startY: event.clientY, origin: card.position };
        return;
      }
      pan.current = { x: event.clientX, y: event.clientY, view: props.view };
      return;
    }
    if (id) {
      const card = cardAt(id);
      props.onSelect(id);
      if (card) drag.current = { id, startX: event.clientX, startY: event.clientY, origin: card.position };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch.current && touches.current.size === 2) {
      const [first, second] = [...touches.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const factor = distance / pinch.current.distance;
      props.onView(zoomAbout(pinch.current.view, factor, pinch.current.centre));
      return;
    }
    if (pan.current) {
      props.onView({
        zoom: pan.current.view.zoom,
        panX: pan.current.view.panX + (event.clientX - pan.current.x),
        panY: pan.current.view.panY + (event.clientY - pan.current.y),
      });
      return;
    }
    const moving = drag.current;
    if (!moving) return;
    const card = cardAt(moving.id);
    if (!card) return;
    const position = {
      x: Math.round(moving.origin.x + (event.clientX - moving.startX) / zoom),
      y: Math.round(moving.origin.y + (event.clientY - moving.startY) / zoom),
    };
    void moveCard(card, position, false);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (!touches.current.size) pan.current = null;
    const moving = drag.current;
    drag.current = null;
    if (!moving) return;
    const card = cardAt(moving.id);
    if (card && (card.position.x !== moving.origin.x || card.position.y !== moving.origin.y)) {
      announce(copy.cardMoved(card.label, Math.round(card.position.x), Math.round(card.position.y)));
    }
  };

  const centreOf = (id: string) => {
    const card = cardAt(id);
    if (!card) return null;
    const height = (heights[id] ?? 120) / zoom;
    return {
      x: panX + (card.position.x + CARD_WIDTH / 2) * zoom,
      y: panY + (card.position.y + height / 2) * zoom,
    };
  };

  return (
    <div
      role="region"
      aria-label="Canvas"
      className="canvas"
      ref={region}
      tabIndex={-1}
      data-zoom={zoom}
      data-pan-x={panX}
      data-pan-y={panY}
      onKeyDown={(event) => void onRegionKeyDown(event)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {props.showConnectors && (
        <svg className="connector-layer" aria-hidden="true">
          {props.connectors.map((connector) => {
            const from = centreOf(connector.from);
            const to = centreOf(connector.to);
            if (!from || !to) return null;
            return (
              <line
                key={connector.id}
                data-connector-id={connector.id}
                data-from={connector.from}
                data-to={connector.to}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}
        </svg>
      )}

      {props.cards.map((card) => {
        const offset = props.flight?.offsets[card.id];
        const place = props.flight ? props.flight.order.indexOf(card.id) : -1;
        const style = {
          left: `${panX + card.position.x * zoom}px`,
          top: `${panY + card.position.y * zoom}px`,
          width: `${CARD_WIDTH}px`,
          transform: offset
            ? `translate(${offset.dx}px, ${offset.dy}px) scale(${zoom})`
            : `scale(${zoom})`,
          transformOrigin: 'top left',
          transition: props.flight?.animating
            ? `transform 320ms cubic-bezier(0.22, 0.86, 0.25, 1) ${Math.max(place, 0) * props.flight.gap}ms`
            : undefined,
        };
        return (
          <div key={card.id} className="card-holder" style={style}>
            {editing === card.id ? (
              <textarea
                className="paper card card-editor"
                aria-label={card.name}
                data-card-id={card.id}
                data-block-id={card.kind === 'block' ? card.id : undefined}
                data-note-id={card.kind === 'note' ? card.id : undefined}
                data-block-type={card.type}
                data-world-x={card.position.x}
                data-world-y={card.position.y}
                autoFocus
                defaultValue={card.kind === 'note' ? textOf(card.note!.text) : textOf(card.block!.text)}
                onChange={(event) => {
                  if (card.kind === 'note') void noteActions.setText(card.id, event.target.value);
                  else void blockActions.setText(card.id, event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
                    event.preventDefault();
                    setEditing(null);
                    window.setTimeout(() => {
                      region.current?.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`)?.focus();
                    }, 0);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="paper card"
                aria-label={card.name}
                data-card-id={card.id}
                data-block-id={card.kind === 'block' ? card.id : undefined}
                data-note-id={card.kind === 'note' ? card.id : undefined}
                data-block-type={card.type}
                data-indent={card.block && card.block.indent ? card.block.indent : undefined}
                data-world-x={card.position.x}
                data-world-y={card.position.y}
                data-unsynced={card.name.includes(', not yet synced') ? 'true' : undefined}
                data-selected={props.selected === card.id ? 'true' : undefined}
                onFocus={() => props.onSelect(card.id)}
                onDoubleClick={() => setEditing(card.id)}
                onKeyDown={(event) => void onCardKeyDown(event, card)}
              >
                <CardBody card={card} />
              </button>
            )}
          </div>
        );
      })}

      {props.cards
        .filter((card) => card.id === props.selected || isBothKept(card.kind === 'note' ? card.note?.text : card.block?.text))
        .map((card) => (
          <div
            key={`beside-${card.id}`}
            className="card-aside"
            style={{
              left: `${panX + card.position.x * zoom}px`,
              top: `${panY + (card.position.y + (heights[card.id] ?? 100) / zoom) * zoom}px`,
            }}
          >
            {props.selected === card.id && (
              <button type="button" className="button connect-button" onClick={() => setConnectFrom(card.id)}>
                {`Connect ${card.label}`}
              </button>
            )}
            {isBothKept(card.kind === 'note' ? card.note?.text : card.block?.text) && (
              <BothKept
                entity={card.kind === 'note' ? 'note' : 'block'}
                entityId={card.id}
                field="text"
                values={card.kind === 'note' ? card.note!.text : card.block!.text}
                sentence={bothKeptCopy.block}
                afterChoice={() => focusCard(card.id)}
              />
            )}
          </div>
        ))}

      <div className="paper zoom-strip">
        <button type="button" className="button" onClick={() => setZoom(clampZoom(zoom / 1.25))}>
          <Minus aria-hidden="true" size={16} />
          <span>Zoom out</span>
        </button>
        <button type="button" className="button" onClick={() => setZoom(clampZoom(zoom * 1.25))}>
          <Plus aria-hidden="true" size={16} />
          <span>Zoom in</span>
        </button>
        <button type="button" className="button" onClick={fit}>
          <Maximize aria-hidden="true" size={16} />
          <span>Fit to view</span>
        </button>
        <button type="button" className="button" onClick={() => void newNote()}>
          <StickyNote aria-hidden="true" size={16} />
          <span>New note</span>
        </button>
        <p role="status" aria-label="Zoom level" className="zoom-level">
          {zoomPercent(zoom)}
        </p>
      </div>
    </div>
  );
}

