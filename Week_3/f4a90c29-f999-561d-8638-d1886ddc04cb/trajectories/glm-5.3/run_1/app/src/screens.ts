// screens.ts — the remaining single-column screens: search, trash, sharing,
// zone rules, settings, find a time, prints and the shared page.

import { api, PrintJob } from "./api";
import { state, fmtDate, fmtLong, parseDate, localNow } from "./state";
import { h, heading, button, textbox, searchbox, combobox, checkbox, spinbutton } from "./dom";
import { announce } from "./main";

export function renderSearch(app: HTMLElement, initialQ: string): void {
  const main = h("main", { class: "column" });
  main.appendChild(heading(1, "Search"));
  const box = searchbox("Search events", initialQ);
  const results = h("ul", { "aria-label": "Results", class: "results" });
  const hint = h("p", { class: "hint" }, initialQ.length > 0 && initialQ.length < 2 ? "Type at least 2 characters to search." : "");
  if (initialQ.length < 2 && initialQ.length > 0) hint.textContent = "Type at least 2 characters to search.";
  main.append(box, hint, results);
  app.appendChild(main);
  let timer: number | undefined;
  const run = async () => {
    const q = box.value.trim();
    if (q.length < 2) {
      results.replaceChildren();
      hint.textContent = "Type at least 2 characters to search.";
      return;
    }
    hint.textContent = "";
    try {
      const { data } = await api.search(q);
      results.replaceChildren();
      if (data.results.length === 0) {
        results.appendChild(h("li", { class: "empty" }, `Nothing matches ${q}.`));
        announce(`0 results for ${q}.`);
        return;
      }
      announce(`${data.results.length} result${data.results.length === 1 ? "" : "s"} for ${q}.`);
      for (const r of data.results) {
        const date = r.start_local.split("T")[0];
        results.appendChild(h("li", null,
          h("a", { href: `/calendar?view=day&date=${date}&focus=${encodeURIComponent(r.occurrence_id)}`, class: "text-link" }, `${r.title}, ${fmtLong(parseDate(date))}`)
        ));
      }
    } catch (err) {
      announce(err instanceof Error ? err.message : "Something went wrong.");
    }
  };
  box.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 400);
  });
  box.focus();
  if (initialQ.length >= 2) void run();
}

export function renderTrash(app: HTMLElement): void {
  const main = h("main", { class: "column" });
  main.appendChild(heading(1, "Trash"));
  const list = h("ul", { "aria-label": "Trash", class: "trash" });
  main.appendChild(list);
  app.appendChild(main);
  void (async () => {
    const { data } = await api.trash();
    list.replaceChildren();
    if (data.items.length === 0) {
      list.appendChild(h("li", { class: "empty" }, "Trash is empty. Deleted events stay here for 30 days."));
      return;
    }
    for (const item of data.items) {
      const row = h("li", { class: "trash-row" },
        h("span", null, `${item.title} (${item.days_left} days left)`),
        button(`Restore ${item.title}`, { class: "btn ghost", onclick: async () => {
          announce(`Restoring ${item.title}...`);
          try {
            await api.restore(item.id);
            announce(`Restored ${item.title}.`);
            location.reload();
          } catch (err) {
            announce(err instanceof Error ? err.message : "Something went wrong.");
          }
        } }, "Restore"),
        button(`Delete ${item.title} for good`, { class: "btn ghost", onclick: async () => {
          announce(`Deleting ${item.title}...`);
          try {
            await api.purge(item.id);
            announce(`Deleted ${item.title} for good.`);
            location.reload();
          } catch (err) {
            announce(err instanceof Error ? err.message : "Something went wrong.");
          }
        } }, "Delete for good")
      );
      list.appendChild(row);
    }
  })();
}

