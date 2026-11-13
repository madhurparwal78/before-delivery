// dialogs.ts — the quick dialog, the scope choice, the new and edit dialogs,
// the conflict dialog, notices and undo.

import { api, Occurrence, EventDetail } from "./api";
import { state, fmtHM, splitLocal, fmtLong, parseDate, zoneOf } from "./state";
import { h, button, dialog, textbox, checkbox, combobox, radiogroupWrap, radio, focusTrap, heading, spinbutton } from "./dom";
import { announce } from "./main";

let undoTimer: number | null = null;
let undoAction: (() => Promise<void>) | null = null;

export function offerUndo(action: () => Promise<void>): void {
  const holder = document.getElementById("undo-holder") ?? (() => {
    const el = h("div", { id: "undo-holder", class: "undo-holder" });
    document.body.appendChild(el);
    return el;
  })();
  undoAction = action;
  holder.replaceChildren();
  const btn = button("Undo", { class: "btn ghost", onclick: async () => {
    if (undoAction) {
      announce("Saving...");
      try {
        await undoAction();
      } catch (err) {
        announce(err instanceof Error ? err.message : "Something went wrong.");
      }
    }
    holder.replaceChildren();
  } }, "Undo");
  holder.appendChild(btn);
  if (undoTimer) window.clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => {
    holder.replaceChildren();
    undoAction = null;
  }, 10000);
}

function clockGroup(entries: { city: string; time: string; inside_hours: boolean }[]): HTMLElement {
  const group = h("div", { class: "clocks-inline", role: "group", "aria-label": "Three clocks" });
  for (const c of entries) {
    const cell = h("div", { class: "clock-cell", role: "group", "aria-label": `${c.city} ${c.time}, ${c.inside_hours ? "inside working hours" : "outside working hours"}` });
    const stack = h("div", { class: "numeral-stack" });
    for (const ch of c.time) stack.appendChild(h("span", { class: "digit" }, ch));
    cell.append(stack, h("span", { class: `clock-bar${c.inside_hours ? " inside" : ""}` }));
    group.appendChild(cell);
  }
  return group;
}

// openEventDialog shows the quick dialog for an occurrence.
export function openEventDialog(o: Occurrence, reload: () => void, opener?: HTMLElement, ribbonEl?: HTMLElement): void {
  const dlg = dialog(occurrenceTitleOf(o), "dialog quick");
  const titleRow = h("div", { class: "dialog-title-row" },
    heading(2, occurrenceTitleOf(o)),
    clockGroup(o.clocks ?? [])
  );
  const gapNote = o.adjusted ? h("p", { class: "note" }, `This occurrence starts at ${fmtHM(splitLocal(o.start_local).minutes)} because its saved time does not exist on ${fmtLong(parseDate(splitLocal(o.start_local).date))}.`) : null;
  if (ribbonEl) {
    // the ribbon settles into the title row: reuse its cells
    ribbonEl.classList.remove("clocks-ribbon");
    ribbonEl.classList.add("clocks-inline");
    titleRow.replaceChild(ribbonEl, titleRow.lastElementChild!);
  }
  const warn = (o.zone_warnings ?? [])[0];
  if (warn) {
    const region = h("div", { role: "region", "aria-label": "Zone rule warning", class: "warning-region" },
      `A zone rule for ${warn.city} took effect on ${fmtLong(parseDate(warn.effective_date))}: ${warn.note} ${warn.saved_time} now shows as ${warn.shown_time}.`
    );
    dlg.appendChild(region);
  }
  const body = h("div", { class: "dialog-actions" });
  body.appendChild(button("Open event", { class: "btn ghost", onclick: () => { dlg.close(); history.pushState(null, "", `/events/${o.event_id}?occurrence=${encodeURIComponent(o.occurrence_id)}`); void reroute(); } }, "Open event"));
  if (o.access === "full") {
    body.appendChild(button("Edit", { class: "btn ghost", onclick: async () => {
      dlg.close();
      const { data } = await api.getEvent(o.event_id, o.occurrence_id);
      openEditDialog(data, reload);
    } }, "Edit"));
    body.appendChild(button("Delete", { class: "btn ghost", onclick: async () => {
      dlg.close();
      await deleteEvent(o, reload);
    } }, "Delete"));
  }
  if (o.access !== "busy") {
    body.appendChild(button("Duplicate", { class: "btn ghost", onclick: async () => {
      announce(`Duplicating ${o.title}...`);
      try {
        const { data } = await api.duplicate(o.event_id);
        announce(`Duplicated ${data.title}.`);
        reload();
      } catch (err) {
        announce(err instanceof Error ? err.message : "Something went wrong.");
      }
    } }, "Duplicate"));
  }
  dlg.append(titleRow);
  if (gapNote) dlg.appendChild(gapNote);
  dlg.appendChild(body);
  document.body.appendChild(dlg);
  dlg.showModal();
  focusTrap(dlg);
  dlg.addEventListener("close", () => {
    dlg.remove();
    opener?.focus();
  });
  (body.firstElementChild as HTMLElement).focus();
}

