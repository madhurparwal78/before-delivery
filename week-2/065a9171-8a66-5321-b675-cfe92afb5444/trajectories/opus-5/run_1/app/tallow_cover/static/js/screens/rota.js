// "Team rota": one unit's week as seven days by three shifts, with add and remove.

import { OFFLINE, api } from "../api.js";
import { clear, el, openDialog, say, select, statusRegion } from "../dom.js";
import { SHIFTS, SHIFT_LABELS, addDays, dayHeading, mondayOf, shiftLabel } from "../format.js";
import { unitsFor } from "../homes.js";

const MANAGER_ROLES = ["unit_manager", "hr_admin"];

function failureText(error) {
  return error.status === 0 ? OFFLINE : error.message;
}

export async function render({ me, query, navigate }) {
  const status = statusRegion("Rota status");
  const units = me.role === "care_worker" ? [{ id: me.unit_id, name: "My unit" }] : unitsFor(me);
  const unitId = query.get("unit") || me.unit_id || units[0]?.id;
  const canEdit = MANAGER_ROLES.includes(me.role);
  let from = query.get("from") || mondayOf(new Date().toISOString().slice(0, 10));
  const table = el("table", { class: "cards", "aria-label": "Team rota" });

  function pathFor(nextFrom) {
    return `/rota?unit=${unitId}&from=${nextFrom}`;
  }

  async function load() {
    const payload = await api.get(`/api/units/${unitId}/rota?from=${from}`);
    from = payload.from;
    const days = [];
    for (let offset = 0; offset < 7; offset += 1) days.push(addDays(payload.from, offset));
    clear(table);
    table.append(
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { text: "Shift" }),
          days.map((day) => el("th", { text: dayHeading(day) }))
        )
      )
    );
    const body = el("tbody", {});
    for (const shift of SHIFTS) {
      const cells = days.map((day) => {
        const entries = payload.entries.filter(
          (entry) => entry.date === day && entry.shift === shift
        );
        const cell = el("td", { dataset: { label: `${SHIFT_LABELS[shift]} ${dayHeading(day)}` } });
        for (const entry of entries) {
          cell.append(
            el(
              "div",
              { class: "row tight" },
              el("span", {
                text:
                  entry.status === "away"
                    ? `${entry.person.display_name} away`
                    : entry.person.display_name,
              }),
              canEdit
                ? el("button", {
                    class: "quiet compact",
                    type: "button",
                    "aria-label": `Remove ${entry.person.display_name} from ${shiftLabel(day, shift)}`,
                    text: "\u2212",
                    onclick: () => removeEntry(entry, day, shift),
                  })
                : null
            )
          );
        }
        if (canEdit) {
          cell.append(
            el("button", {
              class: "quiet compact",
              type: "button",
              "aria-label": `Add to ${shiftLabel(day, shift)}`,
              text: "+",
              onclick: (event) => openAdd(day, shift, event.currentTarget),
            })
          );
        }
        return cell;
      });
      body.append(el("tr", {}, el("th", { scope: "row", text: SHIFT_LABELS[shift] }), cells));
    }
    table.append(body);
  }

  async function removeEntry(entry, day, shift) {
    say(status, "Saving…");
    try {
      await api.remove(`/api/rota/assignments/${entry.assignment_id}`);
      say(status, `${entry.person.display_name} removed from ${shiftLabel(day, shift)}.`);
      await load();
    } catch (error) {
      say(status, failureText(error));
    }
  }

  function openAdd(day, shift, opener) {
    const search = el("input", {
      type: "text",
      role: "combobox",
      "aria-label": "Colleague",
      "aria-expanded": "false",
      "aria-autocomplete": "list",
      "aria-controls": "colleague-options",
      autocomplete: "off",
    });
    const options = el("ul", { class: "plain", role: "listbox", id: "colleague-options" });
    let chosen = null;
    let active = -1;

    async function searchPeople() {
      const payload = await api.get(
        `/api/homes/${me.role === "hr_admin" ? homeOfUnit(unitId) : me.home_id}/people?q=${encodeURIComponent(
          search.value
        )}`
      );
      clear(options);
      active = -1;
      payload.items.forEach((candidate) => {
        options.append(
          el("li", {
            role: "option",
            tabindex: "-1",
            "aria-selected": "false",
            text: candidate.display_name,
            onclick: () => {
              chosen = candidate;
              search.value = candidate.display_name;
            },
          })
        );
      });
      search.setAttribute("aria-expanded", payload.items.length ? "true" : "false");
      return payload.items;
    }

    let found = [];
    search.addEventListener("input", async () => {
      found = await searchPeople();
      chosen = null;
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!found.length) return;
        active = Math.min(found.length - 1, Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1)));
        [...options.children].forEach((node, index) =>
          node.setAttribute("aria-selected", index === active ? "true" : "false")
        );
        chosen = found[active];
        search.value = chosen.display_name;
      }
      if (event.key === "Enter" && chosen) event.preventDefault();
    });

    const confirm = el("button", {
      type: "button",
      text: "Add to shift",
      onclick: async () => {
        const target = chosen || found[0];
        if (!target) return;
        say(status, "Saving…");
        try {
          await api.post("/api/rota/assignments", {
            person_id: target.id,
            unit_id: unitId,
            date: day,
            shift,
          });
          dialog.close();
          say(status, `${target.display_name} added to ${shiftLabel(day, shift)}.`);
          await load();
        } catch (error) {
          say(status, failureText(error));
        }
      },
    });
    const dialog = el(
      "dialog",
      { "aria-label": "Add to shift" },
      el("h2", { text: "Add to shift" }),
      el("label", {}, "Colleague", search),
      options,
      el(
        "div",
        { class: "row" },
        confirm,
        el("button", { class: "quiet", type: "button", text: "Close", onclick: () => dialog.close() })
      )
    );
    openDialog(dialog, search, opener);
    searchPeople().then((items) => {
      found = items;
    });
  }

  function homeOfUnit(id) {
    return id.split("-")[0];
  }

  await load();
  const unitPicker =
    units.length > 1
      ? select(
          "Unit",
          units.map((unit) => ({ value: unit.id, label: unit.name })),
          unitId
        )
      : null;
  if (unitPicker) {
    unitPicker.addEventListener("change", () => navigate(`/rota?unit=${unitPicker.value}&from=${from}`));
  }
  return el(
    "div",
    {},
    el("h1", { text: "Team rota" }),
    el(
      "section",
      { class: "panel" },
      el(
        "div",
        { class: "row" },
        unitPicker,
        el("button", {
          class: "quiet",
          type: "button",
          text: "Previous week",
          onclick: () => navigate(pathFor(addDays(from, -7))),
        }),
        el("button", {
          class: "quiet",
          type: "button",
          text: "Next week",
          onclick: () => navigate(pathFor(addDays(from, 7))),
        })
      ),
      status
    ),
    el("section", { class: "panel" }, table)
  );
}