export function renderSharing(app: HTMLElement): void {
  const main = h("main", { class: "column" });
  main.appendChild(heading(1, "Sharing"));
  const calSel = combobox("Calendar", state.calendars.filter((c) => c.level === "owner" || c.level === "manage").map((c) => ({ value: c.id, label: c.name })));
  const list = h("ul", { class: "shares", "aria-label": "Shares" });
  const personSel = combobox("Person", state.people.map((p) => ({ value: p.id, label: p.name })));
  const levelSel = combobox("Level", [
    { value: "free_busy", label: "See only free/busy" },
    { value: "details", label: "See all details" },
    { value: "edit", label: "Make changes" },
    { value: "manage", label: "Manage sharing" },
  ]);
  main.append(calSel, list,
    h("div", { class: "row" }, personSel, levelSel,
      button("Add", { class: "btn ghost", onclick: async () => {
        announce("Saving access...");
        try {
          await api.putShare(calSel.value, personSel.value, levelSel.value);
          announce("Access saved.");
          void loadShares();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      } }, "Add")
    )
  );
  app.appendChild(main);
  const loadShares = async () => {
    list.replaceChildren();
    try {
      const { data } = await api.shares(calSel.value);
      for (const sh of data.shares) {
        const levelSel2 = combobox(`Level for ${sh.name}`, [
          { value: "free_busy", label: "See only free/busy" },
          { value: "details", label: "See all details" },
          { value: "edit", label: "Make changes" },
          { value: "manage", label: "Manage sharing" },
        ], sh.level);
        levelSel2.addEventListener("change", async () => {
          announce("Saving access...");
          try {
            await api.putShare(calSel.value, sh.person_id, levelSel2.value);
            announce("Access saved.");
          } catch (err) {
            announce(err instanceof Error ? err.message : "Something went wrong.");
          }
        });
        list.appendChild(h("li", { class: "share-row" },
          h("span", null, sh.name), levelSel2,
          button(`Remove ${sh.name}`, { class: "btn ghost", onclick: async () => {
            announce("Saving access...");
            try {
              await api.deleteShare(calSel.value, sh.person_id);
              announce("Access saved.");
              void loadShares();
            } catch (err) {
              announce(err instanceof Error ? err.message : "Something went wrong.");
            }
          } }, "Remove")
        ));
      }
    } catch {
      list.appendChild(h("li", { class: "empty" }, "You cannot manage these shares."));
    }
  };
  calSel.addEventListener("change", () => void loadShares());
  void state.loadPeople().then(() => {
    personSel.replaceChildren(...state.people.map((p) => {
      const opt = h("option", { value: p.id }, p.name);
      return opt;
    }));
    void loadShares();
  });
}

export function renderZoneRules(app: HTMLElement): void {
  const main = h("main", { class: "column" });
  main.appendChild(heading(1, "Zone rules"));
  const isManager = state.me?.role === "office_manager";
  if (isManager) {
    const zoneSel = combobox("Zone", [
      { value: "America/New_York", label: "New York" },
      { value: "Europe/London", label: "London" },
      { value: "Pacific/Auckland", label: "Auckland" },
    ]);
    const effective = textbox("Effective date", "");
    const offset = textbox("New offset", "");
    const note = textbox("Note", "");
    const form = h("form", { onsubmit: async (e: Event) => {
      e.preventDefault();
      announce("Recording rule...");
      try {
        const { data } = await api.recordRule({ zone: zoneSel.value, effective_date: effective.value, new_offset: offset.value, note: note.value });
        announce(`Rule recorded for ${data.city}.`);
        location.reload();
      } catch (err) {
        announce(err instanceof Error ? err.message : "Something went wrong.");
      }
    } },
      zoneSel, effective, offset, note,
      button("Record rule", { type: "submit", class: "btn accent" }, "Record rule")
    );
    main.appendChild(form);
  }
  const list = h("ul", { "aria-label": "Zone rules", class: "rules" });
  main.appendChild(list);
  app.appendChild(main);
  void (async () => {
    const { data } = await api.zoneRules();
    list.replaceChildren();
    for (const r of data.rules) {
      list.appendChild(h("li", null, `${r.city}: effective ${fmtLong(parseDate(r.effective_date))}, new offset ${r.new_offset}. ${r.note}`));
    }
  })();
}

export function renderSettings(app: HTMLElement): void {
  const me = state.me!;
  const main = h("main", { class: "column" });
  main.appendChild(heading(1, "Settings"));
  const zoneSel = combobox("My time zone", [
    { value: "America/New_York", label: "New York" },
    { value: "Europe/London", label: "London" },
    { value: "Pacific/Auckland", label: "Auckland" },
  ], me.zone);
  const weekSel = combobox("Week starts on", [
    { value: "monday", label: "Monday" },
    { value: "sunday", label: "Sunday" },
    { value: "saturday", label: "Saturday" },
  ], me.week_start);
  const hideBox = checkbox("Hide weekends", me.hide_weekends);
  const customDays = spinbutton("Custom days", me.custom_days, 2, 7);
  const secondSel = combobox("Second zone", [
    { value: "", label: "None" },
    { value: "America/New_York", label: "New York" },
    { value: "Europe/London", label: "London" },
    { value: "Pacific/Auckland", label: "Auckland" },
  ], me.second_zone ?? "");
  main.append(zoneSel, weekSel, hideBox, customDays, secondSel);
  const save = button("Save settings", { class: "btn accent", onclick: async () => {
    announce("Saving settings...");
    try {
      await api.patchMe({
        zone: zoneSel.value,
        week_start: weekSel.value,
        hide_weekends: hideBox.checked,
        custom_days: Number(customDays.value),
        second_zone: secondSel.value === "" ? null : secondSel.value,
      });
      announce("Settings saved.");
      await state.load();
      location.reload();
    } catch (err) {
      announce(err instanceof Error ? err.message : "Something went wrong.");
    }
  } }, "Save settings");
  main.appendChild(save);
  app.appendChild(main);
}

export function renderFind(app: HTMLElement): void {
  const main = h("main", { class: "column find" });
  main.appendChild(heading(1, "Find a time"));
  const peopleSel = combobox("People", state.people.map((p) => ({ value: p.id, label: p.name })));
  const chosen: Set<string> = new Set();
  const minutes = spinbutton("Minutes", 30, 15, 480);
  const from = textbox("From", fmtDate(localNow()));
  const to = textbox("To", fmtDate(new Date(localNow().getFullYear(), localNow().getMonth(), localNow().getDate() + 7)));
  const busyRegion = h("div", { role: "region", "aria-label": "Busy blocks", class: "busy-blocks" });
  const slots = h("ul", { "aria-label": "Slots", class: "slots" });
  main.append(peopleSel, minutes, from, to, busyRegion, slots);
  app.appendChild(main);
  const run = async () => {
    try {
      const { data } = await api.findATime(Array.from(chosen), Number(minutes.value) || 30, from.value, to.value);
      slots.replaceChildren();
      if (data.slots.length === 0) {
        slots.appendChild(h("li", { class: "empty" }, "No free time fits these people. Try a longer range."));
      }
      for (const s of data.slots) {
        const start = new Date(s.start_utc);
        const btn = button(`Book ${fmtLong(start)} ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`, { class: "btn ghost" }, `${fmtLong(start)} ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`);
        btn.addEventListener("click", () => {
          // opens the new event dialog with these people as guests
          const { openNewEventDialog } = requireDialogs();
          openNewEventDialog(`${fmtDate(start)}T${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`, "", () => location.reload());
        });
        slots.appendChild(h("li", null, btn));
      }
      busyRegion.replaceChildren();
      for (const b of data.busy) {
        const group = h("div", { class: "busy-col", role: "group", "aria-label": b.name });
        group.appendChild(h("span", { class: "busy-name" }, b.name));
        for (const block of b.blocks) {
          const s = new Date(block.start_utc);
          const e = new Date(block.end_utc);
          // one image per date, cut at midnight
          let cursor = new Date(s);
          while (fmtDate(cursor) <= fmtDate(e)) {
            const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
            const dayEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
            const segStart = s > dayStart ? s : dayStart;
            const segEnd = e < dayEnd ? e : dayEnd;
            const startLabel = fmtDate(segStart) === fmtDate(dayStart) && segStart.getHours() === 0 && segStart.getMinutes() === 0 ? "00:00" : `${String(segStart.getHours()).padStart(2, "0")}:${String(segStart.getMinutes()).padStart(2, "0")}`;
            const endLabel = fmtDate(segEnd) === fmtDate(dayEnd) && segEnd.getHours() === 0 && segEnd.getMinutes() === 0 ? "24:00" : `${String(segEnd.getHours()).padStart(2, "0")}:${String(segEnd.getMinutes()).padStart(2, "0")}`;
            group.appendChild(h("img", { src: "/static/block.svg", alt: `Busy ${fmtLong(segStart)} ${startLabel} to ${endLabel}`, class: "busy-img" }));
            if (e <= dayEnd) break;
            cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
          }
        }
        busyRegion.appendChild(group);
      }
    } catch (err) {
      announce(err instanceof Error ? err.message : "Something went wrong.");
    }
  };
  peopleSel.addEventListener("change", () => {
    if (chosen.has(peopleSel.value)) chosen.delete(peopleSel.value);
    else chosen.add(peopleSel.value);
    void run();
  });
  for (const el of [minutes, from, to]) {
    el.addEventListener("change", () => void run());
  }
  void run();
}

function requireDialogs(): { openNewEventDialog: (s: string, e: string, r: () => void) => void } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return dialogsRef;
}

