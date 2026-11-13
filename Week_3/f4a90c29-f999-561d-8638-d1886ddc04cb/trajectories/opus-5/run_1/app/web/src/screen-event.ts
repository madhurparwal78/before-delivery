// The event page: everything the viewer may see about one event or
// occurrence, with answers, proposals, switches and the shared link.

import { ApiError, api, type EventRecord, type Guest, type Proposal } from "./api";
import { mainNavigation, reminderRegions } from "./chrome";
import { ThreeClocks, clocksFor } from "./clocks";
import { clear, el, on } from "./dom";
import { openDialog } from "./dialogs";
import {
  checkboxField,
  draftFromEvent,
  parseMinutes,
  radioGroup,
  repeatControls,
  selectField,
  textAreaField,
  textField,
  type EventDraft,
} from "./eventdialog";
import { openConflictDialog, zoneWarningText } from "./interact";
import { onLive, type EventChange } from "./live";
import { go, readAddress } from "./router";
import { announce, editableCalendars, state, subscribe } from "./state";
import { readableDate } from "./time";

let stopListening: (() => void)[] = [];

export async function renderEventPage(root: HTMLElement, eventID: string): Promise<void> {
  for (const stop of stopListening) stop();
  stopListening = [];
  const address = readAddress();
  const occurrenceID = address.occurrence ?? undefined;
  let record: EventRecord;
  try {
    record = await api.event(eventID, occurrenceID);
  } catch {
    clear(root);
    root.append(
      mainNavigation(),
      el("h1", { text: "Nothing is scheduled at this address." }),
      link("/calendar", "Back to the calendar"),
    );
    announce("That event is not available.");
    return;
  }
  const paint = () => draw(root, record, occurrenceID);
  paint();
  stopListening.push(subscribe(paint));
  stopListening.push(
    onLive((message) => {
      const data = message.data as EventChange;
      if (!data || data.event_id !== eventID) return;
      void api
        .event(eventID, occurrenceID)
        .then((fresh) => {
          record = fresh;
          paint();
        })
        .catch(() => undefined);
    }),
  );
}

function link(href: string, text: string): HTMLElement {
  const node = el("a", { href, text });
  on(node, "click", (event: MouseEvent) => {
    event.preventDefault();
    go(href);
  });
  return node;
}

