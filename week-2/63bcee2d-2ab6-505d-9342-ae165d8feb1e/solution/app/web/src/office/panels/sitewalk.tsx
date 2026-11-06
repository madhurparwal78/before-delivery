import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { zoneToday } from "../../../../shared/format";
import { call, patch, post, type Result } from "../../api";
import { FILE_LIMIT, otherIllegal, tooLarge } from "../copy";
import { useOffice, type Role } from "../context";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { ErrorSummary, TextField, useFormId, type Errors } from "../fields";
import { ActionButton, StickyBar } from "../layout";
import { PanelTitle, useProject } from "../project";
import { useResource } from "../resource";
import { animate, useReducedMotion } from "./glide";
import "./sitewalk.css";

// Site walk: the Intent seam splits the approved render and the latest site photo at the seam, and the
// snags sit on it as numbered markers (brief: Intent seam, Snags).

interface Viewpoint {
  id: string;
  name: string;
  storeCode: string;
  hasRender: boolean;
  photoId: string | null;
}

type SnagState = "open" | "fixed" | "closed" | "reopened";

interface Snag {
  id: string;
  number: number;
  s: number;
  y: number;
  title: string;
  note: string;
  observedOn: string;
  state: SnagState;
  version: number;
  /** The moves the server offers this caller on this snag. */
  actions: ("fix" | "close" | "reopen" | "move")[];
}

const STATE_WORD: Record<SnagState, string> = { open: "Open", fixed: "Fixed", closed: "Closed", reopened: "Reopened" };
const SHAPE: Record<SnagState, "ring" | "square" | "diamond" | "triangle"> = { open: "ring", fixed: "square", closed: "diamond", reopened: "triangle" };
const EDITORS: Role[] = ["director", "project_lead", "designer"];
const NEAR = 2;
const TOUCH_SLOP = 8;

const clamp = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));
const markerId = (snag: { id: string }): string => `snag-marker-${snag.id}`;
const integerOrTyped = (typed: string): number | string => (/^\s*-?\d+\s*$/.test(typed) ? Number(typed) : typed);

