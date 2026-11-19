import type { NewPerson, Person } from "../../shared/api.js";
import { api, heldKey, holdKey } from "../api.js";
import { openDialog } from "../dialog.js";
import { h } from "../dom.js";
import { field, navigate } from "../page.js";

// "Your details" (brief: Interactions › Studio): create a person and show the key once, or adopt a key.

export function startCampaign(opener: HTMLElement): void {
  if (heldKey()) {
    navigate("/studio/campaigns/new");
    return;
  }
  const name = field("yd-name", "Name", h("input", { type: "text", autocomplete: "name", maxlength: 80 }));
  const email = field("yd-email", "Email", h("input", { type: "email", autocomplete: "email", maxlength: 254 }));
  const key = field("yd-key", "Key", h("input", { type: "text", autocomplete: "off", spellcheck: "false" }));
  const status = h("p", { class: "dialog-status", role: "status" });
  const cont = h("button", { type: "submit", class: "btn" }, "Continue");
  const useKey = h("button", { type: "button", class: "btn btn-quiet" }, "Use key");
  const create = h("form", { class: "dialog-form", novalidate: true }, name.wrap, email.wrap, h("div", { class: "actions" }, cont));
  const adopt = h("div", { class: "dialog-form adopt" }, h("h3", {}, "Already have a key?"), key.wrap, h("div", { class: "actions" }, useKey));
  const body = h("div", { class: "dialog-body" }, create, adopt, status);
  const dialog = h("dialog", { class: "dialog", "aria-labelledby": "yd-title" }, h("h2", { id: "yd-title" }, "Your details"), body);
  const open = openDialog(dialog, opener, name.input);
  const finish = () => {
    open.close(null);
    navigate("/studio/campaigns/new");
  };

  create.addEventListener("submit", async (event) => {
    event.preventDefault();
    name.set(name.input.value.trim() ? null : "Enter your name.");
    email.set(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.input.value.trim()) ? null : "Enter an email address.");
    const wrong = [name, email].find((f) => f.error.textContent);
    if (wrong) {
      wrong.input.focus();
      return;
    }
    cont.disabled = true;
    const made = await api<NewPerson>("POST", "/api/people", { body: { name: name.input.value.trim(), email: email.input.value.trim() }, key: null });
    cont.disabled = false;
    if (!made.ok) {
      name.set(made.error.fields?.name ?? null);
      email.set(made.error.fields?.email ?? null);
      status.textContent = made.error.fields ? "" : "Something went wrong. Try again.";
      return;
    }
    holdKey(made.data.key);
    const done = h("button", { type: "button", class: "btn" }, "Done");
    done.addEventListener("click", finish);
    body.replaceChildren(
      h("p", { class: "key-line" }, "Your Dotgain key: ", h("code", { class: "key" }, made.data.key)),
      h("p", { class: "hint" }, "Keep it somewhere safe: it is shown only once, and it is how you sign in on another device."),
      h("div", { class: "actions" }, done));
    done.focus();
  });

  useKey.addEventListener("click", async () => {
    const value = key.input.value.trim();
    if (!value) {
      key.set("Paste your Dotgain key.");
      key.input.focus();
      return;
    }
    useKey.disabled = true;
    const me = await api<Person>("GET", "/api/me", { key: value });
    useKey.disabled = false;
    if (!me.ok) {
      key.set("That key was not recognised.");
      key.input.focus();
      return;
    }
    holdKey(value);
    finish();
  });
}
