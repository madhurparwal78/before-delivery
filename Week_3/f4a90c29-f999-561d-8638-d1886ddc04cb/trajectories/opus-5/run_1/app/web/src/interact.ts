// Pointer moves and resizes, the quick dialog, and the keyboard moves of a
// focused event.

import { ApiError, api, type EventRecord } from "./api";
import { ThreeClocks, clocksFor, insideHours, threeClockLine } from "./clocks";
import { el, on, reducedMotion } from "./dom";
import { openDialog, scopeDialog } from "./dialogs";
import { SLOT_HEIGHT } from "./gridview";
import { blockName } from "./gridview";
import { occurrenceID } from "./layout";
import { announce, state, viewerZone } from "./state";
import { cityOf, inZone, instantOf, parseLocal, wallClock, wallLocal, readableDate } from "./time";
import { offerUndo, restoreTimes } from "./undo";

/** localOffset is the gap an occurrence shows between its clock time and its
 *  instant, which a recorded zone rule can change. */
export function localOffset(occurrence: EventRecord): number {
  if (!occurrence.start_utc) return 0;
  const wall = parseLocal(occurrence.start_local);
  return Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min) - Date.parse(occurrence.start_utc);
}

export function eventLocal(occurrence: EventRecord, instant: number): string {
  const offset = localOffset(occurrence);
  const shifted = new Date(instant + offset);
  return `${shifted.toISOString().slice(0, 16)}`;
}

export type MoveResult = { startLocal: string; endLocal: string };

export type DragContext = {
  occurrence: EventRecord;
  block: HTMLElement;
  edge: "move" | "top" | "bottom";
  columnWidth: () => number;
  onSaved: (record: EventRecord, scope: string | null) => void;
  reopen: () => void;
};

/** startDrag opens Three clocks beside a block and saves on release. */
export function startDrag(event: PointerEvent, context: DragContext): void {
  const { occurrence, block, edge } = context;
  if (!occurrence.start_utc || !occurrence.end_utc) return;
  event.preventDefault();
  const clocks = new ThreeClocks();
  clocks.placeBeside(block);
  const startInstant = Date.parse(occurrence.start_utc);
  const endInstant = Date.parse(occurrence.end_utc);
  const startX = event.clientX;
  const startY = event.clientY;
  let minuteDelta = 0;
  let dayDelta = 0;
  let cancelled = false;

  const show = () => {
    const edgeInstant = movingEdgeInstant();
    clocks.set(
      clocksFor(edgeInstant).map((clock) => ({
        ...clock,
        inside_hours: insideHours(zoneOfCity(clock.city), edgeInstant, edge === "bottom"),
      })),
    );
  };

  function movingEdgeInstant(): number {
    if (edge === "bottom") return endInstant + minuteDelta * 60000 + dayDelta * 86400000;
    return startInstant + minuteDelta * 60000 + dayDelta * 86400000;
  }

  show();

  const move = (pointer: PointerEvent) => {
    const dy = pointer.clientY - startY;
    minuteDelta = Math.round(dy / SLOT_HEIGHT) * 15;
    if (edge === "move") {
      const width = context.columnWidth();
      dayDelta = width > 1 ? Math.round((pointer.clientX - startX) / width) : 0;
    } else {
      dayDelta = 0;
      const span = (edge === "bottom" ? endInstant : startInstant) + minuteDelta * 60000;
      const other = edge === "bottom" ? startInstant : endInstant;
      if (edge === "bottom" && span - other < 15 * 60000) minuteDelta = (other + 15 * 60000 - endInstant) / 60000;
      if (edge === "top" && other - span < 15 * 60000) minuteDelta = (other - 15 * 60000 - startInstant) / 60000;
    }
    paint();
    show();
  };

  function paint(): void {
    const shift = (minuteDelta / 15) * SLOT_HEIGHT;
    if (edge === "move") {
      block.style.transform = `translateY(${shift}px)`;
    } else if (edge === "bottom") {
      const height = parseFloat(block.style.height || "0");
      block.style.height = `${Math.max(SLOT_HEIGHT, height)}px`;
      block.style.setProperty("--resize", `${shift}px`);
      block.classList.add("resizing-bottom");
    } else {
      block.style.setProperty("--resize", `${shift}px`);
      block.classList.add("resizing-top");
    }
  }

  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("keydown", keyWatch, true);
    block.style.transform = "";
    block.classList.remove("resizing-bottom", "resizing-top");
    block.style.removeProperty("--resize");
  };

  const keyWatch = (pointer: KeyboardEvent) => {
    if (pointer.key !== "Escape") return;
    pointer.preventDefault();
    cancelled = true;
    clocks.remove();
    stop();
  };

  const release = () => {
    stop();
    if (cancelled) return;
    if (minuteDelta === 0 && dayDelta === 0) {
      clocks.remove();
      return;
    }
    // A drag that moved the block answers for itself, so the click that
    // follows does not also open the quick dialog.
    block.dataset.dragged = "1";
    const shiftMs = minuteDelta * 60000 + dayDelta * 86400000;
    const newStart = edge === "bottom" ? startInstant : startInstant + shiftMs;
    const newEnd = edge === "top" ? endInstant : endInstant + shiftMs;
    const times: MoveResult = {
      startLocal: eventLocal(occurrence, edge === "bottom" ? startInstant : newStart),
      endLocal: eventLocal(occurrence, edge === "top" ? endInstant : newEnd),
    };
    void saveTimes(occurrence, times, edge, clocks, context);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", release);
  window.addEventListener("keydown", keyWatch, true);
}

