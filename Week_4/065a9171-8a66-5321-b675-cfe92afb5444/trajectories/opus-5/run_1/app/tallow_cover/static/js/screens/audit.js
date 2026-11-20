// "Audit log": newest first, with the actor's name as it was when written.

import { api } from "../api.js";
import { el, select } from "../dom.js";
import { homesFor } from "../homes.js";

function brief(state) {
  if (state === null || state === undefined) return "";
  return JSON.stringify(state);
}

export async function render({ me, query, navigate }) {
  const homes = homesFor(me);
  const homeId = query.get("home") || me.home_id || homes[0]?.id;
  const payload = await api.get(`/api/audit?home=${homeId}`);
  const body = el("tbody", {});
  for (const entry of payload.items) {
    body.append(
      el(
        "tr",
        {},
        el("td", { dataset: { label: "When" }, text: entry.at }),
        el("td", { dataset: { label: "Who" }, text: entry.actor.display_name }),
        el("td", { dataset: { label: "Action" }, text: entry.action }),
        el("td", { dataset: { label: "Target" }, text: `${entry.target.type} ${entry.target.id}` }),
        el("td", { dataset: { label: "Before" }, text: brief(entry.before) }),
        el("td", { dataset: { label: "After" }, text: brief(entry.after) }),
        el("td", { dataset: { label: "Reason" }, text: entry.reason || "" })
      )
    );
  }
  const homePicker =
    homes.length > 1
      ? select("Home", homes.map((home) => ({ value: home.id, label: home.name })), homeId)
      : null;
  if (homePicker) {
    homePicker.addEventListener("change", () => navigate(`/audit?home=${homePicker.value}`));
  }
  return el(
    "div",
    {},
    el("h1", { text: "Audit log" }),
    homePicker ? el("div", { class: "row" }, el("label", {}, "Home", homePicker)) : null,
    el(
      "section",
      { class: "panel" },
      el(
        "table",
        { class: "cards", "aria-label": "Audit log" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ["When", "Who", "Action", "Target", "Before", "After", "Reason"].map((name) =>
              el("th", { text: name })
            )
          )
        ),
        body
      )
    )
  );
}
