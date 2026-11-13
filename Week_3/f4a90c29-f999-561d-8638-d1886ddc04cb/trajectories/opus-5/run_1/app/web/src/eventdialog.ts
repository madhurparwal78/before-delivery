// The New event and Edit event dialogs, their repeat controls, and the one
// server-kept draft of an unsaved new event.

import { ApiError, api, type EventRecord } from "./api";
import { el, on, clear } from "./dom";
import { dialogNamed, openDialog, scopeDialog, type Dialog } from "./dialogs";
import { announce, canEditCalendar, editableCalendars } from "./state";
import { ThreeClocks, clocksFor } from "./clocks";
import { daysInMonth, instantOf, parseLocal, weekdayName, zoneOfCity } from "./time";

export type EventDraft = {
  calendar_id: string;
  title: string;
  kind: string;
  colour: string;
  all_day: boolean;
  start_local: string;
  end_local: string;
  zone: string;
  location: string;
  notes: string;
  visibility: string;
  reminders: string;
  rrule: string;
  decline_mode: string;
  decline_message: string;
  guest_ids: string[];
};

const KINDS: [string, string][] = [
  ["event", "Event"],
  ["focus_time", "Focus time"],
  ["out_of_office", "Out of office"],
];

const COLOURS = ["Calendar colour", "Rose", "Amber", "Teal", "Indigo"];

export function emptyDraft(startLocal: string, endLocal: string, zone: string, calendarID: string): EventDraft {
  return {
    calendar_id: calendarID,
    title: "",
    kind: "event",
    colour: "Calendar colour",
    all_day: false,
    start_local: startLocal,
    end_local: endLocal,
    zone,
    location: "",
    notes: "",
    visibility: "default",
    reminders: "",
    rrule: "",
    decline_mode: "new_and_existing",
    decline_message: "",
    guest_ids: [],
  };
}

export function draftFromEvent(record: EventRecord): EventDraft {
  return {
    calendar_id: record.calendar_id,
    title: record.title,
    kind: record.kind ?? "event",
    colour: record.colour ?? "Calendar colour",
    all_day: record.all_day,
    start_local: record.start_local,
    end_local: record.end_local,
    zone: record.zone,
    location: record.location ?? "",
    notes: record.notes ?? "",
    visibility: record.visibility ?? "default",
    reminders: (record.reminders ?? []).join(","),
    rrule: record.rrule ?? "",
    decline_mode: record.decline_mode ?? "new_and_existing",
    decline_message: record.decline_message ?? "",
    guest_ids: [],
  };
}

type Fields = {
  dialog: Dialog;
  draft: EventDraft;
  errors: Record<string, string>;
  setError: (name: string, message: string) => void;
};

export type EventDialogOptions = {
  mode: "new" | "edit";
  draft: EventDraft;
  opener?: HTMLElement | null;
  quick?: boolean;
  clocks?: ThreeClocks | null;
  record?: EventRecord | null;
  onSaved?: (record: EventRecord) => void;
  onClosed?: () => void;
};

