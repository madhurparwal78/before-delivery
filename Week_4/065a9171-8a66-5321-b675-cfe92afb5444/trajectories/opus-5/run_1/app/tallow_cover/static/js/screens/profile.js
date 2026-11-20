// "Profile": the display name editor.

import { OFFLINE, api } from "../api.js";
import { el, errorSlot, say, showFieldErrors, statusRegion } from "../dom.js";

export async function render({ me }) {
  const status = statusRegion("Profile status");
  const name = el("input", { type: "text", "aria-label": "Display name", value: me.display_name });
  const form = el(
    "form",
    { "aria-label": "Profile" },
    el("label", {}, "Display name", name),
    errorSlot("display_name"),
    el("button", { type: "submit", text: "Save name" })
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFieldErrors(form, {});
    say(status, "Saving…");
    try {
      const updated = await api.patch("/api/me", { display_name: name.value });
      me.display_name = updated.display_name;
      say(status, "Name updated.");
    } catch (error) {
      showFieldErrors(form, error.errors || {});
      say(status, error.status === 0 ? OFFLINE : error.message);
    }
  });
  return el("div", {}, el("h1", { text: "Profile" }), el("section", { class: "panel" }, form, status));
}
