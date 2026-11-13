// The landing page, sign in, and the other working screens.

import { ApiError, api, type BusyPerson, type Print, type SearchResult, type Slot } from "./api";
import { mainNavigation, reminderRegions } from "./chrome";
import { clear, el, on } from "./dom";
import { checkboxField, numberField, selectField, textField } from "./eventdialog";
import { onLive } from "./live";
import { go, readAddress, setParams } from "./router";
import { announce, changed, editableCalendars, manageableCalendars, state, subscribe, todayHere, viewerZone } from "./state";
import { cityOf, inZone, readableDate, wallClock, wallDate, ZONES } from "./time";

export function renderLanding(root: HTMLElement): void {
  clear(root);
  const column = el("div", { class: "column landing" });
  const heading = el("h1", { class: "hero" });
  heading.append(
    el("span", { class: "line", text: "Every clock in the firm," }),
    el("span", { class: "line", text: "agreeing to the second." }),
  );
  const signIn = el("a", { href: "/signin", class: "primary button-link", text: "Sign in" });
  on(signIn, "click", (event: MouseEvent) => {
    event.preventDefault();
    go("/signin");
  });
  const see = el("a", { href: "#three-clocks-example", class: "text-link", text: "See the three clocks" });
  on(see, "click", (event: MouseEvent) => {
    event.preventDefault();
    document.getElementById("three-clocks-example")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  column.append(
    heading,
    el("p", {
      class: "sentence",
      text:
        "One shared calendar for New York, London and Auckland, where a weekly meeting never drifts and nothing goes through email.",
    }),
    el("div", { class: "row" }, [signIn, see]),
  );
  const panel = el("div", {
    id: "three-clocks-example",
    role: "region",
    "aria-label": "Three clocks example",
    class: "example-panel",
  });
  const rows: [string, string, string, string, string][] = [
    ["Partners' weekly", "Tue 6 Oct 2026", "09:00 New York", "14:00 London", "02:00 Auckland"],
    ["Client readout", "Tue 6 Oct 2026", "11:30 New York", "16:30 London", "04:30 Auckland"],
  ];
  rows.forEach(([title, date, newYork, london, auckland], index) => {
    const row = el("div", { class: `example-row ${index === 0 ? "pointed" : ""}` }, [
      el("span", { class: "example-title", text: title }),
      el("span", { text: date }),
      el("span", { text: newYork }),
      el("span", { text: london }),
      el("span", { text: auckland }),
    ]);
    if (index === 0) row.append(el("span", { class: "pointer", "aria-hidden": "true" }));
    panel.append(row);
  });
  root.append(column, panel);
}

export function renderSignIn(root: HTMLElement): void {
  clear(root);
  const email = textField("Email", "", () => undefined);
  const passcode = el("input", { type: "password", "aria-label": "Passcode" });
  const button = el("button", { type: "button", class: "primary", text: "Sign in" });
  const error = el("p", { class: "field-error" });
  const submit = async () => {
    announce("Signing in...");
    error.textContent = "";
    try {
      await api.signIn(email.input.value.trim(), passcode.value);
      window.location.href = "/calendar";
    } catch (failure) {
      const message = failure instanceof ApiError ? failure.message : "That email and passcode do not match.";
      error.textContent = message;
      announce(message);
    }
  };
  on(button, "click", () => void submit());
  on(passcode, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") void submit();
  });
  root.append(
    el("div", { class: "column signin" }, [
      el("h1", { text: "Sign in" }),
      email.node,
      el("label", { class: "field" }, [el("span", { text: "Passcode" }), passcode]),
      error,
      button,
    ]),
  );
}

export async function renderSearch(root: HTMLElement): Promise<void> {
  const q = readAddress().q;
  clear(root);
  const box = el("input", { type: "search", role: "searchbox", "aria-label": "Search events", value: q });
  const list = el("ul", { role: "list", "aria-label": "Results", class: "results" });
  const note = el("p", {});
  root.append(mainNavigation(), el("div", { class: "column" }, [el("h1", { text: "Search" }), box, note, list]));
  box.focus();
  box.setSelectionRange(q.length, q.length);

  // Results and their announced count update in place, with no submit.
  const show = (results: SearchResult[], text: string, tooShort: boolean) => {
    clear(list);
    note.textContent = tooShort
      ? "Type at least 2 characters to search."
      : results.length === 0 && text
        ? `Nothing matches ${text}.`
        : "";
    for (const result of results) {
      const anchor = el("a", {
        href: `/calendar?date=${result.start_local.slice(0, 10)}&focus=${encodeURIComponent(result.occurrence_id)}`,
        text: `${result.title}, ${readableDate(result.start_local.slice(0, 10))}`,
      });
      on(anchor, "click", (event: MouseEvent) => {
        event.preventDefault();
        go(anchor.getAttribute("href")!);
      });
      list.append(el("li", {}, [anchor]));
    }
  };
  const run = async (text: string) => {
    if (text.trim().length < 2) {
      show([], text, true);
      return;
    }
    try {
      const { results } = await api.search(text.trim());
      show(results, text, false);
      announce(results.length === 1 ? `1 result for ${text}.` : `${results.length} results for ${text}.`);
    } catch (error) {
      if (error instanceof ApiError) announce(error.message);
    }
  };
  let timer: number | null = null;
  on(box, "input", () => {
    const value = box.value;
    setParams({ q: value }, true);
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(value), 250);
  });
  await run(q);
}