/** openEventDialog shows dialog "New event" or dialog "Edit event". */
export function openEventDialog(options: EventDialogOptions): Dialog {
  const title = options.mode === "new" ? "New event" : "Edit event";
  const draft = { ...options.draft };
  let saved = false;
  return openDialog(
    {
      title,
      opener: options.opener ?? null,
      className: "event-dialog",
      onClose: () => {
        if (options.mode === "new" && !saved) void api.deleteDraft().catch(() => undefined);
        options.onClosed?.();
      },
    },
    (body, dialog) => {
      const errors: Record<string, string> = {};
      const summary = el("div", { class: "errors", role: "group", "aria-label": "Problems" });
      const form = el("div", { class: "fields" });
      const fields: Fields = { dialog, draft, errors, setError: () => undefined };

      const titleField = textField("Title", draft.title, (value) => {
        draft.title = value;
        saveDraft();
      });
      const calendarField = selectField(
        "Calendar",
        editableCalendars().map((calendar) => [calendar.id, calendar.name]),
        draft.calendar_id,
        (value) => {
          draft.calendar_id = value;
          saveDraft();
        },
      );
      const kindField = selectField("Kind", KINDS, draft.kind, (value) => {
        draft.kind = value;
        saveDraft();
        renderKindExtras();
      });
      const colourField = selectField(
        "Colour",
        COLOURS.map((colour) => [colour, colour]),
        draft.colour,
        (value) => {
          draft.colour = value;
          saveDraft();
        },
      );
      const allDayField = checkboxField("All day", draft.all_day, (value) => {
        draft.all_day = value;
        draft.start_local = value ? draft.start_local.slice(0, 10) : `${draft.start_local.slice(0, 10)}T09:00`;
        draft.end_local = value ? draft.end_local.slice(0, 10) : `${draft.end_local.slice(0, 10)}T10:00`;
        startsField.input.value = draft.start_local.replace("T", " ");
        endsField.input.value = draft.end_local.replace("T", " ");
        saveDraft();
      });
      const startsField = textField("Starts", draft.start_local.replace("T", " "), (value) => {
        draft.start_local = value.trim().replace(" ", "T");
        saveDraft();
        updateClocks();
      });
      const endsField = textField("Ends", draft.end_local.replace("T", " "), (value) => {
        draft.end_local = value.trim().replace(" ", "T");
        saveDraft();
      });
      const zoneField = selectField(
        "Zone",
        ["New York", "London", "Auckland"].map((city) => [zoneOfCity(city), city]),
        draft.zone,
        (value) => {
          draft.zone = value;
          saveDraft();
          updateClocks();
        },
      );
      const locationField = textField("Location", draft.location, (value) => {
        draft.location = value;
        saveDraft();
      });
      const notesField = textAreaField("Notes", draft.notes, (value) => {
        draft.notes = value;
        saveDraft();
      });
      const privateField = checkboxField("Private", draft.visibility === "private", (value) => {
        draft.visibility = value ? "private" : "default";
        saveDraft();
      });
      const remindersField = textField("Reminder minutes", draft.reminders, (value) => {
        draft.reminders = value;
        saveDraft();
      });

      const repeatHolder = el("div", { class: "repeat" });
      const kindExtras = el("div", { class: "kind-extras" });

      form.append(
        titleField.node,
        calendarField.node,
        kindField.node,
        colourField.node,
        allDayField.node,
        startsField.node,
        endsField.node,
        zoneField.node,
        locationField.node,
        notesField.node,
        privateField.node,
        remindersField.node,
        repeatHolder,
        kindExtras,
      );

      const save = el("button", { type: "button", class: "primary", text: "Save" });
      const cancel = el("button", { type: "button", text: "Cancel" });

      const titleRow = el("div", { class: "dialog-title-row" }, [el("h2", { text: title })]);
      if (options.quick && options.clocks) titleRow.append(options.clocks.node);

      clear(body);
      body.append(titleRow, summary, form, el("div", { class: "row buttons" }, [save, cancel]));

      renderRepeat();
      renderKindExtras();
      updateClocks();

      function updateClocks(): void {
        if (!options.clocks || draft.all_day) return;
        const wall = parseLocal(draft.start_local);
        options.clocks.set(clocksFor(instantOf(wall, draft.zone)));
      }

      function renderRepeat(): void {
        clear(repeatHolder);
        repeatHolder.append(...repeatControls(draft, () => {
          saveDraft();
          renderRepeat();
        }));
      }

      function renderKindExtras(): void {
        clear(kindExtras);
        if (draft.kind === "focus_time") {
          kindExtras.append(
            radioGroup(
              "Decline",
              [
                ["new_only", "Only new invitations"],
                ["new_and_existing", "New and existing meetings"],
              ],
              draft.decline_mode,
              (value) => {
                draft.decline_mode = value;
                saveDraft();
              },
            ),
          );
        }
        if (draft.kind === "out_of_office") {
          kindExtras.append(
            textField("Decline message", draft.decline_message, (value) => {
              draft.decline_message = value;
              saveDraft();
            }).node,
          );
        }
      }

      let draftTimer: number | null = null;
      function saveDraft(): void {
        if (options.mode !== "new") return;
        if (draftTimer !== null) window.clearTimeout(draftTimer);
        draftTimer = window.setTimeout(() => {
          void api.putDraft(draft as unknown as Record<string, unknown>).catch(() => undefined);
        }, 400);
      }

      function showErrors(apiErrors: Record<string, string>): void {
        clear(summary);
        for (const key of Object.keys(errors)) delete errors[key];
        Object.assign(errors, apiErrors);
        const names: Record<string, { node: HTMLElement; input: HTMLElement }> = {
          title: titleField,
          start_local: startsField,
          end_local: endsField,
          rrule: { node: repeatHolder, input: repeatHolder },
          reminders: remindersField,
          decline_message: kindExtras.firstElementChild
            ? { node: kindExtras, input: kindExtras }
            : remindersField,
        };
        const list = el("ul", {});
        for (const [field, message] of Object.entries(apiErrors)) {
          const target = names[field];
          if (target) {
            let note = target.node.querySelector<HTMLElement>(".field-error");
            if (!note) {
              note = el("p", { class: "field-error" });
              target.node.append(note);
            }
            note.textContent = message;
          }
          list.append(el("li", { text: message }));
        }
        summary.append(el("p", { text: "Check these:" }), list);
        announce(Object.values(apiErrors)[0] ?? "");
      }

      on(save, "click", () => {
        void submit();
      });
      on(cancel, "click", () => dialog.close());

      async function submit(): Promise<void> {
        announce(`Saving ${draft.title || "event"}...`);
        const body: Record<string, unknown> = {
          calendar_id: draft.calendar_id,
          title: draft.title,
          kind: draft.kind,
          colour: draft.colour,
          all_day: draft.all_day,
          start_local: draft.start_local,
          end_local: draft.end_local,
          zone: draft.zone,
          location: draft.location,
          notes: draft.notes,
          visibility: draft.visibility,
          rrule: draft.rrule === "" ? null : draft.rrule,
          reminders: parseMinutes(draft.reminders),
        };
        if (draft.kind === "focus_time") body.decline_mode = draft.decline_mode;
        if (draft.kind === "out_of_office") body.decline_message = draft.decline_message;
        try {
          if (options.mode === "new") {
            if (draft.guest_ids.length) body.guest_ids = draft.guest_ids;
            const record = await api.createEvent(body);
            saved = true;
            await api.deleteDraft().catch(() => undefined);
            announce(`Saved ${record.title}.`);
            dialog.close(false);
            options.onSaved?.(record);
            return;
          }
          const record = options.record!;
          const id = record.event_id ?? record.id!;
          const scope = await chooseScope(record, save);
          if (!scope) return;
          if (scope !== "single") {
            body.scope = scope;
            body.occurrence_id = record.occurrence_id ?? id;
          }
          const result = await api.patchEvent(id, record.version ?? 1, body);
          announce(`Saved ${result.event.title}.`);
          dialog.close(false);
          options.onSaved?.(result.event);
        } catch (error) {
          if (error instanceof ApiError && error.status === 422) {
            showErrors(error.fields);
            return;
          }
          if (error instanceof ApiError) announce(error.message);
        }
      }

      void fields;
      titleField.input.focus();
      if (titleField.input instanceof HTMLInputElement) {
        titleField.input.setSelectionRange(titleField.input.value.length, titleField.input.value.length);
      }
    },
  );
}