function SnagShape({ state }: { state: SnagState }) {
  const shape = SHAPE[state];
  return (
    <svg className={`snag-shape snag-shape-${shape}`} data-shape={shape} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {shape === "ring" && <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.5" />}
      {shape === "square" && <rect x="2.5" y="2.5" width="11" height="11" fill="currentColor" />}
      {shape === "diamond" && <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor" />}
      {shape === "triangle" && <path d="M8 2 14.5 14H1.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />}
    </svg>
  );
}

interface DropValues {
  s: string;
  y: string;
  title: string;
  note: string;
  observedOn: string;
}


export function SiteWalkPanel() {
  const { project } = useProject();
  const office = useOffice();
  const role = office.member?.role;
  const editor = !!role && EDITORS.includes(role);
  const reduced = useReducedMotion();
  const viewpoints = useResource<{ viewpoints: Viewpoint[] }>(`/api/projects/${project.id}/viewpoints`);
  const [chosen, setChosen] = useState<string | null>(null);
  const list = viewpoints.data?.viewpoints ?? [];
  const viewpoint = list.find((item) => item.id === chosen) ?? list[0] ?? null;
  const snags = useResource<{ snags: Snag[] }>(viewpoint ? `/api/viewpoints/${viewpoint.id}/snags` : null);
  const snagList = snags.data?.snags ?? [];

  const [seam, setSeam] = useState(50);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [glide, setGlide] = useState<{ from: number; token: number } | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [drop, setDrop] = useState<DropValues | null>(null);
  const [dropErrors, setDropErrors] = useState<Errors>({});
  const [pinned, setPinned] = useState<string | null>(null);
  const formId = useFormId("drop-snag");
  const photoInput = useRef<HTMLInputElement>(null);
  const renderInput = useRef<HTMLInputElement>(null);

  const active = snagList.find((snag) => snag.id === activeId) ?? null;

  useEffect(() => {
    setSeam(50);
    setActiveId(null);
  }, [viewpoint?.id]);

  // A draft kept when the session ended reopens the Drop snag sheet with its values.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !viewpoint) return;
    restored.current = true;
    const draft = office.takeDraft("drop-snag");
    if (draft) setDrop(draft as unknown as DropValues);
  }, [viewpoint, office]);

  // The new marker grows from 0.6 of its size over the quick duration.
  useLayoutEffect(() => {
    if (!pinned) return;
    animate(document.getElementById(markerId({ id: pinned })), [
      { transform: "translate(-50%, -50%) scale(0.6)" }, { transform: "translate(-50%, -50%) scale(1)" }], "--t-quick");
    setPinned(null);
  }, [pinned]);

  const openDrop = (): void => {
    setDropErrors({});
    setDrop({ s: String(seam), y: "50", title: "", note: "", observedOn: zoneToday("Asia/Hong_Kong") });
  };

  const select = (snag: Snag): void => {
    setActiveId(snag.id);
    if (snag.s === seam) return;
    setGlide({ from: seam, token: Date.now() + Math.random() });
    setSeam(snag.s);
  };

  const pin = async (): Promise<void> => {
    if (!drop || !viewpoint) return;
    const values = drop;
    office.announce("Pinning snag…");
    const result = await post<{ snag: Snag }>(`/api/viewpoints/${viewpoint.id}/snags`, {
      s: integerOrTyped(values.s), y: integerOrTyped(values.y), title: values.title, note: values.note, observedOn: values.observedOn,
    });
    if (!result.ok) {
      const body = office.refused(result, { id: "drop-snag", values: { ...values } });
      if (body?.error === "validation") {
        flushSync(() => setDropErrors(body.errors ?? {}));
        focusRefusal(openDialog());
      } else if (body) {
        office.alert(otherIllegal(String(body.from ?? body.error)));
        focusRefusal(openDialog());
      } else focusRefusal(openDialog());
      return;
    }
    const snag = result.data.snag;
    await snags.reload();
    flushSync(() => {
      setDrop(null);
      setPinned(snag.id);
    });
    document.getElementById(markerId(snag))?.focus();
    office.announce(`Snag ${snag.number} pinned at ${snag.s}% across, ${snag.y}% down.`);
  };

  const move = async (snag: Snag, s: number, y: number): Promise<boolean> => {
    const result = await patch<{ snag: Snag }>(`/api/snags/${snag.id}`, { s, y });
    if (result.ok) {
      await snags.reload();
      office.announce(`Snag ${snag.number} moved.`);
      return true;
    }
    const body = office.refused(result);
    if (body?.error === "illegal_transition" && body.from === "closed") {
      office.alert(`Snag ${snag.number} is closed, so it can't be moved. It's back where it was.`);
    } else if (body) office.alert(otherIllegal(String(body.from ?? body.error)));
    return false;
  };

  const transition = async (action: "fix" | "close" | "reopen"): Promise<void> => {
    if (!active) return;
    office.announce("Saving…");
    const result = await post<{ snag: Snag }>(`/api/snags/${active.id}/transitions`, { action });
    if (!result.ok) {
      const body = office.refused(result);
      if (body) office.alert(otherIllegal(String(body.from ?? body.error)));
      return;
    }
    await snags.reload();
    office.announce(`Snag ${result.data.snag.number} marked ${STATE_WORD[result.data.snag.state].toLowerCase()}.`);
  };

  const upload = async (kind: "photo" | "render", file: File): Promise<void> => {
    if (!viewpoint) return;
    office.announce(`Uploading ${file.name}…`);
    const form = new FormData();
    form.append("file", file);
    const result: Result<unknown> = kind === "photo"
      ? await call("POST", `/api/viewpoints/${viewpoint.id}/photos`, undefined, { raw: form })
      : await call("PUT", `/api/viewpoints/${viewpoint.id}/render`, undefined, { raw: form });
    if (!result.ok) {
      const body = office.refused(result);
      if (!body) return;
      if (result.status === 503) office.alert(`File storage is unreachable, so ${file.name} wasn't uploaded. Nothing was saved.`);
      else if (result.status === 413) office.alert(tooLarge(file.name, FILE_LIMIT));
      else office.alert(body.errors?.file ?? otherIllegal(body.error));
      return;
    }
    if (kind === "render") setRenderVersion((version) => version + 1);
    await viewpoints.reload();
    office.announce(kind === "photo" ? `${file.name} is now the site photo for ${viewpoint.name}.` : `${file.name} is now the render for ${viewpoint.name}.`);
  };

  const setField = (name: keyof DropValues) => (value: string): void => setDrop((current) => (current ? { ...current, [name]: value } : current));

  return (
    <>
      <PanelTitle section="site-walk" />
      <div className={`panel-body site-walk${editor ? " has-action-bar" : ""}`}>
        <div className="site-walk-controls">
          <div className="field viewpoint-field">
            <label htmlFor={`${formId}-viewpoint`}>Viewpoint</label>
            <select id={`${formId}-viewpoint`} className="input" value={viewpoint?.id ?? ""} onChange={(event) => setChosen(event.target.value)}>
              {list.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.storeCode}</option>)}
            </select>
          </div>
          {viewpoint && (
            <div className="actions">
              {editor && <button type="button" className="button button-primary" onClick={openDrop}>Drop snag here</button>}
              {reduced && (["Render", "Split", "Photo"] as const).map((name) => (
                <button key={name} type="button" className="button" onClick={() => setSeam(name === "Render" ? 100 : name === "Split" ? 50 : 0)}>{name}</button>
              ))}
              {editor && (
                <>
                  <button type="button" className="button" onClick={() => photoInput.current?.click()}>Upload site photo</button>
                  <button type="button" className="button" onClick={() => renderInput.current?.click()}>Upload render</button>
                  <input ref={photoInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload("photo", file);
                  }} />
                  <input ref={renderInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload("render", file);
                  }} />
                </>
              )}
            </div>
          )}
        </div>

        {viewpoints.data && !viewpoint && <p className="empty-line">No viewpoints yet for this project.</p>}
        {viewpoint && (
          <div className="site-walk-grid">
            <div className="seam-column">
              <SeamFrame viewpoint={viewpoint} renderVersion={renderVersion} seam={seam} setSeam={setSeam} snags={snagList}
                activeId={activeId} glide={glide} canMove={editor} onSelect={(snag) => setActiveId(snag.id)} onMove={move} onEnter={editor ? openDrop : undefined} />
              <p className="seam-caption">
                <span>Render · {viewpoint.name}</span>
                <span>Site photo{viewpoint.photoId ? "" : " not yet uploaded"}</span>
              </p>
            </div>
            <aside className="snag-rail" aria-labelledby={`${formId}-snags`}>
              <h3 id={`${formId}-snags`}>Snags</h3>
              {snags.data && snagList.length === 0 && <p className="empty-line">No snags on this viewpoint.</p>}
              <ul className="snag-cards" aria-label="Snags">
                {snagList.map((snag) => {
                  const near = Math.abs(snag.s - seam) <= NEAR;
                  return (
                    <li key={snag.id}>
                      <button type="button" className={`snag-card state-${snag.state}${snag.id === activeId ? " is-active" : ""}`}
                        aria-current={snag.id === activeId ? "true" : undefined} onClick={() => select(snag)}>
                        <span className="snag-card-head"><SnagShape state={snag.state} /><span className="snag-card-number">Snag {snag.number}</span></span>{" "}
                        <span className="snag-card-state">{STATE_WORD[snag.state]}</span>{" "}
                        <span className="snag-card-title">{snag.title}</span>
                        {near && <>{" "}<span className="snag-card-near">Near seam</span></>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {active && (
                <div className="snag-detail">
                  <h4>Snag {active.number}: {active.title}</h4>
                  <p className="snag-meta">Observed {active.observedOn} · {active.s}% across, {active.y}% down</p>
                  {active.note && <p className="snag-note">{active.note}</p>}
                  <div className="actions">
                    {active.actions.includes("fix") && <ActionButton pending="Saving…" onAction={() => transition("fix")}>Mark fixed</ActionButton>}
                    {active.actions.includes("close") && <ActionButton pending="Saving…" onAction={() => transition("close")}>Close snag</ActionButton>}
                    {active.actions.includes("reopen") && <ActionButton pending="Saving…" onAction={() => transition("reopen")}>Reopen snag</ActionButton>}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
      {editor && viewpoint && (
        <StickyBar>
          <button type="button" className="button button-primary" onClick={openDrop}>Drop snag here</button>
        </StickyBar>
      )}
      <Dialog title="Drop snag" open={drop !== null} onCancel={() => setDrop(null)}
        actions={<ActionButton type="submit" primary pending="Pinning snag…" onAction={pin}>Pin snag</ActionButton>}>
        {drop && (
          <>
            <ErrorSummary errors={dropErrors} form={formId} />
            <div className="drop-grid">
              <TextField form={formId} name="s" label="Across" type="number" value={drop.s} onChange={setField("s")} error={dropErrors.s} />
              <TextField form={formId} name="y" label="Height" type="number" value={drop.y} onChange={setField("y")} error={dropErrors.y} />
            </div>
            <TextField form={formId} name="title" label="Snag title" value={drop.title} onChange={setField("title")} error={dropErrors.title} />
            <TextField form={formId} name="note" label="Note" multiline value={drop.note} onChange={setField("note")} error={dropErrors.note} />
            <TextField form={formId} name="observedOn" label="Observed on" type="date" value={drop.observedOn} onChange={setField("observedOn")}
              error={dropErrors.observedOn} />
          </>
        )}
      </Dialog>
    </>
  );
}

interface SeamFrameProps {
  viewpoint: Viewpoint;
  renderVersion: number;
  seam: number;
  setSeam: (s: number) => void;
  snags: Snag[];
  activeId: string | null;
  glide: { from: number; token: number } | null;
  canMove: boolean;
  onSelect: (snag: Snag) => void;
  onMove: (snag: Snag, s: number, y: number) => Promise<boolean>;
  onEnter?: () => void;
}

interface Gesture {
  pointer: number;
  kind: "seam" | "pending";
  x: number;
  y: number;
}

interface MarkerDrag {
  pointer: number;
  id: string;
  x: number;
  y: number;
  s: number;
  sy: number;
  moved: boolean;
}

function SeamFrame({ viewpoint, renderVersion, seam, setSeam, snags, activeId, glide, canMove, onSelect, onMove, onEnter }: SeamFrameProps) {
  const frame = useRef<HTMLDivElement>(null);
  const render = useRef<HTMLImageElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(16 / 10);
  const gesture = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState<MarkerDrag | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Once a touch drag holds the seam, the page doesn't scroll (or fling) under the finger. The pointermove
  // that starts the drag runs before its touchmove, so that first touchmove is already cancelled.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const hold = (event: TouchEvent): void => {
      if (gesture.current?.kind === "seam" && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchmove", hold, { passive: false });
    return () => element.removeEventListener("touchmove", hold);
  }, []);

  const boundary = (s: number): number => Math.round((s * width) / 100);
  const clip = (s: number): string => (width ? `inset(0 ${width - boundary(s)}px 0 0)` : `inset(0 ${100 - s}% 0 0)`);
  const offset = (s: number): string => (width ? `translateX(${boundary(s)}px)` : `translateX(${s}%)`);

  // Selecting a snag card glides the seam: the values switched at once, the picture follows over 0.42 s.
  useLayoutEffect(() => {
    if (!glide) return;
    animate(render.current, [{ clipPath: clip(glide.from) }, { clipPath: clip(seam) }], "--t-mid");
    animate(line.current, [{ transform: offset(glide.from) }, { transform: offset(seam) }], "--t-mid");
    // Only a new glide token animates; seam changes from a drag or a key follow at once.
  }, [glide?.token]);

  const sAt = (clientX: number): number => {
    const box = frame.current?.getBoundingClientRect();
    return box && box.width ? clamp(((clientX - box.left) / box.width) * 100) : seam;
  };
  const yAt = (clientY: number): number => {
    const box = frame.current?.getBoundingClientRect();
    return box && box.height ? clamp(((clientY - box.top) / box.height) * 100) : 50;
  };

  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest(".snag-marker")) return;
    if (event.pointerType === "touch") {
      gesture.current = { pointer: event.pointerId, kind: "pending", x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    frame.current?.setPointerCapture(event.pointerId);
    gesture.current = { pointer: event.pointerId, kind: "seam", x: event.clientX, y: event.clientY };
    handle.current?.focus({ preventScroll: true });
    setSeam(sAt(event.clientX));
  };

  const moveTo = (event: PointerEvent<HTMLDivElement>): void => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.kind === "pending") {
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (Math.hypot(dx, dy) < TOUCH_SLOP) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        gesture.current = null;
        return;
      }
      current.kind = "seam";
    }
    setSeam(sAt(event.clientX));
  };

  const end = (event: PointerEvent<HTMLDivElement>): void => {
    if (gesture.current?.pointer === event.pointerId) gesture.current = null;
  };

  const key = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 10 : 1;
    const next: Record<string, number> = {
      ArrowLeft: seam - step, ArrowDown: seam - step, ArrowRight: seam + step, ArrowUp: seam + step, Home: 0, End: 100,
    };
    if (event.key in next) {
      event.preventDefault();
      setSeam(clamp(next[event.key]));
    } else if (event.key === "Enter" && onEnter) {
      event.preventDefault();
      onEnter();
    }
  };

  const markerDown = (event: PointerEvent<HTMLButtonElement>, snag: Snag): void => {
    if (!canMove || (event.pointerType !== "touch" && event.button !== 0)) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({ pointer: event.pointerId, id: snag.id, x: event.clientX, y: event.clientY, s: snag.s, sy: snag.y, moved: false });
  };
  const markerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!dragging || dragging.pointer !== event.pointerId) return;
    const moved = dragging.moved || Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) > 4;
    setDragging({ ...dragging, moved, s: moved ? sAt(event.clientX) : dragging.s, sy: moved ? yAt(event.clientY) : dragging.sy });
  };
  const markerUp = async (event: PointerEvent<HTMLButtonElement>, snag: Snag): Promise<void> => {
    if (!dragging || dragging.pointer !== event.pointerId) return;
    const drag = dragging;
    if (!drag.moved) {
      setDragging(null);
      return;
    }
    suppressClick.current = true;
    await onMove(snag, drag.s, drag.sy);
    flushSync(() => setDragging(null));
  };

  const renderUrl = viewpoint.hasRender ? `/api/viewpoints/${viewpoint.id}/render?v=${renderVersion}` : null;
  const photoUrl = viewpoint.photoId ? `/api/viewpoints/${viewpoint.id}/photo?v=${viewpoint.photoId}` : null;

  return (
    <div className="seam-wrap">
      <div ref={frame} className="seam-frame" role="group" aria-label="Intent seam" data-seam={seam} data-active-snag-id={activeId ?? ""}
        style={{ aspectRatio: String(ratio) }} onPointerDown={down} onPointerMove={moveTo} onPointerUp={end} onPointerCancel={end}>
        <div className="seam-picture">
          {photoUrl ? <img className="seam-photo" src={photoUrl} alt="" draggable={false} />
            : <div className="seam-photo seam-missing"><span>No site photo yet</span></div>}
          {renderUrl ? (
            <img ref={render} className="seam-render" src={renderUrl} alt="" draggable={false} style={{ clipPath: clip(seam) }}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight);
              }} />
          ) : <div className="seam-render seam-missing seam-missing-render" style={{ clipPath: clip(seam) }}><span>No render yet</span></div>}
        </div>
        <div ref={line} className="seam-line" style={{ transform: offset(seam) }}>
          <div ref={handle} className="seam-handle" role="slider" tabIndex={0} aria-valuemin={0} aria-valuemax={100} aria-valuenow={seam}
            aria-valuetext={`Render ${seam}%, photo ${100 - seam}%`} aria-orientation="horizontal" aria-labelledby={`${viewpoint.id}-seam-label`}
            onKeyDown={key}>
            <span id={`${viewpoint.id}-seam-label`}>Seam</span>
          </div>
        </div>
        {snags.map((snag) => {
          const drag = dragging?.id === snag.id ? dragging : null;
          const s = drag ? drag.s : snag.s;
          const y = drag ? drag.sy : snag.y;
          return (
            <button key={snag.id} id={markerId(snag)} type="button"
              className={`snag-marker state-${snag.state}${snag.id === activeId ? " is-active" : ""}${drag?.moved ? " is-dragging" : ""}`}
              style={{ left: `${s}%`, top: `${y}%` }} data-snag-id={snag.id} data-state={snag.state}
              data-near={String(Math.abs(snag.s - seam) <= NEAR)}
              onPointerDown={(event) => markerDown(event, snag)} onPointerMove={markerMove}
              onPointerUp={(event) => void markerUp(event, snag)} onPointerCancel={() => setDragging(null)}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onSelect(snag);
              }}>
              <SnagShape state={snag.state} /><span className="snag-marker-number">Snag {snag.number}</span>{" "}
              <span className="snag-marker-state">{STATE_WORD[snag.state]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
