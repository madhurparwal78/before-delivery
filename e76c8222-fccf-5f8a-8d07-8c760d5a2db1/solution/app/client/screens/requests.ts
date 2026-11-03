// The requester's table of their organisation's requests.
import type { RequestView } from "../../shared/api.js";
import { SETTING_LABELS } from "../../shared/domain.js";
import { get } from "../api.js";
import type { Screen } from "../app.js";
import { h } from "../dom.js";
import { emptyNote, when } from "../ui.js";

export async function requestsScreen({ main }: Screen): Promise<void> {
  const holder = h("div", { "aria-busy": "true" }, h("p", { class: "empty" }, "Loading requests…"));
  main.append(
    h(
      "section",
      { class: "sheet" },
      h("div", { class: "title-row" }, h("h1", {}, "Requests"), h("a", { class: "button primary", href: "/requests/new" }, "New request")),
      h("p", { class: "lede" }, "Every request your organisation has made, newest start first."),
      holder,
    ),
  );
  const result = await get<{ requests: RequestView[] }>("/api/requests");
  holder.replaceChildren();
  holder.removeAttribute("aria-busy");
  if (!result.ok) {
    holder.append(emptyNote("Requests could not be loaded. Reload the page to try again."));
    return;
  }
  const requests = result.data.requests;
  if (!requests.length) {
    holder.append(emptyNote("No requests yet. Start one with New request."));
    return;
  }
  const head = ["Ref", "Title", "Setting", "Start", "Status", "Seats"];
  holder.append(
    h(
      "table",
      { class: "table", "aria-label": "Requests" },
      h("thead", {}, h("tr", {}, head.map((c) => h("th", { scope: "col" }, c)))),
      h(
        "tbody",
        {},
        requests.map((r) =>
          h(
            "tr",
            {},
            h("td", { "data-label": "Ref" }, h("a", { class: "fig", href: `/requests/${r.id}` }, r.ref)),
            h("td", { "data-label": "Title" }, r.title),
            h("td", { "data-label": "Setting" }, SETTING_LABELS[r.setting]),
            h("td", { "data-label": "Start", class: "fig" }, when(r.start, r.end)),
            h("td", { "data-label": "Status" }, h("span", { class: "state" }, r.status)),
            h("td", { "data-label": "Seats", class: "fig" }, `${r.seats_accepted}/${r.seats_total}`),
          ),
        ),
      ),
    ),
  );
}
