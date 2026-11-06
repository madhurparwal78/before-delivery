import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, Ref } from "react";
import { flushSync } from "react-dom";
import { Maximize, Minus, Plus, StickyNote } from "lucide-react";
import type { WorldPosition } from "../../shared/sync.ts";
import { attachmentText } from "../domain/attachments.ts";
import { blockLabel, blockName, isTextBlock, noteLabel, shortLabel } from "../domain/blocks.ts";
import type { WorkspaceRecord } from "../domain/types.ts";
import { deleteNote, moveCard, newNote, setBlockText, setNoteText, toggleConnector } from "../store/actions.ts";
import { announce } from "../store/announcer.ts";
import type { Camera } from "../store/preferences.ts";
import { readCamera, writeCamera } from "../store/preferences.ts";
import { blocksOf, connectorsOf, getRecord, hasNotch, notesOf } from "../store/workspace.ts";
import { blockNameOf, TableSummary, tableLink, useFittedHeight } from "./BlockList.tsx";
import { BothKept } from "./BothKept.tsx";
import { Link } from "./common.tsx";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
const WHEEL_RATE = 0.002;
const STEP = 10;
const BIG_STEP = 50;
const PAN_STEP = 50;
const FIT_MARGIN = 40;
const DRAG_THRESHOLD = 3;
const CARD_WIDTH = 240;

type CardRecord = WorkspaceRecord<"block"> | WorkspaceRecord<"note">;

export const cardsInReadingOrder = (documentId: string): CardRecord[] => [...blocksOf(documentId), ...notesOf(documentId)];

const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** Zooms keeping the region point (`x`, `y`) fixed. */
function zoomedAbout(camera: Camera, zoom: number, x: number, y: number): Camera {
  const next = clampZoom(zoom);
  const scale = next / camera.zoom;
  return { zoom: next, panX: x - (x - camera.panX) * scale, panY: y - (y - camera.panY) * scale };
}

const cardLabel = (card: CardRecord): string => {
  if (card.kind === "note") return card.sync.bothKept["text"] ? String(card.sync.bothKept["text"][0] ?? "") : noteLabel(card.fields);
  const kept = card.sync.bothKept["text"];
  const table = card.fields.tableId ? getRecord("table", card.fields.tableId) : undefined;
  return blockLabel(kept ? { ...card.fields, text: String(kept[0] ?? "") } : card.fields, table?.fields.name);
};

const cardName = (card: CardRecord): string =>
  card.kind === "block"
    ? blockNameOf(card)
    : blockName("Note", cardLabel(card), { notched: hasNotch(card), bothKept: Boolean(card.sync.bothKept["text"]) });

function CardBody({ card }: { card: CardRecord }) {
  if (card.kind === "note") return <p className="card-text">{cardLabel(card)}</p>;
  const { type } = card.fields;
  if (type === "divider") return <hr />;
  if (type === "table") return <div className="card-table"><TableSummary tableId={card.fields.tableId} /></div>;
  if (type === "image" || type === "file") {
    const attachment = card.fields.attachmentId ? getRecord("attachment", card.fields.attachmentId) : undefined;
    return card.fields.attachmentId
      ? <><p className="card-text">{card.fields.fileName}</p><p className="file-state">{attachmentText(attachment)}</p></>
      : <p className="card-text">{type === "image" ? "Image" : "File"}</p>;
  }
  return (
    <p className="card-text">
      {type === "todo" && <span className="card-tick" data-checked={card.fields.checked || undefined} aria-hidden="true" />}
      {cardLabel(card)}
    </p>
  );
}

function CardEditor({ card, onLeave }: { card: CardRecord; onLeave: () => void }) {
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);
  useFittedHeight(field, card.fields.text);
  useLayoutEffect(() => {
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }, [field]);
  const save = card.kind === "block" ? setBlockText : setNoteText;
  return (
    <textarea
      ref={setField}
      className="card-editor"
      aria-label={cardName(card)}
      rows={2}
      value={card.fields.text}
      onChange={(event) => save(card.id, event.target.value.replaceAll("\n", " "))}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          onLeave();
        }
      }}
      onBlur={onLeave}
    />
  );
}