function draw(root: HTMLElement, record: EventRecord, occurrenceID: string | undefined): void {
  clear(root);
  const canEdit = record.access === "full" || (record.access === "guest" && record.switches?.modify_event === true);
  const page = el("div", { class: "column event-page" });
  page.append(el("h1", { text: record.title }));

  if (!record.all_day && record.clocks.length) {
    const clocks = new ThreeClocks();
    clocks.set(record.clocks);
    page.append(clocks.node);
  }
  page.append(
    el("p", {
      text: record.all_day
        ? `${readableDate(record.start_local)} to ${readableDate(record.end_local)}, all day`
        : `${record.start_local.replace("T", " ")} to ${record.end_local.replace("T", " ")} ${record.zone}`,
    }),
  );
  if (record.location) page.append(el("p", { text: record.location }));
  if (record.adjusted) {
    page.append(
      el("p", {
        text: `This occurrence starts at ${record.start_local.slice(11)} because ${record.start_local.slice(
          11,
        )} does not exist on ${readableDate(record.start_local.slice(0, 10))}.`,
      }),
    );
  }

  const warning = record.zone_warnings?.[0];
  if (warning && (record.access === "full" || record.access === "guest")) {
    const region = el("div", { role: "region", "aria-label": "Zone rule warning", class: "warning" }, [
      el("p", { text: zoneWarningText(warning) }),
    ]);
    if (record.access === "full") {
      const move = el("button", { type: "button", text: "Move" });
      on(move, "click", async () => {
        announce(`Moving ${record.title}...`);
        try {
          const result = await api.zoneMove(record.id ?? record.event_id!, record.version ?? 1, warning.rule_id);
          announce(`Moved ${result.event.title} back to ${warning.saved_time} ${warning.city}.`);
          go(`/events/${result.event.id}`);
        } catch (error) {
          if (error instanceof ApiError) announce(error.message);
        }
      });
      region.append(move);
    }
    page.append(region);
  }

  if (record.rsvp) {
    page.append(
      el("div", { role: "region", "aria-label": "Answers", class: "answers" }, [
        el("p", {
          text: `${record.rsvp.yes} yes, ${record.rsvp.no} no, ${record.rsvp.maybe} maybe, ${record.rsvp.invited} waiting`,
        }),
      ]),
    );
  }
  if (record.guests) page.append(guestList(record, record.guests));

  if (record.access === "guest") page.append(...replyControls(record, occurrenceID));
  if (record.access === "guest") page.append(proposeButton(record, occurrenceID));
  if (record.proposals?.length) page.append(proposalList(record, record.proposals));
  if (record.my_proposals?.length) page.append(proposalList(record, record.my_proposals));

  if (record.access === "full") {
    page.append(guestSwitches(record), inviteControls(record), shareLinkControls(record), moveControls(record));
  }
  if (record.access !== "busy" && record.calendar_id !== "cal-holidays") {
    const duplicate = el("button", { type: "button", text: "Duplicate" });
    on(duplicate, "click", async () => {
      announce(`Duplicating ${record.title}...`);
      try {
        const copy = await api.duplicate(record.id ?? record.event_id!);
        announce(`Duplicated ${record.title}.`);
        go(`/events/${copy.id}`);
      } catch (error) {
        if (error instanceof ApiError) announce(error.message);
      }
    });
    page.append(duplicate);
  }
  if (canEdit) page.append(editFields(root, record, occurrenceID));
  if (record.kind === "out_of_office" && record.access === "full") page.append(conflictList(record));

  page.append(link("/calendar", "Back to the calendar"));
  root.append(mainNavigation(), page, reminderRegions());

  on(root, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      const focus = occurrenceID ?? record.id ?? record.event_id!;
      go(`/calendar?date=${record.start_local.slice(0, 10)}&focus=${encodeURIComponent(focus)}`);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      root.querySelector<HTMLButtonElement>(".event-save")?.click();
    }
  });
}