export async function renderFindATime(root: HTMLElement): Promise<void> {
  let chosen: string[] = [];
  let minutes = 30;
  let from = todayHere();
  let to = todayHere();
  let slots: Slot[] = [];
  let busy: BusyPerson[] = [];

  const run = async () => {
    try {
      const result = await api.findATime(chosen, minutes, from, to);
      slots = result.slots;
      busy = result.busy;
    } catch (error) {
      slots = [];
      busy = [];
      if (error instanceof ApiError) announce(error.message);
    }
    draw();
  };

  const draw = () => {
    clear(root);
    const peopleGroup = el("div", { role: "group", "aria-label": "People", class: "people" });
    for (const person of state.people) {
      if (person.id === state.me?.id) continue;
      const field = checkboxField(person.name, chosen.includes(person.id), (value) => {
        chosen = value ? [...chosen, person.id] : chosen.filter((id) => id !== person.id);
        void run();
      });
      peopleGroup.append(field.node);
    }
    const peopleSelect = el("div", { role: "combobox", "aria-label": "People", "aria-expanded": "true" }, [peopleGroup]);
    const minutesField = numberField("Minutes", minutes, (value) => {
      minutes = value;
      void run();
    });
    const fromField = textField("From", from, (value) => {
      from = value;
      void run();
    });
    const toField = textField("To", to, (value) => {
      to = value;
      void run();
    });
    const list = el("ul", { role: "list", "aria-label": "Slots", class: "slots" });
    if (slots.length === 0) {
      list.append(el("li", { text: "No free time fits these people. Try a longer range." }));
    }
    for (const slot of slots) {
      const wall = inZone(Date.parse(slot.start_utc), viewerZone());
      const label = `Book ${readableDate(wallDate(wall))} ${wallClock(wall)}`;
      const button = el("button", { type: "button", text: label });
      const times = slot.clocks.map((clock) => `${clock.time} ${clock.city}`).join(", ");
      on(button, "click", async () => {
        const endWall = inZone(Date.parse(slot.end_utc), viewerZone());
        const calendar = editableCalendars()[0];
        if (!calendar) {
          announce("You have no calendar you may add to.");
          return;
        }
        await api.putDraft({
          calendar_id: calendar.id,
          title: "",
          kind: "event",
          colour: "Calendar colour",
          all_day: false,
          start_local: `${wallDate(wall)}T${wallClock(wall)}`,
          end_local: `${wallDate(endWall)}T${wallClock(endWall)}`,
          zone: viewerZone(),
          location: "",
          notes: "",
          visibility: "default",
          reminders: "",
          rrule: "",
          decline_mode: "new_and_existing",
          decline_message: "",
          guest_ids: chosen,
        });
        go(`/calendar?date=${wallDate(wall)}`);
      });
      list.append(el("li", {}, [button, el("span", { text: times })]));
    }
    const busyRegion = el("div", { role: "region", "aria-label": "Busy blocks", class: "busy" });
    for (const person of busy) {
      const group = el("div", { role: "group", "aria-label": person.name, class: "busy-person" });
      for (const block of person.blocks) {
        for (const piece of cutAtMidnight(block.start_utc, block.end_utc)) {
          group.append(
            el("div", {
              role: "img",
              "aria-label": `Busy ${readableDate(piece.date)} ${piece.from} to ${piece.to}`,
              class: "busy-block",
            }),
          );
        }
      }
      busyRegion.append(group);
    }
    root.append(
      mainNavigation(),
      el("div", { class: "column" }, [
        el("h1", { text: "Find a time" }),
        peopleSelect,
        minutesField.node,
        fromField.node,
        toField.node,
        list,
        busyRegion,
      ]),
    );
  };
  await run();
}