type Gesture =
  | { type: "pan"; startX: number; startY: number; camera: Camera; moved: boolean }
  | { type: "move"; card: CardRecord; startX: number; startY: number; origin: WorldPosition; moved: boolean }
  | { type: "pinch"; startDistance: number; startMiddle: { x: number; y: number }; camera: Camera };

export function focusCard(id: string): void {
  document.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus({ preventScroll: true });
}

export function Canvas({ documentId, regionRef, connectors, selected, onSelect, onInspect, interactive }: {
  documentId: string;
  regionRef: Ref<HTMLDivElement>;
  connectors: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onInspect: (camera: Camera) => void;
  interactive: boolean;
}) {
  const [camera, setCameraState] = useState(() => readCamera(documentId));
  const [editing, setEditing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const region = useRef<HTMLDivElement | null>(null);
  const world = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const cameraRef = useRef(camera);
  const justDragged = useRef(false);
  const cards = cardsInReadingOrder(documentId);
  const lines = connectorsOf(documentId);

  const setCamera = (next: Camera): void => {
    cameraRef.current = next;
    setCameraState(next);
    onInspect(next);
    writeCamera(documentId, next);
  };
  useEffect(() => onInspect(cameraRef.current), []);

  useLayoutEffect(() => {
    const measured: Record<string, number> = {};
    for (const element of world.current?.querySelectorAll<HTMLElement>("[data-card]") ?? []) {
      measured[element.dataset["card"] ?? ""] = element.offsetHeight;
    }
    if (JSON.stringify(measured) !== JSON.stringify(heights)) setHeights(measured);
  });

  const regionPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = region.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };
  const regionCentre = (): { x: number; y: number } => {
    const rect = region.current?.getBoundingClientRect();
    return { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
  };
  const stepZoom = (factor: number): void => {
    const centre = regionCentre();
    setCamera(zoomedAbout(cameraRef.current, cameraRef.current.zoom * factor, centre.x, centre.y));
  };
  const fit = (): void => {
    const rect = region.current?.getBoundingClientRect();
    if (!rect || !cards.length) return;
    const boxes = cards.map((card) => {
      const { x, y } = card.fields.card ?? { x: 0, y: 0 };
      return { x, y, right: x + CARD_WIDTH, bottom: y + (heights[card.id] ?? 0) };
    });
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const width = Math.max(...boxes.map((box) => box.right)) - left;
    const height = Math.max(...boxes.map((box) => box.bottom)) - top;
    const zoom = clampZoom(Math.min((rect.width - FIT_MARGIN * 2) / width, (rect.height - FIT_MARGIN * 2) / height));
    setCamera({ zoom, panX: (rect.width - width * zoom) / 2 - left * zoom, panY: (rect.height - height * zoom) / 2 - top * zoom });
  };
  const addNote = (): void => {
    const centre = regionCentre();
    const { panX, panY, zoom } = cameraRef.current;
    const id = flushSync(() => newNote(documentId, { x: Math.round((centre.x - panX) / zoom), y: Math.round((centre.y - panY) / zoom) }));
    focusCard(id);
    setEditing(id);
  };

  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const current = cameraRef.current;
      if (event.ctrlKey || event.metaKey) {
        const point = regionPoint(event.clientX, event.clientY);
        setCamera(zoomedAbout(current, current.zoom * Math.exp(-event.deltaY * WHEEL_RATE), point.x, point.y));
      } else setCamera({ ...current, panX: current.panX - event.deltaX, panY: current.panY - event.deltaY });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const startEditing = (card: CardRecord): void => {
    const editable = card.kind === "note" || isTextBlock(card.fields.type);
    if (editable && !card.sync.bothKept["text"]) setEditing(card.id);
  };
  const moveBy = (card: CardRecord, dx: number, dy: number): void => {
    const { x, y } = card.fields.card ?? { x: 0, y: 0 };
    const position = { x: x + dx, y: y + dy };
    moveCard(card, position);
    announce(`Moved ${shortLabel(cardLabel(card))} to ${position.x}, ${position.y}.`);
  };
  const finishConnection = (to: string): void => {
    if (!connecting || connecting === to) return;
    announce(toggleConnector(documentId, connecting, to) ? "Connected." : "Connection removed.");
    setConnecting(null);
  };
  const onCardKey = (card: CardRecord, event: KeyboardEvent<HTMLDivElement>): boolean => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const arrow = arrows[event.key];
    if (arrow && !event.altKey) moveBy(card, arrow[0], arrow[1]);
    else if (event.key === "Enter") {
      if (connecting && connecting !== card.id) finishConnection(card.id);
      else startEditing(card);
    } else if (event.key === "Escape") setConnecting(null);
    else if (event.key.toLowerCase() === "c" && !event.metaKey && !event.ctrlKey) setConnecting(card.id);
    else if (event.key === "Delete" && card.kind === "note") {
      const position = cards.findIndex((candidate) => candidate.id === card.id);
      deleteNote(card.id);
      focusCard(cards[position - 1]?.id ?? "");
    }
    else return false;
    return true;
  };
  const onRegionKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).tagName === "TEXTAREA" || event.metaKey || event.ctrlKey) return;
    const cardId = (event.target as HTMLElement).dataset["card"];
    const card = cards.find((candidate) => candidate.id === cardId);
    const current = cameraRef.current;
    const pans: Record<string, [number, number]> = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] };
    const pan = pans[event.key];
    if (event.altKey && pan) setCamera({ ...current, panX: current.panX + pan[0], panY: current.panY + pan[1] });
    else if (card && onCardKey(card, event)) return event.preventDefault();
    else if (event.key === "+" || event.key === "=") stepZoom(ZOOM_STEP);
    else if (event.key === "-") stepZoom(1 / ZOOM_STEP);
    else if (event.key === "0") setCamera(zoomedAbout(current, 1, regionCentre().x, regionCentre().y));
    else if (event.code === "Digit1" && event.shiftKey) fit();
    else if (event.key.toLowerCase() === "n") addNote();
    else return;
    event.preventDefault();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (!interactive || target.closest("a, textarea, button, .zoom-strip, .both-kept")) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [one, two] = [...pointers.current.values()];
    if (one && two) {
      gesture.current = {
        type: "pinch",
        startDistance: Math.hypot(two.x - one.x, two.y - one.y),
        startMiddle: regionPoint((one.x + two.x) / 2, (one.y + two.y) / 2),
        camera: cameraRef.current,
      };
      return;
    }
    const cardId = target.closest<HTMLElement>("[data-card]")?.dataset["card"];
    const card = cards.find((candidate) => candidate.id === cardId);
    const touch = event.pointerType === "touch";
    if (card?.fields.card && (!touch || selected === card.id)) {
      gesture.current = { type: "move", card, startX: event.clientX, startY: event.clientY, origin: card.fields.card, moved: false };
    } else {
      gesture.current = { type: "pan", startX: event.clientX, startY: event.clientY, camera: cameraRef.current, moved: false };
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = gesture.current;
    if (!active || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (active.type === "pinch") {
      const [one, two] = [...pointers.current.values()];
      if (!one || !two) return;
      const middle = regionPoint((one.x + two.x) / 2, (one.y + two.y) / 2);
      const zoom = clampZoom(active.camera.zoom * (Math.hypot(two.x - one.x, two.y - one.y) / active.startDistance));
      const worldX = (active.startMiddle.x - active.camera.panX) / active.camera.zoom;
      const worldY = (active.startMiddle.y - active.camera.panY) / active.camera.zoom;
      setCamera({ zoom, panX: middle.x - worldX * zoom, panY: middle.y - worldY * zoom });
      return;
    }
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!active.moved) {
      active.moved = true;
      region.current?.setPointerCapture(event.pointerId);
    }
    if (active.type === "pan") setCamera({ ...active.camera, panX: active.camera.panX + dx, panY: active.camera.panY + dy });
    else {
      const zoom = cameraRef.current.zoom;
      moveCard(active.card, { x: Math.round(active.origin.x + dx / zoom), y: Math.round(active.origin.y + dy / zoom) });
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    const active = gesture.current;
    if (active?.type === "pinch") {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (!active?.moved) return;
    justDragged.current = true;
    if (active.type === "move") {
      const moved = getRecord(active.card.kind, active.card.id);
      if (moved?.fields.card) announce(`Moved ${shortLabel(cardLabel(moved))} to ${moved.fields.card.x}, ${moved.fields.card.y}.`);
    }
  };
  const centreOf = (id: string): WorldPosition | null => {
    const card = cards.find((candidate) => candidate.id === id)?.fields.card;
    return card ? { x: card.x + CARD_WIDTH / 2, y: card.y + (heights[id] ?? 0) / 2 } : null;
  };

  const percent = Math.round(camera.zoom * 100);
  return (
    <div
      ref={(element) => {
        region.current = element;
        if (typeof regionRef === "function") regionRef(element);
        else if (regionRef) regionRef.current = element;
      }}
      role="region"
      aria-label="Canvas"
      className="canvas"
      data-zoom={camera.zoom}
      data-pan-x={camera.panX}
      data-pan-y={camera.panY}
      onKeyDown={onRegionKey}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={world} className="world" style={{ transform: `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom})` }}>
        {connectors && (
          <svg className="connectors" aria-hidden="true">
            {lines.map((line) => {
              const from = centreOf(line.fields.from);
              const to = centreOf(line.fields.to);
              return from && to ? (
                <line key={line.id} data-connector-id={line.id} data-from={line.fields.from} data-to={line.fields.to} x1={from.x} y1={from.y} x2={to.x} y2={to.y} pathLength={1} />
              ) : null;
            })}
          </svg>
        )}
        {cards.map((card) => {
          const position = card.fields.card ?? { x: 0, y: 0 };
          const type = card.kind === "block" ? card.fields.type : "note";
          const link = card.kind === "block" ? tableLink(card.fields.tableId) : null;
          const kept = card.sync.bothKept["text"];
          return (
            <div
              key={card.id}
              className="slot"
              data-block-id={card.id}
              data-block-type={type}
              {...(card.kind === "block" && ["bulleted", "numbered", "todo"].includes(type) ? { "data-indent": String(card.fields.indent) } : {})}
              style={{ left: position.x, top: position.y }}
            >
              {/* The body sits beside the button: a card's name is only the first 40 characters of its text. */}
              <div className="card-frame">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={cardName(card)}
                  className={`card card-${type}`}
                  data-card={card.id}
                  data-world-x={position.x}
                  data-world-y={position.y}
                  data-selected={selected === card.id || undefined}
                  data-notched={hasNotch(card) || undefined}
                  data-connecting={connecting === card.id || undefined}
                  onFocus={(event) => { if (event.target === event.currentTarget) onSelect(card.id); }}
                  onClick={() => {
                    if (justDragged.current) justDragged.current = false;
                    else if (connecting && connecting !== card.id) finishConnection(card.id);
                    else onSelect(card.id);
                  }}
                  onDoubleClick={() => startEditing(card)}
                />
                <div className={`card-body card-${type}`}>
                  {editing === card.id ? (
                    <CardEditor card={card} onLeave={() => { setEditing(null); focusCard(card.id); }} />
                  ) : <CardBody card={card} />}
                </div>
              </div>
              {link && <Link href={link.href} className="card-link">{link.name}</Link>}
              {selected === card.id && interactive && (
                <button type="button" tabIndex={-1} className="connect" aria-label={`Connect ${shortLabel(cardLabel(card)) || type}`} onClick={() => setConnecting(card.id)}>
                  Connect
                </button>
              )}
              {kept && (
                <BothKept
                  kind={card.kind}
                  id={card.id}
                  field="text"
                  values={kept}
                  text={String}
                  sentence="Both kept. Two devices changed this block. Pick the one to keep."
                  onChosen={() => focusCard(card.id)}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="zoom-strip">
        <button type="button" className="icon-button" aria-label="Zoom out" disabled={camera.zoom <= ZOOM_MIN} onClick={() => stepZoom(1 / ZOOM_STEP)}><Minus aria-hidden="true" /></button>
        <span role="status" aria-label="Zoom level" className="zoom-level">{percent}%</span>
        <button type="button" className="icon-button" aria-label="Zoom in" disabled={camera.zoom >= ZOOM_MAX} onClick={() => stepZoom(ZOOM_STEP)}><Plus aria-hidden="true" /></button>
        <button type="button" className="icon-button" aria-label="Fit to view" onClick={fit}><Maximize aria-hidden="true" /></button>
        <button type="button" className="icon-button" aria-label="New note" onClick={addNote}><StickyNote aria-hidden="true" /></button>
      </div>
    </div>
  );
}