function occurrenceTitleOf(o: Occurrence): string {
  return o.access === "busy" ? "Busy" : o.title;
}

async function reroute(): Promise<void> {
  const { route } = await import("./main");
  void route();
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function deleteEvent(o: Occurrence, reload: () => void): Promise<void> {
  announce(`Moving ${o.title} to trash...`);
  try {
    const { data } = await api.getEvent(o.event_id, o.occurrence_id);
    const etag = String(data.version ?? 1);
    if (data.rrule) {
      openScopeDialog("Delete repeating event", async (scope) => {
        const res = await api.deleteEvent(o.event_id, scope, o.occurrence_id, etag);
        announce(`Moved ${o.title} to trash.`);
        offerUndo(async () => {
          await api.restore(res.data.trash_id);
          announce(`Restored ${o.title}.`);
          reload();
        });
        reload();
      }, () => announce("Nothing was deleted."), undefined, "Delete");
    } else {
      const res = await api.deleteEvent(o.event_id, "all", o.occurrence_id, etag);
      announce(`Moved ${o.title} to trash.`);
      offerUndo(async () => {
        await api.restore(res.data.trash_id);
        announce(`Restored ${o.title}.`);
        reload();
      });
      reload();
    }
  } catch (err) {
    announce(err instanceof Error ? err.message : "Something went wrong.");
  }
}

// openScopeDialog offers This event, This and following events or All events.
export function openScopeDialog(title: string, onChoose: (scope: string) => Promise<void>, onCancel: () => void, opener?: HTMLElement, okLabel = "OK"): void {
  const dlg = dialog(title);
  const group = radiogroupWrap("Apply to");
  const options: { value: string; label: string }[] = [
    { value: "this", label: "This event" },
    { value: "following", label: "This and following events" },
    { value: "all", label: "All events" },
  ];
  for (const opt of options) {
    const r = radio("Apply to", opt.value, opt.label, opt.value === "this");
    r.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const radios = Array.from(group.querySelectorAll("input")) as HTMLInputElement[];
      const idx = radios.indexOf(e.target as HTMLInputElement);
      const next = (idx + (e.key === "ArrowDown" ? 1 : -1) + radios.length) % radios.length;
      radios[next].checked = true;
      radios[next].focus();
    });
    group.appendChild(r.parentElement!);
  }
  const cancel = button("Cancel", { class: "btn ghost", onclick: () => { dlg.close(); onCancel(); } }, "Cancel");
  const ok = button(okLabel, { class: "btn accent", onclick: async () => {
    const chosen = (group.querySelector("input:checked") as HTMLInputElement).value;
    dlg.close();
    await onChoose(chosen);
  } }, okLabel);
  dlg.append(group, h("div", { class: "dialog-actions" }, cancel, ok));
  document.body.appendChild(dlg);
  dlg.showModal();
  focusTrap(dlg);
  dlg.addEventListener("close", () => {
    dlg.remove();
    opener?.focus();
  });
  (group.querySelector("input") as HTMLElement).focus();
}