function chooseScope(record: EventRecord, opener: HTMLElement): Promise<"single" | "this" | "following" | "all" | null> {
  if (!record.rrule) return Promise.resolve("single");
  return new Promise((resolve) => {
    scopeDialog("Edit repeating event", opener, (scope) => resolve(scope), () => resolve(null));
  });
}

export function parseMinutes(value: string): number[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => Number(part))
    .filter((minutes) => Number.isFinite(minutes));
}

type Field = { node: HTMLElement; input: HTMLElement };

export function textField(label: string, value: string, onInput: (value: string) => void): Field & { input: HTMLInputElement } {
  const input = el("input", { type: "text", value, "aria-label": label });
  on(input, "input", () => onInput(input.value));
  const node = el("label", { class: "field" }, [el("span", { text: label }), input]);
  return { node, input };
}

export function textAreaField(label: string, value: string, onInput: (value: string) => void): Field {
  const input = el("textarea", { "aria-label": label, rows: 3 });
  input.value = value;
  on(input, "input", () => onInput(input.value));
  const node = el("label", { class: "field" }, [el("span", { text: label }), input]);
  return { node, input };
}

export function selectField(
  label: string,
  options: [string, string][],
  value: string,
  onChange: (value: string) => void,
): Field & { input: HTMLSelectElement } {
  const input = el("select", { "aria-label": label });
  for (const [optionValue, optionLabel] of options) {
    const option = el("option", { value: optionValue, text: optionLabel });
    if (optionValue === value) option.selected = true;
    input.append(option);
  }
  on(input, "change", () => onChange(input.value));
  const node = el("label", { class: "field" }, [el("span", { text: label }), input]);
  return { node, input };
}