/** cutAtMidnight splits a busy block at each midnight in the viewer's zone. */
function cutAtMidnight(startUTC: string, endUTC: string): { date: string; from: string; to: string }[] {
  const zone = viewerZone();
  const out: { date: string; from: string; to: string }[] = [];
  let at = Date.parse(startUTC);
  const end = Date.parse(endUTC);
  while (at < end) {
    const wall = inZone(at, zone);
    const date = wallDate(wall);
    const nextMidnight = Date.parse(`${date}T00:00:00Z`) + 86400000;
    let dayEnd = end;
    let toLabel = "";
    const sameDay = wallDate(inZone(end - 60000, zone)) === date;
    if (sameDay) {
      const endWall = inZone(end, zone);
      toLabel = wallClock(endWall) === "00:00" ? "24:00" : wallClock(endWall);
      dayEnd = end;
    } else {
      toLabel = "24:00";
      dayEnd = at + (nextMidnight - Date.parse(`${date}T${wallClock(wall)}:00Z`));
    }
    out.push({ date, from: wallClock(wall), to: toLabel });
    if (sameDay) break;
    at = dayEnd;
    if (out.length > 60) break;
  }
  return out;
}

export async function renderTrash(root: HTMLElement): Promise<void> {
  const draw = async () => {
    clear(root);
    const { items } = await api.trash();
    const list = el("ul", { role: "list", "aria-label": "Trash", class: "trash" });
    if (items.length === 0) list.append(el("li", { text: "Trash is empty. Deleted events stay here for 30 days." }));
    for (const item of items) {
      const restore = el("button", { type: "button", text: `Restore ${item.title}` });
      const forGood = el("button", { type: "button", text: `Delete ${item.title} for good` });
      on(restore, "click", async () => {
        announce(`Restoring ${item.title}...`);
        try {
          await api.restore(item.id);
          announce(`Restored ${item.title}.`);
        } catch (error) {
          if (error instanceof ApiError) announce(error.message);
        }
        await draw();
      });
      on(forGood, "click", async () => {
        announce(`Deleting ${item.title}...`);
        try {
          await api.deleteForGood(item.id);
          announce(`Deleted ${item.title} for good.`);
        } catch (error) {
          if (error instanceof ApiError) announce(error.message);
        }
        await draw();
      });
      list.append(
        el("li", {}, [el("span", { text: `${item.title} — ${item.days_left} days left` }), restore, forGood]),
      );
    }
    root.append(mainNavigation(), el("div", { class: "column" }, [el("h1", { text: "Trash" }), list]));
  };
  await draw();
}