// openNewEventDialog is the quick dialog for a half-written event, kept as a
// server draft. A draft's saved values prefill the fields.
export function openNewEventDialog(startLocal: string, endLocal: string, reload: () => void, draft?: Record<string, unknown>): void {
  const dlg = dialog("New event");
  const form = h("form", { class: "event-form", onsubmit: async (e: Event) => {
    e.preventDefault();
    const title = titleBox.value;
    if (!title.trim()) {
      announce("Enter a title.");
      return;
    }
    announce(`Saving ${title}...`);
    try {
      await api.createEvent({
        calendar_id: calSel.value,
        title,
        kind: kindSel.value,
        all_day: allDayBox.checked,
        start_local: startBox.value,
        end_local: endBox.value,
        zone: zoneSel.value,
        location: locBox.value,
        notes: notesBox.value,
        visibility: "default",
      });
      await api.deleteDraft();
      announce(`Saved ${title}.`);
      dlg.close();
      reload();
    } catch (err) {
      if (err instanceof Error) announce(err.message);
    }
  } });
  const titleBox = textbox("Title", typeof draft?.title === "string" ? draft.title : "");
  const calSel = combobox("Calendar", state.calendars.filter((c) => c.level === "owner" || c.level === "edit" || c.level === "manage").map((c) => ({ value: c.id, label: c.name })), (typeof draft?.calendar_id === "string" ? draft.calendar_id : state.calendars[0]?.id) ?? "");
  const kindSel = combobox("Kind", [
    { value: "event", label: "Event" },
    { value: "focus", label: "Focus time" },
    { value: "out_of_office", label: "Out of office" },
  ], typeof draft?.kind === "string" ? draft.kind : undefined);
  const allDayBox = checkbox("All day", draft?.all_day === true);
  const startBox = textbox("Starts", startLocal.includes("T") ? `${startLocal.split("T")[0]} ${startLocal.split("T")[1]}` : startLocal);
  const endBox = textbox("Ends", endLocal.includes("T") ? `${endLocal.split("T")[0]} ${endLocal.split("T")[1]}` : endLocal);
  const zoneSel = combobox("Zone", [
    { value: "America/New_York", label: "New York" },
    { value: "Europe/London", label: "London" },
    { value: "Pacific/Auckland", label: "Auckland" },
  ], typeof draft?.zone === "string" ? draft.zone : zoneOf());
  const locBox = textbox("Location", typeof draft?.location === "string" ? draft.location : "");
  const notesBox = textbox("Notes", typeof draft?.notes === "string" ? draft.notes : "");
  const colourSel = combobox("Colour", [
    { value: "calendar", label: "Calendar colour" },
    { value: "rose", label: "Rose" },
    { value: "amber", label: "Amber" },
    { value: "teal", label: "Teal" },
    { value: "indigo", label: "Indigo" },
  ]);
  const repeatGroup = buildRepeatControls();
  const reminderBox = textbox("Reminder minutes", "");
  const declineGroup = radiogroupWrap("Decline");
  declineGroup.append(
    radio("Decline", "new_and_existing", "New and existing meetings", true).parentElement!,
    radio("Decline", "new_only", "Only new invitations", false).parentElement!
  );
  const declineMsg = textbox("Decline message", "");
  let draftTimer: number | undefined;

  const saveDraft = () => {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      void api.putDraft({
        calendar_id: calSel.value,
        title: titleBox.value,
        kind: kindSel.value,
        all_day: allDayBox.checked,
        start_local: startBox.value,
        end_local: endBox.value,
        zone: zoneSel.value,
        location: locBox.value,
        notes: notesBox.value,
        colour: colourSel.value,
        rrule: repeatGroup.value(),
        reminders: reminderBox.value,
        decline_mode: (declineGroup.querySelector("input:checked") as HTMLInputElement)?.value,
        decline_message: declineMsg.value,
      });
    }, 400);
  };
  for (const el of [titleBox, calSel, kindSel, allDayBox, startBox, endBox, zoneSel, locBox, notesBox, colourSel, reminderBox, declineMsg]) {
    el.addEventListener("input", saveDraft);
    el.addEventListener("change", saveDraft);
  }
  for (const r of declineGroup.querySelectorAll("input")) r.addEventListener("change", saveDraft);

  form.append(
    titleBox,
    calSel, kindSel, colourSel,
    allDayBox, startBox, endBox, zoneSel,
    locBox, notesBox,
    repeatGroup.el,
    reminderBox,
    kindSel.value === "focus" ? declineGroup : h("span", null),
    kindSel.value === "out_of_office" ? declineMsg : h("span", null),
    h("div", { class: "dialog-actions" },
      button("Cancel", { type: "button", class: "btn ghost", onclick: async () => {
        await api.deleteDraft();
        dlg.close();
      } }, "Cancel"),
      button("Save", { type: "submit", class: "btn accent" }, "Save")
    )
  );
  dlg.appendChild(form);
  document.body.appendChild(dlg);
  dlg.showModal();
  focusTrap(dlg);
  dlg.addEventListener("close", () => {
    dlg.remove();
    void api.deleteDraft();
  });
  titleBox.focus();
}