import { openNewEventDialog } from "./dialogs";
const dialogsRef = { openNewEventDialog };

export function renderPrints(app: HTMLElement): void {
  const main = h("main", { class: "column" });
  main.appendChild(heading(1, "Prints"));
  const weekStart = textbox("Week starting", fmtDate(mondayOf(localNow())));
  const list = h("ul", { "aria-label": "Printed weeks", class: "prints" });
  main.append(
    h("div", { class: "row" }, weekStart,
      button("Print the week", { class: "btn accent", onclick: async () => {
        try {
          const idem = `print-${weekStart.value}-${state.me?.id}`;
          const { data } = await api.createPrint(weekStart.value, [], idem);
          announce(printCopy(data));
          void load();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      } }, "Print the week")
    ),
    list
  );
  app.appendChild(main);
  const load = async () => {
    const { data } = await api.prints();
    list.replaceChildren();
    if (data.prints.length === 0) {
      list.appendChild(h("li", { class: "empty" }, "No printed weeks yet."));
      return;
    }
    for (const p of data.prints) {
      const row = h("li", { class: "print-row" },
        h("span", null, `Week of ${fmtLong(parseDate(p.week_start))}: ${printCopy(p)}`),
        p.status !== "stored" ? button("Retry", { class: "btn ghost", onclick: async () => {
          const { data: updated } = await api.retryPrint(p.id);
          announce(printCopy(updated));
          void load();
        } }, "Retry") : null,
        p.status === "stored" ? h("a", { href: `/api/prints/${p.id}/pdf`, class: "text-link" }, "Download PDF") : null
      );
      list.appendChild(row);
    }
  };
  void load();
  const poll = window.setInterval(() => void load(), 2000);
  window.addEventListener("popstate", () => window.clearInterval(poll));
}

function printCopy(p: PrintJob): string {
  if (p.status === "failed") return "This print failed. Choose Retry.";
  if (p.status === "stored") return "The printed week is ready.";
  if (p.status === "rendered") {
    return p.waiting_on === "file_storage"
      ? "File storage is not answering. This print stays pending; choose Retry."
      : "Storing the printed week.";
  }
  return p.waiting_on === "document_service"
    ? "The document service is not answering. This print stays pending; choose Retry."
    : "Preparing the printed week.";
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const diff = (x.getDay() - 1 + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

export async function renderSharePage(app: HTMLElement, token: string): Promise<void> {
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(token)}`);
    if (!res.ok) {
      app.appendChild(h("main", { class: "column" }, heading(1, "This link no longer works.")));
      return;
    }
    const data = (await res.json()) as {
      title: string; location: string; organiser_name: string; all_day: boolean;
      start_local: string; end_local: string; zone: string;
      guests: { name: string; answer: string }[];
    };
    const main = h("main", { class: "column" });
    main.appendChild(heading(1, data.title));
    const list = h("ul", { "aria-label": "Guests", class: "guests" });
    for (const g of data.guests) list.appendChild(h("li", null, `${g.name}: ${g.answer}`));
    main.appendChild(list);
    app.appendChild(main);
  } catch {
    app.appendChild(h("main", { class: "column" }, heading(1, "This link no longer works.")));
  }
}
