// A Deaf consumer marks each interpreter Preferred, No preference or Blocked, then saves all at once.
import type { MyPreferences } from "../../shared/api.js";
import { call, get } from "../api.js";
import type { Screen } from "../app.js";
import { h, say, statusRegion } from "../dom.js";
import { button, emptyNote } from "../ui.js";

type Choice = "preferred" | "none" | "blocked";
const CHOICES: [Choice, string][] = [
  ["preferred", "Preferred"],
  ["none", "No preference"],
  ["blocked", "Blocked"],
];

export async function preferencesScreen({ main }: Screen): Promise<void> {
  const status = statusRegion("Preferences status");
  const holder = h("div", { class: "sheet-flow" }, emptyNote("Loading interpreters…"));
  const save = button("Save preferences");
  main.append(
    h(
      "section",
      { class: "sheet" },
      h("h1", {}, "Interpreter preferences"),
      h(
        "p",
        { class: "lede" },
        "Dispatch never offers a request for you to an interpreter you block. Interpreters you prefer are shown to coordinators when they staff your requests.",
      ),
      holder,
    ),
  );
  const result = await get<MyPreferences>("/api/consumers/me/preferences");
  if (!result.ok) {
    holder.replaceChildren(emptyNote("Preferences could not be loaded. Reload the page to try again."));
    return;
  }
  const { interpreters, preferred, blocked } = result.data;
  const rows = interpreters.map((person) => {
    const current: Choice = preferred.includes(person.id) ? "preferred" : blocked.includes(person.id) ? "blocked" : "none";
    const group = h(
      "div",
      { role: "radiogroup", "aria-label": person.name, class: "choices" },
      CHOICES.map(([value, label]) =>
        h("label", { class: "choice" }, h("input", { type: "radio", name: `pref-${person.id}`, value, checked: value === current }), h("span", {}, label)),
      ),
    );
    return { person, group, row: h("tr", {}, h("th", { scope: "row", "data-label": "Interpreter" }, person.name), h("td", { "data-label": "Choice" }, group)) };
  });
  holder.replaceChildren(
    h(
      "table",
      { class: "table prefs", "aria-label": "Interpreter preferences" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Interpreter"), h("th", { scope: "col" }, "Your choice"))),
      h(
        "tbody",
        {},
        rows.map((r) => r.row),
      ),
    ),
    h("div", { class: "actions" }, save),
    status,
  );
  save.addEventListener("click", async () => {
    const chosen = (want: Choice): string[] =>
      rows.filter((r) => r.group.querySelector<HTMLInputElement>("input:checked")?.value === want).map((r) => r.person.id);
    say(status, "Saving preferences…");
    save.disabled = true;
    const sent = await call<{ preferred: string[]; blocked: string[] }>("PUT", "/api/consumers/me/preferences", { preferred: chosen("preferred"), blocked: chosen("blocked") });
    save.disabled = false;
    if (sent.ok) say(status, "Preferences saved.");
    else say(status, sent.error.code === "validation" ? "An interpreter cannot be both preferred and blocked." : "Preferences could not be saved. Try again.");
  });
}