function buildRepeatControls(): { el: HTMLElement; value(): string | null } {
  const wrap = h("fieldset", { class: "repeat-controls" });
  const group = radiogroupWrap("Repeat");
  const options = [
    { value: "", label: "Does not repeat" },
    { value: "FREQ=DAILY", label: "Daily" },
    { value: "FREQ=WEEKLY", label: "Weekly" },
    { value: "FREQ=MONTHLY", label: "Monthly" },
    { value: "FREQ=YEARLY", label: "Yearly" },
  ];
  for (const opt of options) {
    group.appendChild(radio("Repeat", opt.value, opt.label, opt.value === "").parentElement!);
  }
  const onWrap = h("div", { role: "group", "aria-label": "Repeat on", class: "repeat-on" });
  const dayCodes: [string, string][] = [["Mon", "MO"], ["Tue", "TU"], ["Wed", "WE"], ["Thu", "TH"], ["Fri", "FR"], ["Sat", "SA"], ["Sun", "SU"]];
  for (const [label, code] of dayCodes) {
    const box = checkbox(label, false);
    box.dataset.code = code;
    onWrap.appendChild(box);
  }
  const monthlyBy = radiogroupWrap("Monthly by");
  const ends = radiogroupWrap("Ends");
  ends.append(
    radio("Ends", "never", "Never", true).parentElement!,
    radio("Ends", "ondate", "On date", false).parentElement!,
    radio("Ends", "after", "After a number", false).parentElement!
  );
  const endDate = textbox("End date", "");
  const occurrences = spinbutton("Occurrences", 4);
  wrap.append(group, onWrap, monthlyBy, ends, endDate, occurrences);
  const value = (): string | null => {
    const freq = (group.querySelector("input:checked") as HTMLInputElement)?.value;
    if (!freq) return null;
    const on = Array.from(onWrap.querySelectorAll<HTMLInputElement>("input:checked")).map((b) => b.dataset.code ?? "");
    let rule = freq;
    if (freq === "FREQ=WEEKLY" && on.length) rule += `;BYDAY=${on.join(",")}`;
    if (freq === "FREQ=MONTHLY") {
      const by = (monthlyBy.querySelector("input:checked") as HTMLInputElement)?.value;
      if (by) rule += `;BYDAY=${by}`;
    }
    const end = (ends.querySelector("input:checked") as HTMLInputElement)?.value;
    if (end === "ondate" && endDate.value) rule += `;UNTIL=${endDate.value.replace(/-/g, "")}`;
    if (end === "after" && occurrences.value) rule += `;COUNT=${occurrences.value}`;
    return rule;
  };
  return { el: wrap, value };
}

