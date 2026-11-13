import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Lock } from "lucide-react";
import { timecode } from "../../shared/timecode";
import type { Caption, Clip } from "../../shared/types";
import { canEdit, lastFrame, ppf, rateOfState, timelineOrder, visibleFrames, type ProjectState } from "./state";
import { addMarker, groupSelection, lockRow, moveRow, nudge, oneSecond, removeCurrent, snapFrame, splitAtPlayhead, toggleHidden } from "./actions";
import { useProject } from "./context";
import { Loupe, loupeSourceOf } from "./Loupe";
import type { ProjectStore } from "./store";

const LANE_HEIGHT = 48;
const EDGE_PX = 6;

interface Drag {
  clipId: string;
  mode: "move" | "trim-start" | "trim-end";
  startX: number;
  delta: number;
}

export function Timeline(): ReactNode {
  const { store, state } = useProject();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const editor = canEdit(state.role);
  const scale = ppf(state.zoom);
  const rate = rateOfState(state);
  const order = timelineOrder(state.clips, state.rows);
  const rovingId = state.current ?? order[0]?.id ?? null;
  const visible = visibleFrames(state);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return undefined;
    store.setCanvasWidth(element.clientWidth);
    const observer = new ResizeObserver(() => store.setCanvasWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [store]);

  useEffect(() => {
    const request = state.focusRequest;
    if (request) canvasRef.current?.querySelector<HTMLElement>(`[data-clip-id="${request.clip}"]`)?.focus({ preventScroll: true });
  }, [state.focusRequest?.seq]);

  const frameAt = (clientX: number): number => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? Math.max(0, Math.floor(state.first + (clientX - rect.left) / scale)) : 0;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
    if (handleKey(event, store)) event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || event.pointerType === "touch" || state.skim?.pinned) return;
    if (event.clientX < rect.left || event.clientX > rect.right) {
      if (state.skim) flushSync(() => store.setSkim(null));
      return;
    }
    const { frame, snapped } = snapFrame(store.s, frameAt(event.clientX));
    flushSync(() => store.setSkim({ pointer: { x: event.clientX, y: event.clientY }, frame, snapped, pinned: false, returnTo: null }));
  };

  const onPointerLeave = (): void => {
    if (store.s.skim && !store.s.skim.pinned) flushSync(() => store.setSkim(null));
  };

  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains("lane")) return;
    store.movePlayhead(frameAt(event.clientX));
  };

  const group = state.current ? state.clips.find((clip) => clip.id === state.current)?.group_id : null;
  const members = group ? state.clips.filter((clip) => clip.group_id === group) : [];
  const rowsByPosition = [...state.rows].sort((a, b) => a.position - b.position);

  const beginDrag = (event: PointerEvent<HTMLButtonElement>, clip: Clip): void => {
    if (!editor || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const row = state.rows.find((candidate) => candidate.id === clip.row_id);
    if (row?.locked) return;
    const box = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - box.left;
    const mode = offset <= EDGE_PX ? "trim-start" : box.width - offset <= EDGE_PX ? "trim-end" : "move";
    event.stopPropagation();
    const start = event.clientX;
    let delta = 0;
    setDrag({ clipId: clip.id, mode, startX: start, delta });
    const move = (moveEvent: globalThis.PointerEvent): void => {
      delta = Math.round((moveEvent.clientX - start) / scale);
      setDrag({ clipId: clip.id, mode, startX: start, delta });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (delta === 0) return;
      void store.submit((current) => {
        const live = current.clips.find((candidate) => candidate.id === clip.id);
        if (!live) return null;
        if (mode === "move") return { type: "move", clip_id: clip.id, start_frame: Math.max(0, live.start_frame + delta), row_id: live.row_id };
        return { type: "trim", clip_id: clip.id, edge: mode === "trim-start" ? "start" : "end", delta_frames: delta, ripple: false };
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section role="region" aria-label="Timeline" className="timeline" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="timeline-tools">
        <button type="button" tabIndex={-1} disabled={state.zoom === 0} onClick={() => store.setZoom(state.zoom - 1)}>
          Zoom out
        </button>
        <button type="button" tabIndex={-1} disabled={state.zoom === 5} onClick={() => store.setZoom(state.zoom + 1)}>
          Zoom in
        </button>
        <span className="muted tnum">
          Frame {state.playhead} · {timecode(rate, state.playhead)}
        </span>
      </div>
      <div className="timeline-body" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
        <div
          ref={canvasRef}
          data-timeline-canvas=""
          data-px-per-frame={scale}
          data-first-frame={state.first}
          data-zoom-level={state.zoom}
          data-visible-frames={visible}
          className="canvas"
          style={{ height: LANE_HEIGHT * rowsByPosition.length + 44 }}
          onPointerDown={onCanvasPointerDown}
        >
          <div className="strip pins-strip">
            {state.comments
              .filter((comment) => !comment.parent_id)
              .map((comment) => (
                <button
                  type="button"
                  key={comment.id}
                  tabIndex={-1}
                  data-comment-id={comment.id}
                  data-frame={comment.pin.live_frame}
                  aria-label={`Note by ${comment.author_name} at ${timecode(rate, comment.pin.live_frame)}`}
                  className="pin"
                  style={{ left: (comment.pin.live_frame - state.first) * scale }}
                  onClick={() => store.movePlayhead(comment.pin.live_frame)}
                >
                  {comment.author_name.split(" ")[0]}
                </button>
              ))}
          </div>
          <div className="strip markers-strip">
            {state.markers.map((marker) => (
              <div key={marker.frame} data-marker-frame={marker.frame} className="marker muted" style={{ left: (marker.frame - state.first) * scale }}>
                {marker.label}
              </div>
            ))}
          </div>
          {rowsByPosition.map((row) => (
            <div role="group" aria-label={row.name} key={row.id} className="lane" data-row-id={row.id}>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Row ${row.name}${row.locked ? ", locked" : ""}`}
                className="row-label"
                disabled={!editor}
                onClick={() => lockRow(store, row.id, !row.locked)}
              >
                {row.locked ? <Lock size={14} aria-hidden="true" /> : null}
                {row.name}
              </button>
              <div className="lane-clip">
                {row.kind === "caption" ? (
                  <Captions state={state} rowId={row.id} />
                ) : (
                  order
                    .filter((clip) => clip.row_id === row.id)
                    .map((clip) => (
                      <ClipBlock
                        key={clip.id}
                        clip={clip}
                        state={state}
                        roving={clip.id === rovingId}
                        drag={drag?.clipId === clip.id ? drag : null}
                        store={store}
                        onPointerDown={(event) => beginDrag(event, clip)}
                      />
                    ))
                )}
              </div>
            </div>
          ))}
          <div className="overlay">
            {members.length > 1 && group ? <GroupOutline state={state} group={group} members={members} /> : null}
            {Object.entries(state.remotePlayheads).map(([person, frame]) => (
              <div key={person} data-remote-playhead={person} className="remote-playhead" style={{ left: (frame - state.first) * scale }}>
                <span className="tnum">{person}</span>
              </div>
            ))}
            <div data-playhead-frame={state.playhead} className="playhead" style={{ left: (state.playhead - state.first) * scale }} />
            {state.skim?.snapped ? <div data-snap-guide="" className="snap-guide line" style={{ left: (state.skim.frame - state.first) * scale }} /> : null}
          </div>
        </div>
      </div>
      {state.skim ? <Loupe state={loupeSourceOf(state)} skim={state.skim} anchor={state.skim.pointer ? null : (canvasRef.current?.getBoundingClientRect() ?? null)} /> : null}
    </section>
  );
}

function ClipBlock(props: {
  clip: Clip;
  state: ProjectState;
  roving: boolean;
  drag: Drag | null;
  store: ProjectStore;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}): ReactNode {
  const { clip, state, roving, drag, store, onPointerDown } = props;
  const scale = ppf(state.zoom);
  const rate = rateOfState(state);
  const selected = state.selection.includes(clip.id);
  let start = clip.start_frame;
  let end = clip.end_frame;
  if (drag) {
    if (drag.mode === "move") {
      start += drag.delta;
      end += drag.delta;
    } else if (drag.mode === "trim-start") start += drag.delta;
    else end += drag.delta;
  }
  const name = `${clip.name}, ${timecode(rate, clip.start_frame)} to ${timecode(rate, clip.end_frame)}${selected ? ", selected" : ""}${clip.hidden ? ", hidden" : ""}`;
  const classes = ["clip", clip.hidden ? "hidden" : "", selected ? "selected" : "", state.pending[clip.id] ? "pending" : "", state.gliding[clip.id] ? "glide" : "", clip.kind].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-clip-id={clip.id}
      data-row-id={clip.row_id}
      data-start-frame={clip.start_frame}
      data-end-frame={clip.end_frame}
      data-hidden={clip.hidden ? "true" : "false"}
      {...(clip.group_id ? { "data-group-id": clip.group_id } : {})}
      aria-label={name}
      tabIndex={roving ? 0 : -1}
      style={{ left: (start - state.first) * scale, width: Math.max(0, (end - start) * scale) }}
      onPointerDown={onPointerDown}
      onFocus={() => store.setCurrent(clip.id)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) store.toggleSelect(clip.id);
      }}
    >
      <span className="clip-name">{clip.name}</span>{" "}
      <span className="clip-tc muted tnum">{timecode(rate, clip.start_frame)}</span>
      {state.winners[clip.id] ? <span className="clip-winner">{state.winners[clip.id]}</span> : null}
    </button>
  );
}

function Captions({ state, rowId }: { state: ProjectState; rowId: string }): ReactNode {
  const scale = ppf(state.zoom);
  const rate = rateOfState(state);
  const span = visibleFrames(state);
  const cues = state.captions.filter((caption) => caption.row_id === rowId).sort((a, b) => a.start_frame - b.start_frame);
  const shown = cues
    .map((caption, index) => ({ caption, number: index + 1 }))
    .filter(({ caption }) => caption.end_frame >= state.first - span && caption.start_frame <= state.first + 2 * span);
  return (
    <>
      {shown.map(({ caption, number }) => (
        <CaptionBlock key={caption.id} caption={caption} number={number} state={state} rate={rate} scale={scale} />
      ))}
    </>
  );
}

function CaptionBlock({ caption, number, state, rate, scale }: { caption: Caption; number: number; state: ProjectState; rate: ReturnType<typeof rateOfState>; scale: number }): ReactNode {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-caption-id={caption.id}
      aria-label={`Caption ${number}, ${timecode(rate, caption.start_frame)} to ${timecode(rate, caption.end_frame)}`}
      className="clip caption"
      style={{ left: (caption.start_frame - state.first) * scale, width: (caption.end_frame - caption.start_frame) * scale }}
    >
      <span className="clip-name" data-text={caption.text.replace(/\n/g, " ")} />
    </button>
  );
}

function GroupOutline({ state, group, members }: { state: ProjectState; group: string; members: Clip[] }): ReactNode {
  const scale = ppf(state.zoom);
  const positions = new Map(state.rows.map((row) => [row.id, row.position]));
  const rows = [...members].sort((a, b) => (positions.get(a.row_id) ?? 0) - (positions.get(b.row_id) ?? 0));
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  if (!top || !bottom) return null;
  const start = Math.min(...members.map((clip) => clip.start_frame));
  const end = Math.max(...members.map((clip) => clip.end_frame));
  const ordered = [...state.rows].sort((a, b) => a.position - b.position);
  const topIndex = ordered.findIndex((row) => row.id === top.row_id);
  const bottomIndex = ordered.findIndex((row) => row.id === bottom.row_id);
  return (
    <div
      data-group-outline={group}
      data-group-first-row={top.row_id}
      data-group-last-row={bottom.row_id}
      className="group-outline"
      style={{ left: (start - state.first) * scale, width: (end - start) * scale, top: 44 + topIndex * LANE_HEIGHT, height: (bottomIndex - topIndex + 1) * LANE_HEIGHT }}
    />
  );
}

/** The timeline shortcuts. Returns true when the key was handled so the browser's own action is suppressed. */
function handleKey(event: KeyboardEvent<HTMLElement>, store: ProjectStore): boolean {
  const state = store.s;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key;
  const editor = canEdit(state.role);
  const step = event.shiftKey ? oneSecond(state) : 1;
  const target = event.target as HTMLElement;
  if (state.skim?.pinned && pinnedKey(event, store)) return true;
  if (mod && (key === "z" || key === "Z")) {
    if (editor) void store.history(event.shiftKey ? "redo" : "undo");
    return true;
  }
  if (mod && (key === "g" || key === "G")) {
    if (editor) groupSelection(store, event.shiftKey);
    return true;
  }
  if (mod) return false;
  switch (key) {
    case "ArrowLeft":
    case "ArrowRight":
      if (editor && !event.altKey) nudge(store, (key === "ArrowLeft" ? -1 : 1) * step);
      return true;
    case "ArrowUp":
    case "ArrowDown":
      if (event.altKey) {
        if (editor) moveRow(store, key === "ArrowUp" ? -1 : 1);
      } else focusNeighbourRow(store, key === "ArrowUp" ? -1 : 1);
      return true;
    case "s":
    case "S":
      if (editor) splitAtPlayhead(store);
      return true;
    case "h":
    case "H":
      if (editor) toggleHidden(store);
      return true;
    case "Delete":
    case "Backspace":
      if (editor) removeCurrent(store, event.shiftKey);
      return true;
    case "Enter":
      if (target.classList.contains("row-label")) return false;
      if (state.current) store.toggleSelect(state.current);
      return true;
    case "Home":
      store.home();
      return true;
    case "End":
      store.end();
      return true;
    case "+":
    case "=":
      store.setZoom(state.zoom + 1);
      return true;
    case "-":
    case "_":
      store.setZoom(state.zoom - 1);
      return true;
    case ",":
    case "<":
      store.movePlayhead(state.playhead - 1);
      return true;
    case ".":
    case ">":
      store.movePlayhead(state.playhead + 1);
      return true;
    case " ":
      store.setPlaying(!state.playing);
      return true;
    case "i":
    case "I":
      store.setRange({ in: state.playhead, out: state.range.out !== null && state.range.out <= state.playhead ? null : state.range.out });
      return true;
    case "o":
    case "O":
      store.setRange(state.range.in === state.playhead ? { in: null, out: null } : { in: state.range.in, out: state.playhead });
      return true;
    case "m":
    case "M":
      if (editor) addMarker(store);
      return true;
    case "l":
    case "L":
      store.setSkim({ pointer: null, frame: state.playhead, snapped: false, pinned: true, returnTo: state.current });
      return true;
    default:
      return false;
  }
}

/** While the loupe is pinned: arrows move it, Enter moves the playhead there, Escape closes it. */
function pinnedKey(event: KeyboardEvent<HTMLElement>, store: ProjectStore): boolean {
  const skim = store.s.skim;
  if (!skim) return false;
  const step = event.shiftKey ? oneSecond(store.s) : 1;
  switch (event.key) {
    case "ArrowLeft":
      store.setSkim({ ...skim, frame: Math.max(0, skim.frame - step) });
      return true;
    case "ArrowRight":
      store.setSkim({ ...skim, frame: Math.min(lastFrame(store.s), skim.frame + step) });
      return true;
    case "Enter":
      store.movePlayhead(skim.frame);
      return true;
    case "Escape":
    case "l":
    case "L":
      store.setSkim(null);
      if (skim.returnTo) store.requestFocus(skim.returnTo);
      else (event.currentTarget as HTMLElement).focus();
      return true;
    default:
      return false;
  }
}

function focusNeighbourRow(store: ProjectStore, direction: -1 | 1): void {
  const state = store.s;
  const clip = state.clips.find((candidate) => candidate.id === state.current);
  if (!clip) return;
  const rows = [...state.rows].sort((a, b) => a.position - b.position);
  let index = rows.findIndex((row) => row.id === clip.row_id) + direction;
  while (index >= 0 && index < rows.length) {
    const row = rows[index];
    const candidates = state.clips.filter((other) => other.row_id === row?.id);
    if (candidates.length) {
      const nearest = [...candidates].sort((a, b) => Math.abs(a.start_frame - clip.start_frame) - Math.abs(b.start_frame - clip.start_frame))[0];
      if (nearest) store.requestFocus(nearest.id);
      return;
    }
    index += direction;
  }
}
