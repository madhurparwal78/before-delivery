import { request } from "../api.js";
import { type Screen } from "../app.js";
import { copy } from "../copy.js";
import { clear, el, field, setFieldError } from "../dom.js";

/** The registration form: one centred column at every viewport. */
export const registerScreen: Screen = (app) => {
  const radioBid = el("input", { type: "radio", name: "join-as", value: "bidder" });
  const radioConsign = el("input", { type: "radio", name: "join-as", value: "consignor" });
  const roleGroup = el(
    "div",
    { class: "radiogroup", role: "radiogroup", "aria-label": "I am joining to" },
    [
      el("label", { class: "radio" }, [radioBid, el("span", { text: "Bid" })]),
      el("label", { class: "radio" }, [radioConsign, el("span", { text: "Consign" })]),
    ],
  );
  const roleError = el("p", { class: "field-error", id: "join-as-error" });
  const nameInput = el("input", { type: "text", autocomplete: "name" });
  const phoneInput = el("input", { type: "text", autocomplete: "tel" });
  const addressInput = el("input", { type: "text", autocomplete: "street-address" });
  const submit = el("button", { type: "submit", class: "action", text: "Register" });
  const note = el("p", { class: "form-note" });

  const form = el("form", { class: "form" }, [
    el("h1", { text: "Register with Gavelhouse" }),
    roleGroup,
    roleError,
    field("Full name", nameInput, "full-name-error"),
    field("Phone", phoneInput, "phone-error"),
    field("Address", addressInput, "address-error"),
    submit,
    note,
  ]);

  clear(app.root);
  app.root.className = "page page-register";
  app.root.append(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const role = radioBid.checked ? "bidder" : radioConsign.checked ? "consignor" : "";
    roleError.textContent = "";
    for (const [input, id] of [
      [nameInput, "full-name-error"],
      [phoneInput, "phone-error"],
      [addressInput, "address-error"],
    ] as [HTMLElement, string][]) {
      setFieldError(input, id, "");
    }
    submit.disabled = true;
    note.textContent = copy.registerPending;
    const result = await request<{ landing: string }>("POST", "/api/register", {
      role,
      full_name: nameInput.value,
      phone: phoneInput.value,
      address: addressInput.value,
    });
    submit.disabled = false;
    if (result.status === 201 && result.body.landing) {
      window.location.assign(result.body.landing);
      return;
    }
    note.textContent = "";
    const fields = result.body.fields ?? {};
    if (fields.role) roleError.textContent = fields.role;
    if (fields.full_name) setFieldError(nameInput, "full-name-error", fields.full_name);
    if (fields.phone) setFieldError(phoneInput, "phone-error", fields.phone);
    if (fields.address) setFieldError(addressInput, "address-error", fields.address);
    if (Object.keys(fields).length === 0) {
      note.textContent = result.body.message ?? copy.serverFailure;
    }
    app.say.result(note.textContent || Object.values(fields).join(" "));
  });
};
