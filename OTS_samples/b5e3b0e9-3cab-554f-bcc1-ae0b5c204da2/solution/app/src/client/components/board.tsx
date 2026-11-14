import { Fragment } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, ApiFailure } from "../api.ts";
import { EASE, MOVE_MS, OUTLINE_MS, PULSE_MS, mark } from "../markers.ts";
import { GROUND_BAYS, TOWER_BAYS, type Bay, type Position, type StripRow } from "../../shared/wire.ts";
import { Dialog } from "./dialog.tsx";
import { FormFeedback, TextField, useForm } from "./forms.tsx";
import { useRoom, type Room } from "./room.tsx";

const stripLabel = (strip: StripRow): string => {
  const where = strip.kind === "dep" ? `stand ${strip.stand ?? ""}` : `runway ${strip.runway ?? ""}`;
  const point = strip.holdingPoint ? `holding point ${strip.holdingPoint}` : "no holding point";
  const label = `${strip.callsign}, ${strip.kind === "dep" ? "DEP" : "ARR"}, ${strip.type}, wake ${strip.wake}, ${strip.rules}, ${where}, ${point}, cleared ${strip.cleared ?? "none"}`;
  return strip.state === "transferred" ? `${label}, transferred to Tower` : label;
};

/** Sends a strip move; a conflict shows the notice and reads the strip again as the server has it. */
async function requestMove(room: Room, strip: StripRow, to: string): Promise<void> {
  room.setPending(strip.callsign, true);
  try {
    await api("POST", `/api/sessions/${room.id}/strips/${strip.callsign}/move`, { to, version: strip.version });
    room.setCommandError("");
    room.requestFocus(strip.callsign, strip.version);
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    if (error.error === "version_conflict") {
      room.setStripNotice(error.message);
      await room.refetch();
    } else room.setCommandError(error.message);
  } finally {
    room.setPending(strip.callsign, false);
  }
}

/** Ctrl+Right, a drop on the next bay, or Accept: the strip's forward move. */
function moveForward(room: Room, strip: StripRow): void {
  if (strip.state === "transferred") return room.setCommandError(`${strip.callsign} is not on your frequency.`);
  const forward = strip.forward;
  if (forward && forward.line !== null) return room.commandApi.current?.prefill(forward.line, strip.callsign);
  void requestMove(room, strip, forward ? forward.to : strip.bay);
}

/** Ctrl+Left, or Recall: the strip's backward move. */
function moveBack(room: Room, strip: StripRow): void {
  if (strip.state === "transferred") return room.setCommandError(`${strip.callsign} is not on your frequency.`);
  void requestMove(room, strip, strip.back ?? strip.bay);
}

function dropOn(room: Room, strip: StripRow, bay: string): void {
  if (bay === strip.bay) return;
  if (strip.forward && bay === strip.forward.to) return moveForward(room, strip);
  if (strip.back && bay === strip.back) return moveBack(room, strip);
  void requestMove(room, strip, bay);
}

interface StripProps {
  strip: StripRow;
  interactive: boolean;
  roving: boolean;
  onEdit: (strip: StripRow) => void;
}

