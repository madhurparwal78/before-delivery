// Timesheet exports and their downloads.

import { OFFLINE, api, openDownload } from "../api.js";
import { clear, el, errorSlot, say, showFieldErrors, statusRegion } from "../dom.js";
import { monthLabel } from "../format.js";
import { homesFor } from "../homes.js";

function failureText(error) {
  return error.status === 0 ? OFFLINE : error.message;
}

export async function render({ me }) {
  const homes = homesFor(me);
  const status = statusRegion("Admin status");
  const list = el("ul", { class: "plain", "aria-label": "Exports" });
  const period = el("input", { type: "text", "aria-label": "Pay period", placeholder: "YYYY-MM" });
  const boxes = homes.map((home) => ({
    home,
    box: el("input", { type: "checkbox", "aria-label": home.name }),
  }));
  const form = el(
    "form",
    { "aria-label": "Export timesheets" },
    el("label", {}, "Pay period", period),
    errorSlot("period"),
    el(
      "div",
      { role: "group", "aria-label": "Homes" },
      boxes.map(({ home, box }) => el("label", {}, box, home.name))
    ),
    errorSlot("home_ids"),
    el("button", { type: "submit", text: "Export timesheets" })
  );

  async function load() {
    const payload = await api.get("/api/exports");
    clear(list);
    for (const item of payload.items) {
      list.append(
        el(
          "li",
          {},
          el("span", { text: `${monthLabel(item.period)} · ${item.row_count} rows · ${item.storage}` }),
          el("button", {
            class: "quiet",
            type: "button",
            "aria-label": `Download ${item.period} export`,
            text: "Download",
            onclick: async () => {
              say(status, "Opening…");
              try {
                await openDownload(`/api/exports/${item.id}/download`);
              } catch (error) {
                say(status, failureText(error));
              }
            },
          })
        )
      );
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFieldErrors(form, {});
    say(status, "Preparing export…");
    try {
      const created = await api.post("/api/exports/timesheets", {
        period: period.value,
        home_ids: boxes.filter(({ box }) => box.checked).map(({ home }) => home.id),
      });
      say(status, `Timesheet export created: ${created.row_count} rows.`);
      await load();
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      say(status, failureText(error));
    }
  });

  await load();
  return el(
    "div",
    {},
    el("h1", { text: "Exports" }),
    el("section", { class: "panel" }, form, status),
    el("section", { class: "panel" }, el("h2", { text: "Earlier exports" }), list)
  );
}
