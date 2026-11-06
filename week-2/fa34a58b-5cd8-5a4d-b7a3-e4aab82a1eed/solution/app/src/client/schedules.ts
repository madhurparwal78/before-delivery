// The Schedules page: a tab per schedule listing its versions, and the schedule editor sheet.

import { longDate } from "../shared/zone.ts";
import type { Room, Schedule, ScheduleVersion } from "../shared/types.ts";
import { api, HubUnreachable, load } from "./api.ts";
import { h, num, setText, uid } from "./dom.ts";
import { icon } from "./icons.ts";
import { live } from "./live.ts";
import { field, input, showError } from "./forms.ts";
import { Sheet, sheetHeader } from "./sheets.ts";
import type { Shell } from "./shell.ts";

const CONFLICT = "Someone else changed this schedule. Reload it to see their change.";

const inForce = (schedule: Schedule, day: string): ScheduleVersion | undefined =>
  [...schedule.versions].reverse().find((version) => version.from <= day);

function dayRange(days: string[]): string {
  const names = days.map((day) => day.charAt(0).toUpperCase() + day.slice(1));
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]} to ${names[names.length - 1]}`;
}

function slotLine(slot: ScheduleVersion["slots"][number], rooms: Room[]): string {
  const names = rooms.filter((room) => slot.room_ids.includes(room.id)).map((room) => room.name);
  return `${slot.time} ${live.sceneName(slot.scene_id)} — ${names.join(", ")}`;
}

export async function schedulesPage(shell: Shell): Promise<void> {
  const rooms = (await load<{ rooms: Room[] }>("/api/rooms")).rooms;
  let schedules = (await load<{ schedules: Schedule[] }>("/api/schedules")).schedules;
  const tablist = h("div", { role: "tablist", "aria-label": "Schedules", class: "tabs" });
  const panelsHolder = h("div", { class: "tab-panels" });
  shell.main.append(
    h("div", { class: "page-head" }, h("h1", {}, "Schedules")),
    h("p", { class: "lede" }, "Each save carries a From date. Days before it keep the slots that were in force then."),
    tablist, panelsHolder,
  );

  let active = schedules[0]?.id ?? "";
  const tabs = new Map<string, HTMLButtonElement>();
  const panels = new Map<string, HTMLElement>();
  const openers = new Map<string, HTMLButtonElement>();

  function select(id: string, focus: boolean): void {
    active = id;
    for (const [scheduleId, tab] of tabs) {
      const on = scheduleId === id;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      (panels.get(scheduleId) as HTMLElement).hidden = !on;
    }
    if (focus) tabs.get(id)?.focus();
  }

  function renderPanel(schedule: Schedule): void {
    const panel = panels.get(schedule.id) as HTMLElement;
    const today = live.status.day;
    const current = inForce(schedule, today);
    const opener = openers.get(schedule.id) as HTMLButtonElement;
    const versions = schedule.versions.map((version) => {
      const state = version === current ? "In force today" : version.from > today ? "Upcoming" : "Earlier";
      return h("section", { class: `version${version === current ? " is-current" : ""}` },
        h("div", { class: "version-head" }, h("h2", { class: "version-title" }, num(`From ${longDate(version.from)}`)),
          h("span", { class: "badge" }, state)),
        h("ul", { class: "slot-lines" }, ...version.slots.map((slot) => h("li", {}, num(slotLine(slot, rooms))))));
    });
    panel.replaceChildren(
      h("div", { class: "panel-head" }, h("p", { class: "muted" }, `Runs ${dayRange(schedule.days)}.`), opener),
      ...versions,
    );
  }

  for (const schedule of schedules) {
    const tabId = uid("tab");
    const panelId = uid("panel");
    const tab = h("button", { type: "button", role: "tab", id: tabId, "aria-controls": panelId, class: "tab" }, schedule.name);
    tab.addEventListener("click", () => select(schedule.id, false));
    tab.addEventListener("keydown", (event) => {
      const ids = schedules.map((candidate) => candidate.id);
      const index = ids.indexOf(schedule.id);
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      select(ids[(index + step + ids.length) % ids.length] as string, true);
    });
    tabs.set(schedule.id, tab);
    tablist.append(tab);
    const panel = h("div", { role: "tabpanel", id: panelId, "aria-labelledby": tabId, class: "tab-panel" });
    panels.set(schedule.id, panel);
    panelsHolder.append(panel);
    const opener = h("button", { type: "button", class: "btn btn-primary" }, `Edit ${schedule.name} schedule`);
    opener.addEventListener("click", () => void openEditor(schedule.id, opener));
    openers.set(schedule.id, opener);
    renderPanel(schedule);
  }
  select(active, false);

  live.on("schedule", () => void refresh());
  live.on("scene", () => void refresh());
  live.onReconnect(() => void refresh());
  async function refresh(): Promise<void> {
    schedules = (await load<{ schedules: Schedule[] }>("/api/schedules")).schedules;
    for (const schedule of schedules) renderPanel(schedule);
  }

  // ---- editor --------------------------------------------------------------------------------
  const title = h("h2", { class: "sheet-title" });
  const panel = h("div", { class: "sheet sheet-editor" });
  const sheet = new Sheet({ element: panel, label: "Edit schedule" });
  const from = field("From", input({ inputmode: "numeric", placeholder: "YYYY-MM-DD", class: "input input-date" }), "The first day these slots run: today or up to 366 days ahead.");
  const fromInput = from.control as HTMLInputElement;
  const slotsError = h("p", { class: "field-error", hidden: true });
  const slotsHolder = h("div", { class: "slots" });
  const addSlot = h("button", { type: "button", class: "btn" }, icon("plus"), h("span", {}, "Add slot"));
  const save = h("button", { type: "submit", class: "btn btn-primary" }, "Save schedule");
  const reload = h("button", { type: "button", class: "btn", hidden: true }, icon("rotate-ccw"), h("span", {}, "Reload schedule"));
  const conflict = h("p", { class: "inline-alert", role: "alert", hidden: true });
  const status = h("p", { role: "status", "aria-label": "Schedule save", class: "form-status" });
  const form = h("form", { class: "sheet-body", novalidate: true },
    from.wrap, slotsHolder, slotsError, h("div", { class: "form-actions" }, addSlot),
    conflict, h("div", { class: "form-actions" }, save, reload), status);
  panel.append(sheetHeader(() => sheet, title), form);

  interface SlotView {
    group: HTMLFieldSetElement;
    legend: HTMLLegendElement;
    time: { error: HTMLElement; control: HTMLElement };
    scene: { error: HTMLElement; control: HTMLElement };
    rooms: { error: HTMLElement; control: HTMLElement };
    remove: HTMLButtonElement;
    boxes: HTMLInputElement[];
  }
  let views: SlotView[] = [];
  let editing: { id: string; name: string; revision: number } | null = null;

  function renumber(): void {
    views.forEach((view, index) => {
      setText(view.legend, `Slot ${index + 1}`);
      view.remove.setAttribute("aria-label", `Remove slot ${index + 1}`);
    });
  }

  function slotView(slot: { time: string; scene_id: string; room_ids: string[] } | null): SlotView {
    const time = field("Time", input({ inputmode: "numeric", placeholder: "HH:MM", class: "input input-short", value: slot?.time ?? "" }));
    const sceneSelect = h("select", { class: "input" },
      h("option", { value: "" }, "Choose a scene"),
      ...live.scenes.map((scene) => h("option", { value: scene.id, selected: scene.id === slot?.scene_id }, scene.name)));
    const scene = field("Scene", sceneSelect);
    const roomsLabel = uid("rooms");
    const roomsError = h("p", { class: "field-error", id: uid("error"), hidden: true });
    const boxes = rooms.map((room) => h("input", { type: "checkbox", value: room.id, class: "choice-input", checked: slot?.room_ids.includes(room.id) ?? false }));
    const roomGrid = h("div", { class: "room-choices", role: "group", "aria-labelledby": roomsLabel, "aria-describedby": roomsError.id },
      ...rooms.map((room, index) => h("label", { class: "choice" }, boxes[index] as HTMLInputElement, room.name)));
    const legend = h("legend", { class: "slot-legend" });
    const remove = h("button", { type: "button", class: "icon-btn" }, icon("trash-2"));
    const group = h("fieldset", { class: "slot" },
      legend,
      h("div", { class: "slot-row" }, time.wrap, scene.wrap, remove),
      h("div", { class: "field" }, h("p", { class: "field-label", id: roomsLabel }, "Rooms"), roomGrid, roomsError));
    const view: SlotView = { group, legend, time, scene, rooms: { error: roomsError, control: roomGrid }, remove, boxes };
    remove.addEventListener("click", () => {
      const index = views.indexOf(view);
      views.splice(index, 1);
      group.remove();
      renumber();
      (views[index]?.time.control ?? views[index - 1]?.time.control ?? addSlot).focus();
    });
    return view;
  }

  function loadSlots(version: ScheduleVersion | undefined): void {
    views = (version?.slots ?? []).map((slot) => slotView(slot));
    slotsHolder.replaceChildren(...views.map((view) => view.group));
    renumber();
  }

  function clearErrors(): void {
    showError(from, undefined);
    slotsError.hidden = true;
    for (const view of views) for (const target of [view.time, view.scene, view.rooms]) showError(target, undefined);
  }

  function showConflict(on: boolean): void {
    conflict.hidden = !on;
    conflict.textContent = on ? CONFLICT : "";
    reload.hidden = !on;
  }

  async function openEditor(id: string, opener: HTMLElement): Promise<void> {
    const schedule = (await load<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(id)}`)).schedule;
    editing = { id: schedule.id, name: schedule.name, revision: schedule.revision };
    const label = `Edit ${schedule.name} schedule`;
    sheet.setLabel(label);
    setText(title, label);
    fromInput.value = live.status.day;
    loadSlots(inForce(schedule, live.status.day));
    clearErrors();
    showConflict(false);
    status.textContent = "";
    sheet.open(opener);
  }

  addSlot.addEventListener("click", () => {
    const view = slotView(null);
    views.push(view);
    slotsHolder.append(view.group);
    renumber();
    (view.time.control as HTMLInputElement).focus();
  });

  reload.addEventListener("click", async () => {
    if (!editing) return;
    const schedule = (await load<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(editing.id)}`)).schedule;
    editing.revision = schedule.revision;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(fromInput.value) ? fromInput.value : live.status.day;
    loadSlots(inForce(schedule, day) ?? inForce(schedule, live.status.day));
    clearErrors();
    showConflict(false);
    status.textContent = "";
    save.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editing) return;
    const target = editing;
    const body = {
      revision: target.revision,
      from: fromInput.value.trim(),
      slots: views.map((view) => ({
        time: (view.time.control as HTMLInputElement).value.trim(),
        scene_id: (view.scene.control as HTMLSelectElement).value,
        room_ids: view.boxes.filter((box) => box.checked).map((box) => box.value),
      })),
    };
    status.textContent = "Saving schedule…";
    showConflict(false);
    try {
      const result = await api<{ schedule: Schedule }>("PUT", `/api/schedules/${encodeURIComponent(target.id)}`, body);
      clearErrors();
      if (result.ok) {
        target.revision = result.data.schedule.revision;
        loadSlots(result.data.schedule.versions.find((version) => version.from === body.from));
        status.replaceChildren(num(`Saved. ${target.name} slots change from ${longDate(body.from)}.`));
        return;
      }
      if (result.error.code === "schedule_changed") {
        status.textContent = "";
        showConflict(true);
        return;
      }
      const fields = result.error.fields ?? {};
      showError(from, fields.from ?? fields.revision);
      if (fields.slots) {
        slotsError.hidden = false;
        slotsError.textContent = fields.slots;
      }
      views.forEach((view, index) => {
        showError(view.time, fields[`slots.${index}.time`]);
        showError(view.scene, fields[`slots.${index}.scene_id`]);
        showError(view.rooms, fields[`slots.${index}.room_ids`]);
      });
      status.textContent = result.error.message;
    } catch (error) {
      if (!(error instanceof HubUnreachable)) throw error;
      status.textContent = "";
    }
  });
}