function zoneOfCity(city: string): string {
  if (city === "New York") return "America/New_York";
  if (city === "Auckland") return "Pacific/Auckland";
  return "Europe/London";
}

async function saveTimes(
  occurrence: EventRecord,
  times: MoveResult,
  edge: "move" | "top" | "bottom",
  clocks: ThreeClocks | null,
  context: DragContext,
): Promise<void> {
  const eventID = occurrence.event_id ?? occurrence.id!;
  const scope = occurrence.rrule
    ? await new Promise<string | null>((resolve) => {
        scopeDialog("Edit repeating event", context.block, (chosen) => resolve(chosen), () => resolve(null));
      })
    : null;
  if (occurrence.rrule && scope === null) {
    clocks?.remove();
    context.reopen();
    return;
  }
  announce(`Saving ${occurrence.title}...`);
  const body: Record<string, unknown> = { start_local: times.startLocal, end_local: times.endLocal };
  if (scope) {
    body.scope = scope;
    body.occurrence_id = occurrenceID(occurrence);
  }
  const wasStart = occurrence.start_local;
  const wasEnd = occurrence.end_local;
  const version = occurrence.version ?? 1;
  try {
    const result = await api.patchEvent(eventID, version, body);
    const city = state.me?.city ?? cityOf(viewerZone());
    const record = result.event;
    const shownStart = record.start_utc ? wallClock(inZone(Date.parse(record.start_utc), viewerZone())) : "";
    const shownEnd = record.end_utc ? wallClock(inZone(Date.parse(record.end_utc), viewerZone())) : "";
    announce(
      edge === "move"
        ? `Moved ${record.title} to ${shownStart} ${city}.`
        : `Resized ${record.title} to end at ${shownEnd} ${city}.`,
    );
    if (scope !== "following") {
      offerUndo({
        title: record.title,
        run: restoreTimes(eventID, record.version ?? version + 1, wasStart, wasEnd, scope, occurrenceID(occurrence)),
      });
    }
    context.onSaved(record, scope);
  } catch (error) {
    clocks?.remove();
    if (error instanceof ApiError && error.status === 412 && error.current) {
      openConflictDialog(error, context.block, async () => {
        const fresh = await api.event(eventID, occurrenceID(occurrence));
        const retry: Record<string, unknown> = { ...body };
        const result = await api.patchEvent(eventID, fresh.version ?? 1, retry);
        announce(`Saved ${result.event.title}.`);
        context.onSaved(result.event, scope);
      });
      return;
    }
    if (error instanceof ApiError) announce(error.message);
    context.reopen();
  }
}

/** openConflictDialog shows the winner's values and the two published
 *  choices. */
export function openConflictDialog(error: ApiError, opener: HTMLElement | null, reapply: () => Promise<void>): void {
  const winner = error.current;
  openDialog({ title: "This event changed", opener }, (body, dialog) => {
    const list = el("ul", { role: "list", "aria-label": "Winning values", class: "winning" });
    if (winner) {
      list.append(el("li", { text: `Title: ${winner.title}` }));
      list.append(el("li", { text: `Starts: ${winner.start_local}` }));
      list.append(el("li", { text: `Ends: ${winner.end_local}` }));
      if (winner.location) list.append(el("li", { text: `Location: ${winner.location}` }));
    }
    const again = el("button", { type: "button", class: "primary", text: "Reapply my changes" });
    const keep = el("button", { type: "button", text: "Keep theirs" });
    on(again, "click", async () => {
      dialog.close(false);
      try {
        await reapply();
      } catch (retryError) {
        if (retryError instanceof ApiError) announce(retryError.message);
      }
    });
    on(keep, "click", () => {
      dialog.close(false);
      announce(`Kept the saved values for ${winner?.title ?? "this event"}.`);
    });
    body.append(
      el("h2", { text: "This event changed" }),
      el("p", { text: error.message.replace(".", ". Their values are shown here.") }),
      list,
      el("div", { class: "row buttons" }, [again, keep]),
    );
  });
}

export type QuickDialogOptions = {
  occurrence: EventRecord;
  opener: HTMLElement | null;
  clocks?: ThreeClocks | null;
  onOpenPage: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
};