export function checkboxField(label: string, value: boolean, onChange: (value: boolean) => void): Field & { input: HTMLInputElement } {
  const input = el("input", { type: "checkbox", "aria-label": label });
  input.checked = value;
  on(input, "change", () => onChange(input.checked));
  const node = el("label", { class: "field check" }, [input, el("span", { text: label })]);
  return { node, input };
}

export function numberField(label: string, value: number, onInput: (value: number) => void): Field & { input: HTMLInputElement } {
  const input = el("input", { type: "number", value: String(value), "aria-label": label, role: "spinbutton" });
  on(input, "input", () => onInput(Number(input.value)));
  const node = el("label", { class: "field" }, [el("span", { text: label }), input]);
  return { node, input };
}

/** radioGroup builds a keyboard-driven radiogroup. */
export function radioGroup(
  label: string,
  options: [string, string][],
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const group = el("div", { role: "radiogroup", "aria-label": label, class: "radio-group" });
  const radios: HTMLElement[] = [];
  const select = (index: number) => {
    radios.forEach((radio, position) => {
      radio.setAttribute("aria-checked", position === index ? "true" : "false");
      radio.setAttribute("tabindex", position === index ? "0" : "-1");
    });
    radios[index].focus();
    onChange(options[index][0]);
  };
  options.forEach(([optionValue, optionLabel], index) => {
    const checked = optionValue === value;
    const radio = el("div", {
      role: "radio",
      class: "radio",
      "aria-checked": checked ? "true" : "false",
      tabindex: checked ? "0" : "-1",
      text: optionLabel,
    });
    on(radio, "click", () => select(index));
    radios.push(radio);
    group.append(radio);
  });
  if (!options.some(([optionValue]) => optionValue === value) && radios.length) {
    radios[0].setAttribute("tabindex", "0");
  }
  on(group, "keydown", (event: KeyboardEvent) => {
    const current = radios.findIndex((radio) => radio.getAttribute("aria-checked") === "true");
    const base = current === -1 ? 0 : current;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      select((base + 1) % radios.length);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      select((base - 1 + radios.length) % radios.length);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      select(base);
    }
  });
  return group;
}

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** repeatControls reads its options from the start date and saves the
 *  published rule. */
export function repeatControls(draft: EventDraft, onChange: () => void): HTMLElement[] {
  const parsed = parseRule(draft.rrule);
  const start = parseLocal(draft.start_local);
  const weekday = new Date(Date.UTC(start.y, start.m - 1, start.d)).getUTCDay();
  const mondayIndex = (weekday + 6) % 7;
  const nth = Math.floor((start.d - 1) / 7) + 1;
  const isLast = start.d + 7 > daysInMonth(start.y, start.m);
  const ordinals = ["", "first", "second", "third", "fourth"];

  const nodes: HTMLElement[] = [];
  nodes.push(
    radioGroup(
      "Repeat",
      [
        ["", "Does not repeat"],
        ["DAILY", "Daily"],
        ["WEEKLY", "Weekly"],
        ["MONTHLY", "Monthly"],
        ["YEARLY", "Yearly"],
      ],
      parsed.freq,
      (value) => {
        parsed.freq = value;
        parsed.byDay = value === "WEEKLY" ? [DAY_CODES[mondayIndex]] : [];
        parsed.monthlyBy = "day";
        draft.rrule = buildRule(parsed, start, nth, isLast, mondayIndex);
        onChange();
      },
    ),
  );

  if (parsed.freq === "WEEKLY") {
    const group = el("div", { role: "group", "aria-label": "Repeat on", class: "repeat-on" });
    DAY_CODES.forEach((code, index) => {
      const field = checkboxField(DAY_LABELS[index], parsed.byDay.includes(code), (checked) => {
        parsed.byDay = checked ? [...parsed.byDay, code] : parsed.byDay.filter((day) => day !== code);
        if (!parsed.byDay.includes(DAY_CODES[mondayIndex])) parsed.byDay.push(DAY_CODES[mondayIndex]);
        draft.rrule = buildRule(parsed, start, nth, isLast, mondayIndex);
        onChange();
      });
      group.append(field.node);
    });
    nodes.push(group);
  }

  if (parsed.freq === "MONTHLY") {
    const options: [string, string][] = [["day", `On day ${start.d}`]];
    if (nth <= 4) options.push(["nth", `On the ${ordinals[nth]} ${weekdayName(weekday)}`]);
    if (isLast) options.push(["last", `On the last ${weekdayName(weekday)}`]);
    nodes.push(
      radioGroup("Monthly by", options, parsed.monthlyBy, (value) => {
        parsed.monthlyBy = value;
        draft.rrule = buildRule(parsed, start, nth, isLast, mondayIndex);
        onChange();
      }),
    );
  }

  if (parsed.freq !== "") {
    const ends = el("div", { class: "ends" });
    ends.append(
      radioGroup(
        "Ends",
        [
          ["never", "Never"],
          ["date", "On date"],
          ["count", "After a number"],
        ],
        parsed.ends,
        (value) => {
          parsed.ends = value;
          draft.rrule = buildRule(parsed, start, nth, isLast, mondayIndex);
          onChange();
        },
      ),
    );
    if (parsed.ends === "date") {
      ends.append(
        textField("End date", parsed.until, (value) => {
          parsed.until = value;
          draft.rrule = buildRule(parsed, start, nth, isLast, mondayIndex);
        }).node,
      );
    }
    if (parsed.ends === "count") {
      ends.append(
        numberField("Occurrences", parsed.count, (value) => {
          parsed.count = value;
          draft.rrule = buildRule(parsed, start, nth, isLast, mondayIndex);
        }).node,
      );
    }
    nodes.push(ends);
  }
  return nodes;
}