export async function renderSharing(root: HTMLElement): Promise<void> {
  const calendars = manageableCalendars();
  let chosen = calendars[0]?.id ?? "";
  const draw = async () => {
    clear(root);
    const column = el("div", { class: "column" }, [el("h1", { text: "Sharing" })]);
    const picker = selectField("Calendar", calendars.map((calendar) => [calendar.id, calendar.name]), chosen, (value) => {
      chosen = value;
      void draw();
    });
    column.append(picker.node);
    if (chosen) {
      try {
        const { shares } = await api.shares(chosen);
        for (const share of shares) {
          const level = selectField(
            `Level for ${share.name}`,
            [
              ["free_busy", "See only free/busy"],
              ["details", "See all details"],
              ["edit", "Make changes"],
              ["manage", "Manage sharing"],
            ],
            share.level,
            async (value) => {
              announce("Saving access...");
              try {
                await api.putShare(chosen, share.person_id, value);
                announce("Access saved.");
              } catch (error) {
                if (error instanceof ApiError) announce(error.message);
              }
            },
          );
          const remove = el("button", { type: "button", text: `Remove ${share.name}` });
          on(remove, "click", async () => {
            announce("Saving access...");
            try {
              await api.deleteShare(chosen, share.person_id);
              announce("Access saved.");
            } catch (error) {
              if (error instanceof ApiError) announce(error.message);
            }
            await draw();
          });
          column.append(el("div", { class: "row" }, [el("span", { text: share.name }), level.node, remove]));
        }
      } catch (error) {
        if (error instanceof ApiError) column.append(el("p", { text: error.message }));
      }
      const candidates = state.people.filter((person) => person.id !== state.me?.id);
      const person = selectField("Person", candidates.map((item) => [item.id, item.name]), candidates[0]?.id ?? "", () => undefined);
      const level = selectField(
        "Level",
        [
          ["free_busy", "See only free/busy"],
          ["details", "See all details"],
          ["edit", "Make changes"],
          ["manage", "Manage sharing"],
        ],
        "details",
        () => undefined,
      );
      const add = el("button", { type: "button", class: "primary", text: "Add" });
      on(add, "click", async () => {
        announce("Saving access...");
        try {
          await api.putShare(chosen, person.input.value, level.input.value);
          announce("Access saved.");
        } catch (error) {
          if (error instanceof ApiError) announce(error.message);
        }
        await draw();
      });
      column.append(el("div", { class: "row" }, [person.node, level.node, add]));
    }
    root.append(mainNavigation(), column);
  };
  await draw();
}

export async function renderZoneRules(root: HTMLElement): Promise<void> {
  const draw = async () => {
    clear(root);
    const column = el("div", { class: "column" }, [el("h1", { text: "Zone rules" })]);
    if (state.me?.role === "office_manager") {
      const zone = selectField("Zone", ZONES.map((item) => [item, cityOf(item)]), ZONES[0], () => undefined);
      const date = textField("Effective date", "", () => undefined);
      const offset = textField("New offset", "", () => undefined);
      const note = textField("Note", "", () => undefined);
      const record = el("button", { type: "button", class: "primary", text: "Record rule" });
      const errors = el("div", { class: "errors" });
      on(record, "click", async () => {
        announce("Recording rule...");
        clear(errors);
        try {
          const rule = await api.recordZoneRule({
            zone: zone.input.value,
            effective_date: date.input.value.trim(),
            new_offset: offset.input.value.trim(),
            note: note.input.value,
          });
          announce(`Rule recorded for ${rule.city}.`);
          state.zoneRules = (await api.zoneRules()).rules;
        } catch (error) {
          if (error instanceof ApiError) {
            for (const message of Object.values(error.fields)) errors.append(el("p", { text: message }));
            announce(Object.values(error.fields)[0] ?? error.message);
          }
        }
        await draw();
      });
      column.append(zone.node, date.node, offset.node, note.node, errors, record);
    }
    const list = el("ul", { role: "list", "aria-label": "Zone rules", class: "zone-rules" });
    for (const rule of state.zoneRules) {
      list.append(
        el("li", {
          text: `${rule.city} from ${readableDate(rule.effective_date)}: ${rule.new_offset} — ${rule.note}`,
        }),
      );
    }
    column.append(list);
    root.append(mainNavigation(), column);
  };
  await draw();
  onLive((message) => {
    if (message.type === "zone_rule.recorded") {
      void api.zoneRules().then(({ rules }) => {
        state.zoneRules = rules;
        void draw();
      });
    }
  });
}