// openEditDialog holds the same fields directly on the dialog.
export function openEditDialog(e: EventDetail, reload: () => void): void {
  const dlg = dialog("Edit event");
  const titleBox = textbox("Title", e.title);
  const calSel = combobox("Calendar", state.calendars.filter((c) => c.level === "owner" || c.level === "edit" || c.level === "manage").map((c) => ({ value: c.id, label: c.name })), e.calendar_id);
  const kindSel = combobox("Kind", [
    { value: "event", label: "Event" },
    { value: "focus", label: "Focus time" },
    { value: "out_of_office", label: "Out of office" },
  ], e.kind ?? "event");
  const colourSel = combobox("Colour", [
    { value: "calendar", label: "Calendar colour" },
    { value: "rose", label: "Rose" },
    { value: "amber", label: "Amber" },
    { value: "teal", label: "Teal" },
    { value: "indigo", label: "Indigo" },
  ], e.colour ?? "calendar");
  const allDayBox = checkbox("All day", e.all_day);
  const startBox = textbox("Starts", e.all_day ? e.start_local : `${e.start_local.split("T")[0]} ${e.start_local.split("T")[1]}`);
  const endBox = textbox("Ends", e.all_day ? e.end_local : `${e.end_local.split("T")[0]} ${e.end_local.split("T")[1]}`);
  const zoneSel = combobox("Zone", [
    { value: "America/New_York", label: "New York" },
    { value: "Europe/London", label: "London" },
    { value: "Pacific/Auckland", label: "Auckland" },
  ], e.zone);
  const locBox = textbox("Location", e.location ?? "");
  const notesBox = textbox("Notes", e.notes ?? "");
  const privateBox = checkbox("Private", e.visibility === "private");
  const reminderBox = textbox("Reminder minutes", (e.reminders ?? []).join(","));
  const form = h("form", { onsubmit: async (ev: Event) => {
    ev.preventDefault();
    const etag = String(e.version ?? 1);
    const fields: Record<string, unknown> = {
      title: titleBox.value,
      calendar_id: calSel.value,
      kind: kindSel.value,
      colour: colourSel.value,
      all_day: allDayBox.checked,
      start_local: startBox.value,
      end_local: endBox.value,
      zone: zoneSel.value,
      location: locBox.value,
      notes: notesBox.value,
      visibility: privateBox.checked ? "private" : "default",
      reminders: reminderBox.value.split(",").map((s) => s.trim()).filter(Boolean).map(Number),
    };
    if (e.rrule) {
      fields.scope = "all";
      fields.occurrence_id = e.id;
    }
    announce(`Saving ${e.title}...`);
    try {
      await api.patchEvent(e.id, fields, etag);
      announce(`Saved ${titleBox.value}.`);
      dlg.close();
      reload();
    } catch (err) {
      if (err && typeof err === "object" && "current" in err && (err as { current: EventDetail }).current) {
        dlg.close();
        openConflictDialog(e, fields, (err as { current: EventDetail }).current, reload);
      } else {
        announce(err instanceof Error ? err.message : "Something went wrong.");
      }
    }
  } });
  form.append(
    titleBox, calSel, kindSel, colourSel, allDayBox, startBox, endBox, zoneSel,
    locBox, notesBox, privateBox, reminderBox,
    h("div", { class: "dialog-actions" },
      button("Cancel", { type: "button", class: "btn ghost", onclick: () => dlg.close() }, "Cancel"),
      button("Save", { type: "submit", class: "btn accent" }, "Save")
    )
  );
  dlg.appendChild(form);
  document.body.appendChild(dlg);
  dlg.showModal();
  focusTrap(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  titleBox.focus();
}

// openConflictDialog shows the winner's values and the choice.
export function openConflictDialog(mine: EventDetail, myFields: Record<string, unknown>, winner: EventDetail, reload: () => void): void {
  const dlg = dialog("This event changed");
  const list = h("ul", { "aria-label": "Winning values", class: "winning" });
  list.append(
    h("li", null, `Title: ${winner.title}`),
    h("li", null, `Starts: ${winner.start_local}`),
    h("li", null, `Ends: ${winner.end_local}`),
    h("li", null, `Location: ${winner.location ?? ""}`),
    h("li", null, `Notes: ${winner.notes ?? ""}`)
  );
  const winnerName = state.people.find((p) => p.id === (winner as unknown as { organiser?: { id: string } }).organiser?.id)?.name ?? "Someone";
  dlg.append(
    heading(2, `${winnerName} saved this first. Their values are shown here.`),
    list,
    h("div", { class: "dialog-actions" },
      button("Keep theirs", { class: "btn ghost", onclick: () => {
        announce(`Kept the saved values for ${winner.title}.`);
        dlg.close();
        reload();
      } }, "Keep theirs"),
      button("Reapply my changes", { class: "btn accent", onclick: async () => {
        announce(`Saving ${mine.title}...`);
        try {
          await api.patchEvent(mine.id, myFields, String(winner.version ?? 1));
          announce(`Saved ${mine.title}.`);
          dlg.close();
          reload();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      } }, "Reapply my changes")
    )
  );
  document.body.appendChild(dlg);
  dlg.showModal();
  focusTrap(dlg);
  dlg.addEventListener("close", () => dlg.remove());
}

export function openNotices(): void {
  void (async () => {
    const { data } = await api.notices();
    const dlg = dialog("Notices");
    const list = h("ul", { "aria-label": "Notices", class: "notices" });
    if (data.notices.length === 0) list.appendChild(h("li", { class: "empty" }, "No notices yet."));
    for (const n of data.notices) list.appendChild(h("li", null, n.text));
    const close = button("Close", { class: "btn ghost", onclick: () => dlg.close() }, "Close");
    dlg.append(list, close);
    document.body.appendChild(dlg);
    dlg.showModal();
    focusTrap(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    close.focus();
  })();
}
