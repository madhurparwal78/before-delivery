// Team rota: one unit's week as days by shifts; managers and HR add and remove colleagues.
import { del, get, post, query } from "../api.js";
import { dialog } from "../dialog.js";
import { h, say, status } from "../dom.js";
import { SHIFT_NAMES, addDays, fmtDate, shiftLabel } from "../format.js";
import { panel, screen, showAfter } from "./common.js";

const SHIFTS = ["early", "late", "night"];

// An ARIA combobox over the people picker: type to search, Arrow keys to move, Enter to choose.
function colleaguePicker(homeId) {
  const listId = "colleague-options";
  const input = h("input", { type: "text", role: "combobox", id: "colleague", autocomplete: "off",
    "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId });
  const list = h("ul", { role: "listbox", id: listId, class: "options", "aria-label": "Colleagues" });
  let items = [];
  let active = -1;
  let chosen = null;
  let search = Promise.resolve();

  function paint() {
    list.replaceChildren(...items.map((p, i) => h("li", {
      role: "option", id: `colleague-${i}`, "aria-selected": String(i === active), class: i === active ? "active" : null,
      onmousedown: (event) => {
        event.preventDefault();
        choose(i);
      },
    }, h("span", { text: p.display_name }), h("span", { class: "meta", text: ` ${p.id} · ${p.role === "bank_carer" ? "Bank" : "Staff"}` }))));
    input.setAttribute("aria-expanded", String(items.length > 0));
    if (active >= 0) input.setAttribute("aria-activedescendant", `colleague-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function choose(i) {
    chosen = items[i];
    input.value = chosen.display_name;
    items = [];
    active = -1;
    paint();
  }

  input.addEventListener("input", () => {
    chosen = null;
    const q = input.value;
    search = get(`/api/homes/${homeId}/people?${query({ q })}`).then((body) => {
      if (input.value !== q) return;
      items = body.items;
      active = -1;
      paint();
    });
  });
  input.addEventListener("keydown", async (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    event.preventDefault();
    await search;
    if (!items.length) return;
    if (event.key === "ArrowDown") active = Math.min(items.length - 1, active + 1);
    else if (event.key === "ArrowUp") active = Math.max(0, active - 1);
    else if (active >= 0) return choose(active);
    paint();
  });
  return {
    el: h("div", { class: "field combo" }, h("label", { for: "colleague", text: "Colleague" }), input, list),
    input,
    chosen: () => chosen,
    reset() {
      input.value = "";
      chosen = null;
      items = [];
      active = -1;
      paint();
    },
  };
}

function unitOf(boot, unitId) {
  for (const home of boot.homes) {
    const unit = home.units.find((u) => u.id === unitId);
    if (unit) return { home, unit };
  }
  return null;
}

export function rota(work, { me, boot }) {
  const params = new URLSearchParams(location.search);
  const managers = ["unit_manager", "hr_admin"].includes(me.role);
  const unitId = managers ? (params.get("unit") && unitOf(boot, params.get("unit")) ? params.get("unit") : boot.homes[0].units[0].id)
    : me.unit_id;
  const place = unitOf(boot, unitId);
  let from = params.get("from");
  const region = status("Rota status");
  const holder = h("div", { class: "rota-holder" }, h("p", { class: "meta", text: "Loading…" }));
  const range = h("p", { class: "week-range" });
  const prev = h("button", { type: "button", class: "secondary", text: "Previous week" });
  const next = h("button", { type: "button", class: "secondary", text: "Next week" });
  const picker = managers ? colleaguePicker(place.home.id) : null;
  const confirm = h("button", { type: "submit", class: "primary", text: "Add to shift" });
  const target = h("p", { class: "meta" });
  const addForm = h("form", { novalidate: true, class: "stack" }, target, picker?.el, confirm);
  const box = managers ? dialog("Add to shift", addForm) : null;
  let slot = null;

  async function load(start) {
    const body = await get(`/api/units/${unitId}/rota${start ? `?${query({ from: start })}` : ""}`);
    from = body.from;
    history.replaceState(null, "", `/rota?${query({ unit: managers ? unitId : undefined, from })}`);
    range.textContent = `${fmtDate(body.from)} to ${fmtDate(body.to)}`;
    const days = Array.from({ length: 7 }, (_, i) => addDays(body.from, i));
    const rows = days.map((d) => h("tr", { role: "row" },
      h("th", { scope: "row", role: "rowheader", text: fmtDate(d) }),
      SHIFTS.map((s) => {
        const label = shiftLabel(d, s);
        const here = body.entries.filter((e) => e.date === d && e.shift === s);
        return h("td", { role: "cell", "data-label": SHIFT_NAMES[s] },
          h("ul", { class: "names" }, here.map((e) => h("li", { class: e.status === "away" ? "away" : null },
            h("span", { class: e.is_you ? "you" : null, text: e.person.display_name }),
            e.status === "away" ? h("span", { class: "tag", text: "away" }) : null,
            managers ? h("button", { type: "button", class: "icon-button", "aria-label": `Remove ${e.person.display_name} from ${label}`,
              text: "×", onclick: (event) => remove(event.currentTarget, e, label) }) : null))),
          managers ? h("button", { type: "button", class: "add", "aria-label": `Add to ${label}`, text: "+ Add",
            onclick: (event) => openAdd(event.currentTarget, d, s) }) : null);
      })));
    holder.replaceChildren(h("table", { class: "rota", "aria-label": "Team rota", role: "table" },
      h("thead", { role: "rowgroup" }, h("tr", { role: "row" }, h("th", { scope: "col", role: "columnheader", text: "Day" }),
        SHIFTS.map((s) => h("th", { scope: "col", role: "columnheader", text: SHIFT_NAMES[s] })))),
      h("tbody", { role: "rowgroup" }, rows)));
  }

  function openAdd(opener, date, shift) {
    slot = { date, shift };
    target.textContent = `${place.unit.name} · ${shiftLabel(date, shift)}`;
    picker.reset();
    box.open(opener, picker.input);
  }

  async function remove(button, entry, label) {
    button.disabled = true;
    say(region, "Saving…", "pending");
    try {
      await del(`/api/rota/assignments/${entry.assignment_id}`);
      say(region, `${entry.person.display_name} removed from ${label}.`, "success");
      await load(from);
    } catch (error) {
      say(region, error.message, "error");
      button.disabled = false;
    }
  }

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const person = picker.chosen();
    if (!person) return say(region, "Choose a colleague from the list.", "error");
    confirm.disabled = true;
    say(region, "Saving…", "pending");
    try {
      await post("/api/rota/assignments", { person_id: person.id, unit_id: unitId, date: slot.date, shift: slot.shift });
      await box.close();
      say(region, `${person.display_name} added to ${shiftLabel(slot.date, slot.shift)}.`, "success");
      await load(from);
    } catch (error) {
      say(region, error.body?.errors ? Object.values(error.body.errors).join(" ") : error.message, "error");
    } finally {
      confirm.disabled = false;
    }
  });
  prev.addEventListener("click", () => load(addDays(from, -7)).catch((error) => say(region, error.message, "error")));
  next.addEventListener("click", () => load(addDays(from, 7)).catch((error) => say(region, error.message, "error")));

  showAfter(work, load(from).catch((error) => say(region, error.message, "error")), screen("Team rota",
    panel(`${place.home.name} · ${place.unit.name}`, h("div", { class: "week-bar" }, prev, range, next), region, holder)));
}