export async function renderPrints(root: HTMLElement): Promise<void> {
  let prints: Print[] = [];
  const copyFor = (print: Print): string => {
    if (print.status === "pending") {
      return print.waiting_on === "document_service"
        ? "The document service is not answering. This print stays pending; choose Retry."
        : "Preparing the printed week.";
    }
    if (print.status === "rendered") {
      return print.waiting_on === "file_storage"
        ? "File storage is not answering. This print stays pending; choose Retry."
        : "Storing the printed week.";
    }
    if (print.status === "failed") return "This print failed. Choose Retry.";
    return "The printed week is ready.";
  };
  const draw = () => {
    clear(root);
    const week = textField("Week starting", "", () => undefined);
    const button = el("button", { type: "button", class: "primary", text: "Print the week" });
    const errors = el("div", { class: "errors" });
    on(button, "click", async () => {
      clear(errors);
      try {
        await api.createPrint(week.input.value.trim(), `print-${Date.now()}`);
        prints = (await api.prints()).prints;
        draw();
      } catch (error) {
        if (error instanceof ApiError) {
          for (const message of Object.values(error.fields)) errors.append(el("p", { text: message }));
          announce(Object.values(error.fields)[0] ?? error.message);
        }
      }
    });
    const list = el("ul", { role: "list", "aria-label": "Printed weeks", class: "prints" });
    if (prints.length === 0) list.append(el("li", { text: "No printed weeks yet." }));
    for (const print of prints) {
      const row = el("li", {}, [el("span", { text: `Week of ${readableDate(print.week_start)} — ${copyFor(print)}` })]);
      if (print.status !== "stored") {
        const retry = el("button", { type: "button", text: "Retry" });
        on(retry, "click", async () => {
          await api.retryPrint(print.id);
          prints = (await api.prints()).prints;
          draw();
        });
        row.append(retry);
      } else {
        row.append(el("a", { href: `/api/prints/${print.id}/pdf`, text: "Download PDF" }));
      }
      list.append(row);
    }
    root.append(
      mainNavigation(),
      el("div", { class: "column" }, [el("h1", { text: "Prints" }), week.node, errors, button, list]),
    );
  };
  prints = (await api.prints()).prints;
  draw();
  onLive((message) => {
    if (message.type !== "print.changed") return;
    const data = message.data as { print: Print; text: string };
    announce(data.text);
    void api.prints().then(({ prints: fresh }) => {
      prints = fresh;
      draw();
    });
  });
}