function guestList(record: EventRecord, guests: Guest[]): HTMLElement {
  const list = el("ul", { role: "list", "aria-label": "Guests", class: "guests" });
  for (const guest of guests) {
    const answer = guest.answer === "invited" || guest.answer === "" ? "Waiting" : capitalise(guest.answer);
    const row = el("li", {}, [el("span", { text: `${guest.name}: ${answer}` })]);
    if (guest.message) row.append(el("p", { text: guest.message }));
    if (record.access === "full") {
      const remove = el("button", { type: "button", text: `Remove ${guest.name}` });
      on(remove, "click", async () => {
        try {
          await api.removeGuest(record.id ?? record.event_id!, guest.person_id);
          announce(`Saved ${record.title}.`);
        } catch (error) {
          if (error instanceof ApiError) announce(error.message);
        }
      });
      row.append(remove);
    }
    list.append(row);
  }
  return list;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function replyControls(record: EventRecord, occurrenceID: string | undefined): HTMLElement[] {
  let scope: "occurrence" | "series" = "occurrence";
  const answer = record.my_reply?.answer ?? "invited";
  const forGroup = radioGroup(
    "Answer for",
    [
      ["occurrence", "This event"],
      ["series", "All events"],
    ],
    "occurrence",
    (value) => {
      scope = value as "occurrence" | "series";
    },
  );
  const yourAnswer = radioGroup(
    "Your answer",
    [
      ["yes", "Yes"],
      ["no", "No"],
      ["maybe", "Maybe"],
    ],
    answer,
    async (value) => {
      announce("Saving your answer...");
      try {
        await api.reply(record.id ?? record.event_id!, scope, value, occurrenceID);
        announce(`Your answer is saved: ${capitalise(value)}.`);
      } catch (error) {
        if (error instanceof ApiError) announce(error.message);
      }
    },
  );
  return [yourAnswer, forGroup];
}

function proposeButton(record: EventRecord, occurrenceID: string | undefined): HTMLElement {
  const button = el("button", { type: "button", text: "Propose a new time" });
  on(button, "click", () => {
    openDialog({ title: "Propose a new time", opener: button }, (body, dialog) => {
      const starts = textField("Starts", record.start_local.replace("T", " "), () => undefined);
      const ends = textField("Ends", record.end_local.replace("T", " "), () => undefined);
      const note = textField("Note", "", () => undefined);
      const send = el("button", { type: "button", class: "primary", text: "Send proposal" });
      const error = el("p", { class: "field-error" });
      on(send, "click", async () => {
        announce("Sending your proposal...");
        try {
          await api.propose(record.id ?? record.event_id!, {
            occurrence_id: occurrenceID,
            start_local: starts.input.value.trim().replace(" ", "T"),
            end_local: ends.input.value.trim().replace(" ", "T"),
            note: note.input.value,
          });
          announce(`Your proposal for ${record.title} is sent.`);
          dialog.close(false);
        } catch (failure) {
          if (failure instanceof ApiError) {
            error.textContent = failure.message;
            announce(failure.message);
          }
        }
      });
      body.append(
        el("h2", { text: "Propose a new time" }),
        starts.node,
        ends.node,
        note.node,
        error,
        el("div", { class: "row buttons" }, [send]),
      );
    });
  });
  return button;
}

function proposalList(record: EventRecord, proposals: Proposal[]): HTMLElement {
  const list = el("ul", { role: "list", "aria-label": "Proposed times", class: "proposals" });
  for (const proposal of proposals) {
    const row = el("li", {}, [
      el("span", {
        text: `${proposal.proposer.name}: ${proposal.start_local.replace("T", " ")} to ${proposal.end_local.replace(
          "T",
          " ",
        )} (${proposal.status})`,
      }),
    ]);
    if (proposal.note) row.append(el("p", { text: proposal.note }));
    if (record.access === "full" && proposal.status === "proposed") {
      const accept = el("button", { type: "button", text: "Accept" });
      const decline = el("button", { type: "button", text: "Decline" });
      on(accept, "click", () => void decide(proposal, "accept"));
      on(decline, "click", () => void decide(proposal, "decline"));
      row.append(accept, decline);
    }
    list.append(row);
  }
  return list;
}

async function decide(proposal: Proposal, decision: "accept" | "decline"): Promise<void> {
  try {
    await api.decideProposal(proposal.id, decision);
  } catch (error) {
    if (error instanceof ApiError) announce(error.message);
  }
}

function guestSwitches(record: EventRecord): HTMLElement {
  const group = el("div", { role: "group", "aria-label": "Guest switches", class: "switches" });
  const current = record.switches ?? { modify_event: false, invite_others: false, see_guest_list: false };
  const save = async (next: typeof current) => {
    const body: Record<string, unknown> = { switches: next };
    if (record.rrule) {
      body.scope = "all";
      body.occurrence_id = record.id;
    }
    try {
      await api.patchEvent(record.id ?? record.event_id!, record.version ?? 1, body);
      if (current.see_guest_list && !next.see_guest_list && record.share_link) {
        announce("Guest list hidden. The shared link no longer works.");
      } else {
        announce(`Saved ${record.title}.`);
      }
    } catch (error) {
      if (error instanceof ApiError) announce(error.message);
    }
  };
  group.append(
    checkboxField("Modify event", current.modify_event, (value) => void save({ ...current, modify_event: value })).node,
    checkboxField("Invite others", current.invite_others, (value) => void save({ ...current, invite_others: value })).node,
    checkboxField("See guest list", current.see_guest_list, (value) => void save({ ...current, see_guest_list: value })).node,
  );
  return group;
}

function inviteControls(record: EventRecord): HTMLElement {
  const options: [string, string][] = state.people
    .filter((person) => person.id !== state.me?.id && !record.guests?.some((guest) => guest.person_id === person.id))
    .map((person) => [person.id, person.name]);
  const field = selectField("Invite person", options.length ? options : [["", "No one to invite"]], options[0]?.[0] ?? "", () => undefined);
  const invite = el("button", { type: "button", text: "Invite" });
  on(invite, "click", async () => {
    if (!field.input.value) return;
    try {
      await api.addGuests(record.id ?? record.event_id!, [field.input.value]);
      announce(`Saved ${record.title}.`);
    } catch (error) {
      if (error instanceof ApiError) announce(error.message);
    }
  });
  return el("div", { class: "row" }, [field.node, invite]);
}

function shareLinkControls(record: EventRecord): HTMLElement {
  const row = el("div", { class: "row" });
  const copy = el("button", { type: "button", text: "Copy shared link" });
  on(copy, "click", async () => {
    if (!record.share_link) return;
    const url = `${window.location.origin}${record.share_link.url}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      announce(url);
    }
  });
  const fresh = el("button", { type: "button", text: "New shared link" });
  on(fresh, "click", async () => {
    try {
      await api.newShareLink(record.id ?? record.event_id!);
      announce(`Saved ${record.title}.`);
    } catch (error) {
      if (error instanceof ApiError) announce(error.message);
    }
  });
  const off = el("button", { type: "button", text: "Turn off shared link" });
  on(off, "click", async () => {
    try {
      await api.deleteShareLink(record.id ?? record.event_id!);
      announce(`Saved ${record.title}.`);
    } catch (error) {
      if (error instanceof ApiError) announce(error.message);
    }
  });
  if (record.share_link) row.append(el("p", { text: `${window.location.origin}${record.share_link.url}` }), copy);
  row.append(fresh, off);
  return row;
}

function moveControls(record: EventRecord): HTMLElement {
  const options: [string, string][] = editableCalendars().map((calendar) => [calendar.id, calendar.name]);
  const field = selectField("Move to calendar", options, record.calendar_id, () => undefined);
  const move = el("button", { type: "button", text: "Move to calendar" });
  on(move, "click", async () => {
    announce(`Moving ${record.title}...`);
    try {
      const moved = await api.moveToCalendar(record.id ?? record.event_id!, record.version ?? 1, field.input.value);
      const name = editableCalendars().find((calendar) => calendar.id === moved.calendar_id)?.name ?? moved.calendar_id;
      announce(`Moved ${record.title} to ${name}.`);
    } catch (error) {
      if (error instanceof ApiError) announce(error.message);
    }
  });
  return el("div", { class: "row" }, [field.node, move]);
}

function conflictList(record: EventRecord): HTMLElement {
  const list = el("ul", { role: "list", "aria-label": "Conflicts", class: "conflicts" });
  void api
    .conflicts(record.id ?? record.event_id!)
    .then(({ conflicts }) => {
      clear(list);
      for (const conflict of conflicts) {
        const label = `${conflict.title} on ${readableDate(conflict.start_local.slice(0, 10))}`;
        const row = el("li", {});
        row.append(
          radioGroup(
            label,
            [
              ["yes", "Yes"],
              ["no", "No"],
              ["maybe", "Maybe"],
            ],
            conflict.answer,
            async (value) => {
              announce("Saving your answer...");
              try {
                await api.reply(conflict.event_id, "occurrence", value, conflict.occurrence_id);
                announce(`Your answer is saved: ${capitalise(value)}.`);
              } catch (error) {
                if (error instanceof ApiError) announce(error.message);
              }
            },
          ),
        );
        list.append(row);
      }
    })
    .catch(() => undefined);
  return list;
}

/** editFields puts the Edit event fields straight on the page at edit access. */
function editFields(root: HTMLElement, record: EventRecord, occurrenceID: string | undefined): HTMLElement {
  const holder = el("div", { role: "dialog", "aria-label": "Edit event", class: "inline-edit" });
  const draft: EventDraft = draftFromEvent(record);
  const errors = el("div", { class: "errors" });
  const repeat = el("div", { class: "repeat" });
  const renderRepeat = () => {
    clear(repeat);
    repeat.append(...repeatControls(draft, renderRepeat));
  };
  const fields = [
    textField("Title", draft.title, (value) => (draft.title = value)).node,
    selectField("Calendar", editableCalendars().map((calendar) => [calendar.id, calendar.name]), draft.calendar_id, (value) => (draft.calendar_id = value)).node,
    selectField("Kind", [["event", "Event"], ["focus_time", "Focus time"], ["out_of_office", "Out of office"]], draft.kind, (value) => (draft.kind = value)).node,
    selectField("Colour", ["Calendar colour", "Rose", "Amber", "Teal", "Indigo"].map((colour) => [colour, colour]), draft.colour, (value) => (draft.colour = value)).node,
    checkboxField("All day", draft.all_day, (value) => (draft.all_day = value)).node,
    textField("Starts", draft.start_local.replace("T", " "), (value) => (draft.start_local = value.trim().replace(" ", "T"))).node,
    textField("Ends", draft.end_local.replace("T", " "), (value) => (draft.end_local = value.trim().replace(" ", "T"))).node,
    selectField("Zone", [["America/New_York", "New York"], ["Europe/London", "London"], ["Pacific/Auckland", "Auckland"]], draft.zone, (value) => (draft.zone = value)).node,
    textField("Location", draft.location, (value) => (draft.location = value)).node,
    textAreaField("Notes", draft.notes, (value) => (draft.notes = value)).node,
    checkboxField("Private", draft.visibility === "private", (value) => (draft.visibility = value ? "private" : "default")).node,
    textField("Reminder minutes", draft.reminders, (value) => (draft.reminders = value)).node,
  ];
  const save = el("button", { type: "button", class: "primary event-save", text: "Save" });
  on(save, "click", async () => {
    announce(`Saving ${draft.title}...`);
    const body: Record<string, unknown> = {
      title: draft.title,
      calendar_id: draft.calendar_id,
      kind: draft.kind,
      colour: draft.colour,
      all_day: draft.all_day,
      start_local: draft.start_local,
      end_local: draft.end_local,
      zone: draft.zone,
      location: draft.location,
      notes: draft.notes,
      visibility: draft.visibility,
      reminders: parseMinutes(draft.reminders),
      rrule: draft.rrule === "" ? null : draft.rrule,
    };
    if (record.rrule) {
      body.scope = "all";
      body.occurrence_id = occurrenceID ?? record.id;
    }
    try {
      const result = await api.patchEvent(record.id ?? record.event_id!, record.version ?? 1, body);
      announce(`Saved ${result.event.title}.`);
      clear(errors);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        clear(errors);
        const list = el("ul", {});
        for (const message of Object.values(error.fields)) list.append(el("li", { text: message }));
        errors.append(el("p", { text: "Check these:" }), list);
        announce(Object.values(error.fields)[0] ?? error.message);
        return;
      }
      if (error instanceof ApiError && error.status === 412 && error.current) {
        openConflictDialog(error, save, async () => {
          const fresh = await api.event(record.id ?? record.event_id!, occurrenceID);
          const result = await api.patchEvent(fresh.id!, fresh.version ?? 1, body);
          announce(`Saved ${result.event.title}.`);
        });
        return;
      }
      if (error instanceof ApiError) announce(error.message);
    }
  });
  renderRepeat();
  holder.append(el("h2", { text: "Edit event" }), errors, ...fields, repeat, save);
  void root;
  return holder;
}

export { clocksFor };
