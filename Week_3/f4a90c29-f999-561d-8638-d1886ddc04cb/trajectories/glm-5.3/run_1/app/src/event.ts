// event.ts — the event page with answers, proposals, switches and the shared
// link.

import { api, EventDetail } from "./api";
import { state, fmtHM, fmtLong, parseDate, splitLocal } from "./state";
import { h, dialog, heading, button, textbox, combobox, checkbox, radiogroupWrap, radio, focusTrap } from "./dom";
import { announce } from "./main";
import { openEditDialog } from "./dialogs";

export async function renderEvent(app: HTMLElement, id: string, occurrenceId: string): Promise<void> {
  let e: EventDetail;
  let etag: string;
  try {
    const res = await api.getEvent(id, occurrenceId || undefined);
    e = res.data;
    etag = res.etag ?? String(e.version ?? 1);
  } catch {
    app.appendChild(h("main", { class: "column" }, heading(1, "That event is not available.")));
    return;
  }
  const canEdit = e.access === "full";
  const canGuest = e.access === "guest";
  const showGuests = canEdit || (canGuest && (e.switches?.see_guest_list || e.switches?.modify_event)) || (e.access === "details" && e.switches?.see_guest_list);

  const main = h("main", { class: "column event-page" });
  main.append(heading(1, e.title));
  const clocks = h("div", { class: "clocks-inline", role: "group", "aria-label": "Three clocks" });
  for (const c of e.clocks ?? []) {
    const cell = h("div", { class: "clock-cell", role: "group", "aria-label": `${c.city} ${c.time}, ${c.inside_hours ? "inside working hours" : "outside working hours"}` });
    const stack = h("div", { class: "numeral-stack" });
    for (const ch of c.time) stack.appendChild(h("span", { class: "digit" }, ch));
    cell.append(stack, h("span", { class: `clock-bar${c.inside_hours ? " inside" : ""}` }));
    clocks.appendChild(cell);
  }
  main.appendChild(clocks);
  const warn = (e.zone_warnings ?? [])[0];
  if (warn) {
    main.appendChild(h("div", { role: "region", "aria-label": "Zone rule warning", class: "warning-region" },
      `A zone rule for ${warn.city} took effect on ${fmtLong(parseDate(warn.effective_date))}: ${warn.note} ${warn.saved_time} now shows as ${warn.shown_time}.`
    ));
    if (canEdit) {
      main.appendChild(button("Move", { class: "btn ghost", onclick: async () => {
        announce(`Moving ${e.title}...`);
        try {
          await api.zoneMove(e.id, warn.rule_id, etag);
          announce(`Moved ${e.title} back to ${warn.saved_time} ${warn.city}.`);
          location.reload();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      } }, "Move"));
    }
  }
  if (e.adjusted) {
    main.appendChild(h("p", { class: "note" }, `This occurrence starts at ${fmtHM(splitLocal(e.start_local).minutes)} because its saved time does not exist on ${fmtLong(parseDate(splitLocal(e.start_local).date))}.`));
  }

  // answers and guests
  if (showGuests && e.rsvp && e.guests) {
    const region = h("div", { role: "region", "aria-label": "Answers", class: "answers" });
    region.textContent = `${e.rsvp.yes} yes, ${e.rsvp.no} no, ${e.rsvp.maybe} maybe, ${e.rsvp.invited} waiting`;
    main.appendChild(region);
    const list = h("ul", { "aria-label": "Guests", class: "guests" });
    for (const g of [...e.guests].sort((a, b) => a.name.localeCompare(b.name))) {
      const row = h("li", null, `${g.name}: ${answerLabel(g.answer)}`);
      if (g.message) row.appendChild(h("span", { class: "msg" }, g.message));
      list.appendChild(row);
    }
    main.appendChild(list);
  }

  // answer controls for guests
  if (canGuest && e.my_reply) {
    const group = radiogroupWrap("Your answer");
    const current = e.my_reply.answer;
    for (const opt of [["yes", "Yes"], ["no", "No"], ["maybe", "Maybe"]]) {
      const r = radio("Your answer", opt[0], opt[1], current === opt[0]);
      r.addEventListener("change", async () => {
        const scopeGroup = document.querySelector('[aria-label="Answer for"] input:checked') as HTMLInputElement;
        const scope = scopeGroup?.value === "series" ? "series" : "occurrence";
        announce("Saving your answer...");
        try {
          await api.reply(e.id, scope, occurrenceId, opt[0]);
          announce(`Your answer is saved: ${opt[1]}.`);
          location.reload();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      });
      group.appendChild(r.parentElement!);
    }
    const forGroup = radiogroupWrap("Answer for");
    forGroup.append(
      radio("Answer for", "occurrence", "This event", true).parentElement!,
      radio("Answer for", "series", "All events", false).parentElement!
    );
    main.append(group, forGroup);
    main.appendChild(button("Propose a new time", { class: "btn ghost", onclick: () => openProposalDialog(e, occurrenceId) }, "Propose a new time"));
  }

  // proposals for edit access
  if (canEdit && (e.proposals ?? []).length) {
    const list = h("ul", { "aria-label": "Proposed times", class: "proposals" });
    for (const p of e.proposals ?? []) {
      const row = h("li", null,
        `${p.proposer.name} proposed ${p.start_local}`,
        p.status === "proposed" ? h("span", { class: "dialog-actions" },
          button("Accept", { class: "btn ghost", onclick: async () => {
            try {
              await api.decideProposal(p.id, true);
              announce(`Proposal accepted: ${e.title} moves to ${fmtHM(splitLocal(p.start_local).minutes)}.`);
              location.reload();
            } catch (err) {
              announce(err instanceof Error ? err.message : "Something went wrong.");
            }
          } }, "Accept"),
          button("Decline", { class: "btn ghost", onclick: async () => {
            try {
              await api.decideProposal(p.id, false);
              announce(`Proposal declined for ${e.title}.`);
              location.reload();
            } catch (err) {
              announce(err instanceof Error ? err.message : "Something went wrong.");
            }
          } }, "Decline")
        ) : null
      );
      list.appendChild(row);
    }
    main.appendChild(list);
  }

  // switches, guests editing and the shared link, at edit access
  if (canEdit) {
    const switches = h("div", { class: "switches", role: "group", "aria-label": "Guest switches" });
    const modifyBox = checkbox("Modify event", e.switches?.modify_event ?? false);
    const inviteBox = checkbox("Invite others", e.switches?.invite_others ?? false);
    const listSwitch = checkbox("See guest list", e.switches?.see_guest_list ?? false);
    for (const box of [modifyBox, inviteBox, listSwitch]) {
      box.addEventListener("change", async () => {
        try {
          await api.patchEvent(e.id, {
            switches: { modify_event: modifyBox.checked, invite_others: inviteBox.checked, see_guest_list: listSwitch.checked },
            scope: "all",
          }, etag);
          if (!listSwitch.checked && box === listSwitch) {
            announce("Guest list hidden. The shared link no longer works.");
          } else {
            announce("Saved.");
          }
          location.reload();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      });
      switches.appendChild(box.parentElement ?? box);
    }
    main.appendChild(switches);

    const inviteSel = combobox("Invite person", state.people.map((p) => ({ value: p.id, label: p.name })));
    main.append(
      h("div", { class: "row" },
        inviteSel,
        button("Invite", { class: "btn ghost", onclick: async () => {
          try {
            await api.addGuests(e.id, [inviteSel.value]);
            announce(`Invited ${inviteSel.options[inviteSel.selectedIndex].text}.`);
            location.reload();
          } catch (err) {
            announce(err instanceof Error ? err.message : "Something went wrong.");
          }
        } }, "Invite")
      )
    );
    if (e.guests) {
      for (const g of e.guests) {
        main.appendChild(button(`Remove ${g.name}`, { class: "btn ghost", onclick: async () => {
          try {
            await api.removeGuest(e.id, g.person_id);
            announce(`Removed ${g.name}.`);
            location.reload();
          } catch (err) {
            announce(err instanceof Error ? err.message : "Something went wrong.");
          }
        } }, `Remove ${g.name}`));
      }
    }
    if (e.share_link) {
      main.append(
        button("Copy shared link", { class: "btn ghost", onclick: () => {
          void navigator.clipboard?.writeText(location.origin + e.share_link!.url);
          announce("Link copied.");
        } }, "Copy shared link"),
        button("New shared link", { class: "btn ghost", onclick: async () => {
          try {
            await api.createShareLink(e.id);
            announce("New link created.");
            location.reload();
          } catch (err) {
            announce(err instanceof Error ? err.message : "Something went wrong.");
          }
        } }, "New shared link"),
        button("Turn off shared link", { class: "btn ghost", onclick: async () => {
          await api.deleteShareLink(e.id);
          announce("Link turned off.");
          location.reload();
        } }, "Turn off shared link")
      );
    } else {
      main.appendChild(button("New shared link", { class: "btn ghost", onclick: async () => {
        try {
          await api.createShareLink(e.id);
          announce("New link created.");
          location.reload();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      } }, "New shared link"));
    }
    main.append(
      button("Edit", { class: "btn ghost", onclick: () => openEditDialog(e, () => location.reload()) }, "Edit"),
      button("Duplicate", { class: "btn ghost", onclick: async () => {
        announce(`Duplicating ${e.title}...`);
        const { data } = await api.duplicate(e.id);
        announce(`Duplicated ${data.title}.`);
        location.reload();
      } }, "Duplicate")
    );
    const moveSel = combobox("Move to calendar", state.calendars.filter((c) => c.level === "owner" || c.level === "edit" || c.level === "manage").map((c) => ({ value: c.id, label: c.name })));
    main.appendChild(h("div", { class: "row" },
      moveSel,
      button("Move to calendar", { class: "btn ghost", onclick: async () => {
        announce(`Moving ${e.title}...`);
        try {
          const { data } = await api.moveToCalendar(e.id, moveSel.value, etag);
          announce(`Moved ${data.title} to ${moveSel.options[moveSel.selectedIndex].text}.`);
          location.reload();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      } }, "Move to calendar")
    ));
  }

  // Escape returns to the grid on the same event
  document.onkeydown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) {
        return;
      }
      history.pushState(null, "", `/calendar?view=week&date=${e.start_local.split("T")[0]}&focus=${encodeURIComponent(e.id)}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };
  main.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "s" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      if (canEdit) openEditDialog(e, () => location.reload());
    }
  });
  app.appendChild(main);
}

function answerLabel(a: string): string {
  return a === "yes" ? "Yes" : a === "no" ? "No" : a === "maybe" ? "Maybe" : "Waiting";
}

function openProposalDialog(e: EventDetail, occurrenceId: string): void {
  const dlg = dialog("Propose a new time");
  const start = textbox("Starts", e.all_day ? e.start_local : `${e.start_local.split("T")[0]} ${e.start_local.split("T")[1]}`);
  const end = textbox("Ends", e.all_day ? e.end_local : `${e.end_local.split("T")[0]} ${e.end_local.split("T")[1]}`);
  const note = textbox("Note", "");
  dlg.append(
    start, end, note,
    h("div", { class: "dialog-actions" },
      button("Cancel", { class: "btn ghost", onclick: () => dlg.close() }, "Cancel"),
      button("Send proposal", { class: "btn accent", onclick: async () => {
        announce("Sending your proposal...");
        try {
          await api.propose(e.id, occurrenceId, start.value, end.value, note.value);
          announce(`Your proposal for ${e.title} is sent.`);
          dlg.close();
          location.reload();
        } catch (err) {
          announce(err instanceof Error ? err.message : "Something went wrong.");
        }
      } }, "Send proposal")
    )
  );
  document.body.appendChild(dlg);
  dlg.showModal();
  focusTrap(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  start.focus();
}
