// The Guests page: guest scenes newest first, cancelling, and the New guest scene sheet.

import { longDate } from "../shared/zone.ts";
import type { GuestScene, Room } from "../shared/types.ts";
import { api, HubUnreachable, load, requestKey } from "./api.ts";
import { emptyNote, h, num, pulse } from "./dom.ts";
import { icon } from "./icons.ts";
import { clockOf, live } from "./live.ts";
import { field, input, showError } from "./forms.ts";
import { Sheet, sheetHeader } from "./sheets.ts";
import type { Shell } from "./shell.ts";

const STATE_LABEL: Record<GuestScene["state"], string> = {
  scheduled: "Scheduled", active: "Active", ended: "Ended", cancelled: "Cancelled",
};

export async function guestsPage(shell: Shell): Promise<void> {
  const rooms = (await load<{ rooms: Room[] }>("/api/rooms")).rooms;
  const roomName = (id: string) => rooms.find((room) => room.id === id)?.name ?? id;
  const list = h("ul", { class: "card-list", "aria-label": "Guest scenes" });
  const create = h("button", { type: "button", class: "btn btn-primary" }, icon("plus"), h("span", {}, "New guest scene"));
  const pageStatus = h("p", { role: "status", "aria-label": "Guest scene", class: "form-status" });
  const pageAlert = h("p", { class: "inline-alert", role: "alert", hidden: true });
  const empty = emptyNote("No guest scenes yet. Give a visitor's room a scene that ends on time.");
  shell.main.append(
    h("div", { class: "page-head" }, h("h1", {}, "Guests"), create),
    h("p", { class: "lede" }, "A guest scene holds one room until its end time, then the room goes back to its schedule."),
    pageStatus, pageAlert, list, empty,
  );

  // ---- list ----------------------------------------------------------------------------------
  const rows = new Map<string, HTMLElement>();
  function row(guest: GuestScene): HTMLElement {
    const head = `${roomName(guest.room_id)} · ${live.sceneName(guest.scene_id)} · `;
    const tail = ` · until ${clockOf(guest.ends_at)} ${longDate(guest.ends_at.slice(0, 10))}`;
    const open = guest.state === "scheduled" || guest.state === "active";
    const cancel = open
      ? h("button", { type: "button", class: "btn", "aria-label": `Cancel guest scene for ${roomName(guest.room_id)}` }, "Cancel")
      : null;
    cancel?.addEventListener("click", () => void cancelGuest(guest, cancel));
    return h("li", { class: `card guest-card is-${guest.state}`, "data-guest": guest.id },
      h("span", { class: "card-text" }, h("span", {}, head, h("span", { class: `state state-${guest.state}` }, STATE_LABEL[guest.state]), num(tail))), cancel);
  }
  function upsert(guest: GuestScene, flash: boolean): void {
    const fresh = row(guest);
    const old = rows.get(guest.id);
    if (old) old.replaceWith(fresh);
    else list.prepend(fresh);
    rows.set(guest.id, fresh);
    empty.hidden = rows.size > 0;
    if (flash && old) pulse(fresh);
  }
  for (const guest of [...live.guests.values()].reverse()) upsert(guest, false);
  empty.hidden = rows.size > 0;
  live.on("guest_scene", (message) => upsert(message.guest_scene, true));

  async function cancelGuest(guest: GuestScene, button: HTMLButtonElement): Promise<void> {
    pageAlert.hidden = true;
    pageStatus.textContent = "Cancelling…";
    try {
      const result = await api<{ guest_scene: GuestScene }>("POST", `/api/guest-scenes/${encodeURIComponent(guest.id)}/cancel`, {});
      if (result.ok) {
        upsert(result.data.guest_scene, false);
        pageStatus.textContent = `Guest scene cancelled for ${roomName(guest.room_id)}.`;
        create.focus();
      } else {
        pageStatus.textContent = "";
        pageAlert.hidden = false;
        pageAlert.textContent = result.error.message;
        button.focus();
      }
    } catch (error) {
      if (!(error instanceof HubUnreachable)) throw error;
      pageStatus.textContent = "";
    }
  }

  // ---- sheet ---------------------------------------------------------------------------------
  const panel = h("div", { class: "sheet sheet-wide" });
  const sheet = new Sheet({ element: panel, label: "New guest scene" });
  const roomSelect = h("select", { class: "input" }, h("option", { value: "" }, "Choose a room"),
    ...rooms.map((room) => h("option", { value: room.id }, room.name)));
  const sceneSelect = h("select", { class: "input" });
  const room = field("Room", roomSelect);
  const scene = field("Scene", sceneSelect);
  const starts = field("Starts", input({ placeholder: "Now", inputmode: "numeric" }), "Household time, like 2026-11-07T11:00. Leave empty to start now.");
  const ends = field("Ends", input({ placeholder: "YYYY-MM-DDTHH:MM", inputmode: "numeric" }), "Household time, at most 14 days after the start.");
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Start guest scene");
  const overlap = h("p", { class: "inline-alert", role: "alert", hidden: true });
  const status = h("p", { role: "status", "aria-label": "Guest scene", class: "form-status" });
  const form = h("form", { class: "sheet-body", novalidate: true },
    room.wrap, scene.wrap, starts.wrap, ends.wrap, overlap, h("div", { class: "form-actions" }, submit), status);
  panel.append(sheetHeader(() => sheet, h("h2", { class: "sheet-title" }, "New guest scene")), form);

  let key = requestKey();
  for (const control of [roomSelect, sceneSelect, starts.control, ends.control]) {
    control.addEventListener("input", () => {
      key = requestKey();
    });
  }

  create.addEventListener("click", () => {
    sceneSelect.replaceChildren(h("option", { value: "" }, "Choose a scene"),
      ...live.scenes.map((option) => h("option", { value: option.id }, option.name)));
    for (const target of [room, scene, starts, ends]) showError(target, undefined);
    overlap.hidden = true;
    status.textContent = "";
    key = requestKey();
    sheet.open(create);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const startText = (starts.control as HTMLInputElement).value.trim();
    const body = {
      room_id: roomSelect.value,
      scene_id: sceneSelect.value,
      starts_at: startText === "" ? null : startText,
      ends_at: (ends.control as HTMLInputElement).value.trim(),
    };
    status.textContent = "Starting guest scene…";
    overlap.hidden = true;
    try {
      const result = await api<{ guest_scene: GuestScene }>("POST", "/api/guest-scenes", body, { "Idempotency-Key": key });
      const fields = result.ok ? {} : (result.error.fields ?? {});
      showError(room, fields.room_id);
      showError(scene, fields.scene_id);
      showError(starts, fields.starts_at);
      showError(ends, fields.ends_at);
      if (result.ok) {
        const guest = result.data.guest_scene;
        live.guests.set(guest.id, guest);
        upsert(guest, false);
        key = requestKey();
        status.replaceChildren(num(`Guest scene set for ${roomName(guest.room_id)} until ${clockOf(guest.ends_at)} on ${longDate(guest.ends_at.slice(0, 10))}.`));
      } else if (result.error.code === "guest_overlap") {
        status.textContent = "";
        overlap.hidden = false;
        overlap.textContent = result.error.message;
      } else {
        status.textContent = result.error.message;
      }
    } catch (error) {
      if (!(error instanceof HubUnreachable)) throw error;
      status.textContent = "";
    }
  });
}