/** openQuickDialog shows dialog "<title>" with the Three clocks title row. */
export function openQuickDialog(options: QuickDialogOptions): void {
  const occurrence = options.occurrence;
  const canEdit =
    occurrence.access === "full" || (occurrence.access === "guest" && occurrence.switches?.modify_event === true);
  openDialog(
    { title: occurrence.title, opener: options.opener, className: "quick", onClose: () => options.onClose() },
    (body, dialog) => {
      const clocks = options.clocks ?? new ThreeClocks();
      if (!occurrence.all_day && occurrence.start_utc) {
        clocks.set(
          (occurrence.clocks.length ? occurrence.clocks : clocksFor(Date.parse(occurrence.start_utc))).map((clock) => ({ ...clock })),
        );
      }
      const titleRow = el("div", { class: "dialog-title-row" }, [el("h2", { text: occurrence.title })]);
      if (!occurrence.all_day) titleRow.append(clocks.node);
      body.append(titleRow);

      if (occurrence.adjusted) {
        body.append(
          el("p", {
            text: `This occurrence starts at ${occurrence.start_local.slice(11)} because ${
              occurrence.start_local.slice(11)
            } does not exist on ${readableDate(occurrence.start_local.slice(0, 10))}.`,
          }),
        );
      }
      const warning = occurrence.zone_warnings?.[0];
      if (warning && (occurrence.access === "full" || occurrence.access === "guest")) {
        body.append(
          el("div", { role: "region", "aria-label": "Zone rule warning", class: "warning" }, [
            el("p", { text: zoneWarningText(warning) }),
          ]),
        );
      }

      const open = el("button", { type: "button", text: "Open event" });
      on(open, "click", () => {
        dialog.close(false);
        options.onOpenPage();
      });
      const row = el("div", { class: "row buttons" }, [open]);
      if (canEdit) {
        const edit = el("button", { type: "button", text: "Edit" });
        on(edit, "click", () => {
          dialog.close(false);
          options.onEdit();
        });
        row.append(edit);
      }
      if (occurrence.access !== "busy" && occurrence.calendar_id !== "cal-holidays") {
        const duplicate = el("button", { type: "button", text: "Duplicate" });
        on(duplicate, "click", () => {
          dialog.close(false);
          options.onDuplicate();
        });
        row.append(duplicate);
      }
      if (occurrence.access === "full") {
        const remove = el("button", { type: "button", text: "Delete" });
        on(remove, "click", () => {
          dialog.close(false);
          options.onDelete();
        });
        row.append(remove);
      }
      body.append(row);
      if (reducedMotion() && !occurrence.all_day) announce(threeClockLine(clocks.values()));
    },
  );
}

export function zoneWarningText(warning: {
  city: string;
  effective_date: string;
  note: string;
  saved_time: string;
  shown_time: string;
}): string {
  return `A zone rule for ${warning.city} took effect on ${readableDate(warning.effective_date)}: ${warning.note} ${
    warning.saved_time
  } now shows as ${warning.shown_time}.`;
}

/** keyboardMove moves or resizes a focused event by Alt with arrow keys. */
export async function keyboardMove(
  occurrence: EventRecord,
  block: HTMLElement,
  minutes: number,
  days: number,
  resize: boolean,
  scope: string | null,
  onSaved: (record: EventRecord, scope: string | null) => void,
): Promise<void> {
  if (!occurrence.start_utc || !occurrence.end_utc) return;
  const startInstant = Date.parse(occurrence.start_utc);
  const endInstant = Date.parse(occurrence.end_utc);
  const shift = minutes * 60000 + days * 86400000;
  let newStart = startInstant;
  let newEnd = endInstant;
  if (resize) {
    newEnd = endInstant + shift;
    if (newEnd - startInstant < 15 * 60000) {
      announce("Events are at least 15 minutes long.");
      return;
    }
  } else {
    newStart = startInstant + shift;
    newEnd = endInstant + shift;
  }
  const times = { startLocal: eventLocal(occurrence, newStart), endLocal: eventLocal(occurrence, newEnd) };
  const eventID = occurrence.event_id ?? occurrence.id!;
  const body: Record<string, unknown> = { start_local: times.startLocal, end_local: times.endLocal };
  if (scope) {
    body.scope = scope;
    body.occurrence_id = occurrenceID(occurrence);
  }
  announce(`Saving ${occurrence.title}...`);
  try {
    const result = await api.patchEvent(eventID, occurrence.version ?? 1, body);
    const city = state.me?.city ?? cityOf(viewerZone());
    const record = result.event;
    const shownStart = record.start_utc ? wallClock(inZone(Date.parse(record.start_utc), viewerZone())) : "";
    const shownEnd = record.end_utc ? wallClock(inZone(Date.parse(record.end_utc), viewerZone())) : "";
    announce(resize ? `Resized ${record.title} to end at ${shownEnd} ${city}.` : `Moved ${record.title} to ${shownStart} ${city}.`);
    if (reducedMotion() && record.start_utc) {
      announce(threeClockLine(clocksFor(Date.parse(record.start_utc))));
    }
    onSaved(record, scope);
  } catch (error) {
    if (error instanceof ApiError && error.status === 412 && error.current) {
      openConflictDialog(error, block, async () => {
        const fresh = await api.event(eventID, occurrenceID(occurrence));
        const result = await api.patchEvent(eventID, fresh.version ?? 1, body);
        onSaved(result.event, scope);
      });
      return;
    }
    if (error instanceof ApiError) announce(error.message);
  }
}

export { blockName, instantOf, wallLocal };
