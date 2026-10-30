// "Open cover": the cover shifts this bank carer may claim.

import { OFFLINE, api, newKey } from "../api.js";
import { clear, el, say, statusRegion } from "../dom.js";
import { SKILL_LABELS, clockTime, shiftLabel } from "../format.js";

export async function render() {
  const status = statusRegion("Cover status");
  const list = el("ul", { class: "plain", "aria-label": "Open cover shifts" });
  const empty = el("p", { text: "No open cover shifts right now." });

  async function load() {
    const payload = await api.get("/api/cover-shifts");
    clear(list);
    empty.hidden = payload.items.length > 0;
    for (const item of payload.items) {
      list.append(buildItem(item));
    }
  }

  function buildItem(item) {
    const label = shiftLabel(item.date, item.shift);
    let pendingKey = null;
    const claim = el("button", {
      type: "button",
      "aria-label": `Claim ${label} at ${item.home.name}`,
      text: "Claim",
      onclick: async () => {
        if (claim.disabled) return;
        claim.disabled = true;
        say(status, "Claiming…");
        pendingKey = pendingKey || newKey();
        try {
          await api.post(`/api/cover-shifts/${item.id}/claim`, {}, { "Idempotency-Key": pendingKey });
          row.remove();
          say(status, `Shift claimed: ${label} at ${item.home.name}.`);
          empty.hidden = list.children.length > 0;
          return;
        } catch (error) {
          if (error.code === "already_taken" || error.code === "cover_closed") {
            row.remove();
            empty.hidden = list.children.length > 0;
            say(status, error.message);
            return;
          }
          say(status, error.status === 0 ? OFFLINE : error.message);
          if (error.status !== 0) pendingKey = null;
        }
        claim.disabled = false;
      },
    });
    const row = el(
      "li",
      {},
      el("span", {
        text: `${item.home.name} · ${item.unit.name} · ${label} · ${clockTime(
          item.starts_at
        )}–${clockTime(item.ends_at)} · ${SKILL_LABELS[item.skill]}`,
      }),
      claim
    );
    return row;
  }

  await load();
  return el(
    "div",
    {},
    el("h1", { text: "Open cover" }),
    el("section", { class: "panel" }, status, list, empty)
  );
}