type ParsedRule = { freq: string; byDay: string[]; monthlyBy: string; ends: string; until: string; count: number };

function parseRule(rule: string): ParsedRule {
  const parsed: ParsedRule = { freq: "", byDay: [], monthlyBy: "day", ends: "never", until: "", count: 10 };
  if (!rule) return parsed;
  for (const part of rule.split(";")) {
    const [name, value] = part.split("=");
    if (name === "FREQ") parsed.freq = value;
    if (name === "BYDAY") {
      if (value.startsWith("-1")) parsed.monthlyBy = "last";
      else if (/^\d/.test(value)) parsed.monthlyBy = "nth";
      else parsed.byDay = value.split(",");
    }
    if (name === "UNTIL") {
      parsed.ends = "date";
      parsed.until = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    }
    if (name === "COUNT") {
      parsed.ends = "count";
      parsed.count = Number(value);
    }
  }
  return parsed;
}

function buildRule(parsed: ParsedRule, start: { y: number; m: number; d: number }, nth: number, isLast: boolean, mondayIndex: number): string {
  if (!parsed.freq) return "";
  const parts = [`FREQ=${parsed.freq}`];
  if (parsed.freq === "WEEKLY") {
    const ordered = DAY_CODES.filter((code) => parsed.byDay.includes(code));
    parts.push(`BYDAY=${(ordered.length ? ordered : [DAY_CODES[mondayIndex]]).join(",")}`);
  }
  if (parsed.freq === "MONTHLY" && parsed.monthlyBy === "nth" && nth <= 4) {
    parts.push(`BYDAY=${nth}${DAY_CODES[mondayIndex]}`);
  }
  if (parsed.freq === "MONTHLY" && parsed.monthlyBy === "last" && isLast) {
    parts.push(`BYDAY=-1${DAY_CODES[mondayIndex]}`);
  }
  if (parsed.ends === "date" && parsed.until) parts.push(`UNTIL=${parsed.until.replace(/-/g, "")}`);
  if (parsed.ends === "count") parts.push(`COUNT=${Math.max(1, Math.round(parsed.count))}`);
  void start;
  return parts.join(";");
}

/** restoreDraft reopens the one server-kept draft with focus in its title. */
export async function restoreDraft(onSaved: (record: EventRecord) => void): Promise<boolean> {
  if (dialogNamed("New event")) return true;
  let held: { draft: Record<string, unknown> | null };
  try {
    held = await api.draft();
  } catch {
    return false;
  }
  if (!held.draft) return false;
  const draft = held.draft as unknown as EventDraft;
  if (!canEditCalendar(draft.calendar_id)) {
    const first = editableCalendars()[0];
    if (!first) return false;
    draft.calendar_id = first.id;
  }
  openEventDialog({ mode: "new", draft, onSaved });
  return true;
}