function Strip({ strip, interactive, roving, onEdit }: StripProps) {
  const room = useRoom();
  const pending = room.pending.has(strip.callsign);
  const preview = room.preview.callsign === strip.callsign;
  const dragged = useRef(false);

  const onPointerDown = (event: PointerEvent): void => {
    if (!interactive || strip.state === "transferred" || (event.pointerType === "mouse" && event.button !== 0)) return;
    const element = event.currentTarget as HTMLElement;
    const start = { x: event.clientX, y: event.clientY };
    let active = false;
    const move = (e: PointerEvent): void => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!active && Math.hypot(dx, dy) > 5) {
        active = true;
        dragged.current = true;
        element.classList.add("dragging");
      }
      if (active) element.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!active) return;
      element.classList.remove("dragging");
      element.style.transform = "";
      const target = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.closest("[data-bay-list]"));
      const bay = target?.closest<HTMLElement>("[data-bay-list]")?.dataset.bayList;
      if (e.type === "pointerup" && bay) dropOn(room, strip, bay);
      window.setTimeout(() => {
        dragged.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <li
      class="strip"
      tabIndex={roving ? 0 : -1}
      aria-label={stripLabel(strip)}
      aria-disabled={strip.state === "transferred" ? "true" : undefined}
      data-strip={strip.callsign}
      data-bay={strip.bay}
      data-frequency={strip.frequency}
      data-state={strip.state}
      data-version={strip.version}
      data-kind={strip.kind}
      data-pending={pending ? "true" : undefined}
      data-preview={preview ? "true" : undefined}
      data-emergency={strip.emergency ? "true" : undefined}
      data-selected={room.selected === strip.callsign ? "true" : undefined}
      data-new-offer={strip.state === "offered" && strip.bay === "Incoming" ? "true" : undefined}
      onFocus={() => room.select(strip.callsign)}
      onPointerDown={onPointerDown}
      onDblClick={() => interactive && strip.state !== "transferred" && onEdit(strip)}
      onClickCapture={(event) => {
        if (dragged.current) event.stopPropagation();
      }}
    >
      <div class="strip-head">
        <strong class="callsign">{strip.callsign}</strong>
        <span class="badge badge-kind">{strip.kind === "dep" ? "DEP" : "ARR"}</span>
        {strip.goAround && <span class="badge badge-go">GO AROUND</span>}
        {strip.emergency && <span class="band">EMERGENCY</span>}
      </div>
      <div class="strip-line">
        {strip.type} · wake {strip.wake} · {strip.rules}
      </div>
      <div class="strip-line">
        {strip.kind === "dep" ? `Stand ${strip.stand ?? ""}` : `Runway ${strip.runway ?? ""}`}
        {strip.holdingPoint ? ` · HP ${strip.holdingPoint}` : ""}
      </div>
      {strip.cleared && <div class="strip-cleared">{strip.cleared}</div>}
      {strip.remarks && <div class="strip-remarks">{strip.remarks}</div>}
      {strip.timers.length > 0 && (
        <div class="strip-timers">
          {strip.timers.map((timer) => (
            <span key={timer.kind} class="timer" data-timer={timer.kind} data-near={timer.near ? "true" : undefined} aria-live="off">
              {timer.text}
            </span>
          ))}
        </div>
      )}
      {interactive && strip.bay === "Incoming" && strip.state === "offered" && (
        <button type="button" tabIndex={-1} class="strip-action" onClick={() => moveForward(room, strip)}>
          Accept {strip.callsign}
        </button>
      )}
      {interactive && strip.back !== null && (
        <button type="button" tabIndex={-1} class="strip-action" onClick={() => moveBack(room, strip)}>
          Recall {strip.callsign}
        </button>
      )}
    </li>
  );
}

function EditDialog({ strip: stripView, onClose }: { strip: StripRow; onClose: () => void }) {
  const room = useRoom();
  const form = useForm();
  const [holdingPoint, setHoldingPoint] = useState(stripView.holdingPoint ?? "");
  const [remarks, setRemarks] = useState(stripView.remarks);
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Saving...");
    const latest = room.payload.strips.find((s) => s.callsign === stripView.callsign && s.board === stripView.board) ?? stripView;
    try {
      await api("PATCH", `/api/sessions/${room.id}/strips/${stripView.callsign}`, { holdingPoint, remarks, version: latest.version });
      onClose();
    } catch (error) {
      if (error instanceof ApiFailure && error.error === "version_conflict") {
        room.setStripNotice(error.message);
        form.reset();
        await room.refetch();
      } else form.fail(error);
    }
  };
  return (
    <Dialog label={`Edit ${stripView.callsign}`} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <TextField name="holdingPoint" label="Holding point" value={holdingPoint} onInput={setHoldingPoint} />
        <TextField name="remarks" label="Remarks" value={remarks} onInput={setRemarks} />
        <div class="actions">
          <button type="submit">Save strip</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
        <FormFeedback form={form} alertName="Strip error" />
      </form>
    </Dialog>
  );
}

const bayIndexOf = (list: HTMLElement): number => Number(list.dataset.bayIndex ?? 0);

/** Arrow keys inside a board: within a bay, and to the same place in the next bay that holds strips. */
function arrow(region: HTMLElement, from: HTMLElement, key: string): void {
  const lists = [...region.querySelectorAll<HTMLElement>("[data-bay-list]")].sort((a, b) => bayIndexOf(a) - bayIndexOf(b));
  const list = from.closest<HTMLElement>("[data-bay-list]");
  if (!list) return;
  const strips = [...list.querySelectorAll<HTMLElement>("[data-strip]")];
  const index = strips.indexOf(from);
  if (key === "ArrowUp" || key === "ArrowDown") {
    strips[key === "ArrowUp" ? index - 1 : index + 1]?.focus();
    return;
  }
  const step = key === "ArrowLeft" ? -1 : 1;
  for (let i = lists.indexOf(list) + step; i >= 0 && i < lists.length; i += step) {
    const candidates = [...(lists[i]?.querySelectorAll<HTMLElement>("[data-strip]") ?? [])];
    const target = candidates[Math.min(index, candidates.length - 1)];
    if (target) {
      target.focus();
      return;
    }
  }
}

interface BoardProps {
  board: Position;
  strips: StripRow[];
}