export async function renderSettings(root: HTMLElement): Promise<void> {
  const me = state.me!;
  const draft = {
    zone: me.zone,
    week_start: me.week_start ?? "monday",
    hide_weekends: me.hide_weekends ?? false,
    custom_days: me.custom_days ?? 4,
    second_zone: me.second_zone ?? "",
  };
  const reminderDrafts = new Map<string, string>();
  const firm = state.settings;
  const guestDefaults = { ...(firm?.guest_defaults ?? { modify_event: false, invite_others: false, see_guest_list: false }) };
  const hours: Record<string, { open: string; close: string }> = {};
  for (const zone of ZONES) {
    const current = firm?.office_hours?.[zone];
    hours[zone] = { open: current?.open ?? "09:00", close: current?.close ?? "17:30" };
  }

  clear(root);
  const column = el("div", { class: "column" }, [el("h1", { text: "Settings" })]);
  column.append(
    selectField("My time zone", ZONES.map((zone) => [zone, cityOf(zone)]), draft.zone, (value) => (draft.zone = value)).node,
    selectField(
      "Week starts on",
      [["monday", "Monday"], ["sunday", "Sunday"], ["saturday", "Saturday"]],
      draft.week_start,
      (value) => (draft.week_start = value),
    ).node,
    checkboxField("Hide weekends", draft.hide_weekends, (value) => (draft.hide_weekends = value)).node,
    numberField("Custom days", draft.custom_days, (value) => (draft.custom_days = value)).node,
    selectField(
      "Second zone",
      [["", "None"], ...ZONES.map((zone) => [zone, cityOf(zone)] as [string, string])],
      draft.second_zone,
      (value) => (draft.second_zone = value),
    ).node,
  );
  for (const calendar of manageableCalendars()) {
    reminderDrafts.set(calendar.id, calendar.default_reminders.join(","));
    column.append(
      textField(`Default reminders for ${calendar.name}`, calendar.default_reminders.join(","), (value) =>
        reminderDrafts.set(calendar.id, value),
      ).node,
    );
  }
  if (me.role === "office_manager") {
    column.append(
      checkboxField("Modify event by default", guestDefaults.modify_event, (value) => (guestDefaults.modify_event = value)).node,
      checkboxField("Invite others by default", guestDefaults.invite_others, (value) => (guestDefaults.invite_others = value)).node,
      checkboxField("See guest list by default", guestDefaults.see_guest_list, (value) => (guestDefaults.see_guest_list = value)).node,
    );
    for (const zone of ZONES) {
      column.append(
        textField(`${cityOf(zone)} opens`, hours[zone].open, (value) => (hours[zone].open = value)).node,
        textField(`${cityOf(zone)} closes`, hours[zone].close, (value) => (hours[zone].close = value)).node,
      );
    }
  }
  const errors = el("div", { class: "errors" });
  const save = el("button", { type: "button", class: "primary", text: "Save settings" });
  on(save, "click", async () => {
    announce("Saving settings...");
    clear(errors);
    try {
      state.me = await api.patchMe({
        zone: draft.zone,
        week_start: draft.week_start,
        hide_weekends: draft.hide_weekends,
        custom_days: Number(draft.custom_days),
        second_zone: draft.second_zone === "" ? null : draft.second_zone,
      });
      for (const [id, value] of reminderDrafts) {
        const minutes = value
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== "")
          .map(Number);
        await api.patchCalendar(id, minutes);
      }
      if (me.role === "office_manager") {
        const officeHours: Record<string, { open: string; close: string; days: number[] }> = {};
        for (const zone of ZONES) officeHours[zone] = { ...hours[zone], days: [1, 2, 3, 4, 5] };
        state.settings = await api.patchSettings({ guest_defaults: guestDefaults, office_hours: officeHours });
      }
      state.calendars = (await api.calendars()).calendars;
      announce("Settings saved.");
      changed();
    } catch (error) {
      if (error instanceof ApiError) {
        for (const message of Object.values(error.fields)) errors.append(el("p", { text: message }));
        announce(Object.values(error.fields)[0] ?? error.message);
      }
    }
  });
  column.append(errors, save);
  root.append(mainNavigation(), column, reminderRegions());
  subscribe(() => undefined);
}

export async function renderSharedEvent(root: HTMLElement, token: string): Promise<void> {
  clear(root);
  try {
    const shared = await api.sharedEvent(token);
    const column = el("div", { class: "column" }, [el("h1", { text: shared.title })]);
    column.append(
      el("p", {
        text: shared.all_day
          ? `${readableDate(shared.start_local)} to ${readableDate(shared.end_local)}, all day`
          : `${shared.start_local.replace("T", " ")} to ${shared.end_local.replace("T", " ")} ${shared.zone}`,
      }),
    );
    if (shared.location) column.append(el("p", { text: shared.location }));
    for (const clock of shared.clocks) {
      column.append(el("p", { text: `${clock.time} ${clock.city}` }));
    }
    const list = el("ul", { role: "list", "aria-label": "Guests", class: "guests" });
    for (const guest of shared.guests) {
      const answer = guest.answer === "invited" || guest.answer === "" ? "Waiting" : guest.answer.charAt(0).toUpperCase() + guest.answer.slice(1);
      list.append(el("li", { text: `${guest.name}: ${answer}` }));
    }
    column.append(list);
    root.append(column);
  } catch {
    root.append(el("div", { class: "column" }, [el("h1", { text: "This link no longer works." })]));
  }
}

export function renderNotFound(root: HTMLElement): void {
  clear(root);
  const back = el("a", { href: "/calendar", text: "Back to the calendar" });
  on(back, "click", (event: MouseEvent) => {
    event.preventDefault();
    go("/calendar");
  });
  root.append(el("div", { class: "column" }, [el("h1", { text: "Nothing is scheduled at this address." }), back]));
}