/** A board: one tab stop, its bays as columns, strips as bars. */
export function Board({ board, strips }: BoardProps) {
  const room = useRoom();
  const bays: readonly Bay[] = board === "GND" ? GROUND_BAYS : TOWER_BAYS;
  const interactive = room.position === board;
  const region = useRef<HTMLElement>(null);
  const [roving, setRoving] = useState<string | null>(null);
  const [editing, setEditing] = useState<StripRow | null>(null);
  const seen = useRef<Map<string, { bay: string; rect: DOMRect }> | null>(null);

  const first = bays.map((bay) => strips.find((strip) => strip.bay === bay)).find((strip) => strip !== undefined);
  const stop = strips.some((strip) => strip.callsign === roving) ? roving : (first?.callsign ?? null);

  useLayoutEffect(() => {
    const element = region.current;
    if (!element) return;
    const next = new Map<string, { bay: string; rect: DOMRect }>();
    for (const li of element.querySelectorAll<HTMLElement>("[data-strip]")) {
      const key = li.dataset.strip ?? "";
      const bay = li.dataset.bay ?? "";
      const rect = li.getBoundingClientRect();
      next.set(key, { bay, rect });
      const before = seen.current?.get(key);
      const arrived = seen.current !== null && before?.bay !== bay;
      if (!arrived) continue;
      const offer = li.dataset.newOffer === "true";
      if (room.reduced) {
        if (offer) mark(li, "data-outline", "static", OUTLINE_MS);
      } else if (before) {
        mark(li, "data-motion", "move", MOVE_MS);
        li.animate(
          [{ transform: `translate(${before.rect.left - rect.left}px, ${before.rect.top - rect.top}px)` }, { transform: "none" }],
          { duration: MOVE_MS, easing: EASE },
        );
      } else if (offer) {
        mark(li, "data-motion", "pulse", PULSE_MS);
        li.animate([{ outlineOffset: "0px" }, { outlineOffset: "6px" }, { outlineOffset: "0px" }], { duration: PULSE_MS / 3, iterations: 3, easing: "ease-in-out" });
      } else {
        li.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: MOVE_MS, easing: EASE });
      }
    }
    seen.current = next;
  });

  useLayoutEffect(() => {
    const request = room.focusRequest;
    if (!request || !region.current) return;
    const stripView = strips.find((strip) => strip.callsign === request.callsign);
    if (!stripView || stripView.version <= request.afterVersion) return;
    region.current.querySelector<HTMLElement>(`[data-strip="${request.callsign}"]`)?.focus();
    room.clearFocusRequest();
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    const element = region.current;
    const target = event.target as HTMLElement;
    if (!element) return;
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      room.commandApi.current?.focus();
      return;
    }
    const li = target.closest<HTMLElement>("[data-strip]");
    const shownStrip = li ? strips.find((stripView) => stripView.callsign === li.dataset.strip) : undefined;
    if (!li || !shownStrip) return;
    if (event.key.startsWith("Arrow") && !event.ctrlKey) {
      event.preventDefault();
      arrow(element, li, event.key);
    } else if (interactive && event.ctrlKey && event.key === "ArrowRight") {
      event.preventDefault();
      moveForward(room, shownStrip);
    } else if (interactive && event.ctrlKey && event.key === "ArrowLeft") {
      event.preventDefault();
      moveBack(room, shownStrip);
    } else if (interactive && event.key === "Enter" && target === li) {
      event.preventDefault();
      if (shownStrip.state === "transferred") room.setCommandError(`${shownStrip.callsign} is not on your frequency.`);
      else setEditing(shownStrip);
    }
  };

  return (
    <Fragment>
      <section
        ref={region}
        class="board-region"
        role="region"
        aria-label={board === "GND" ? "Ground board" : "Tower board"}
        data-board={board}
        onKeyDown={onKeyDown}
        onFocusIn={(event) => {
          const callsign = (event.target as HTMLElement).closest<HTMLElement>("[data-strip]")?.dataset.strip;
          if (callsign) setRoving(callsign);
        }}
      >
        <div class="bays" style={{ "--bay-count": bays.length }}>
          {bays.map((bay, index) => {
            const inBay = strips.filter((strip) => strip.bay === bay);
            return (
              <div class="bay" key={bay}>
                <h3 class="bay-name">{bay}</h3>
                <div class="bay-body">
                  <ul class="bay-list" aria-label={bay} data-bay-list={bay} data-bay-index={index}>
                    {inBay.map((stripView) => (
                      <Strip key={stripView.callsign} strip={stripView} interactive={interactive} roving={stripView.callsign === stop} onEdit={setEditing} />
                    ))}
                  </ul>
                  {inBay.length === 0 && <p class="bay-empty">No strips here.</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {editing && <EditDialog strip={editing} onClose={() => setEditing(null)} />}
    </Fragment>
  );
}
