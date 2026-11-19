// Sign-in: email and password, then the role's landing route.
import { h } from "../dom.js";
import { api, ApiError, session } from "../api.js";
import { problems } from "../problems.js";
import { pylon } from "../art.js";

export function mount({ container, navigate }) {
  const email = h("input", { id: "email", type: "email", autocomplete: "username" });
  const password = h("input", { id: "password", type: "password", autocomplete: "current-password" });
  const list = problems();
  const submit = h("button", { type: "submit", text: "Sign in" });
  const form = h("form", { class: "stack", novalidate: "" },
    h("label", { for: "email", text: "Email" }), email,
    h("label", { for: "password", text: "Password" }), password, list.el, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.setAttribute("aria-disabled", "true");
    try {
      const { user, landing_url: landing } = await api("POST", "/api/auth/sign-in", { email: email.value, password: password.value });
      session.user = user;
      navigate(landing);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      list.show(error.message, []);
    } finally {
      submit.removeAttribute("aria-disabled");
    }
  });
  container.replaceChildren(h("section", { class: "page field-yellow" },
    pylon("cutout cutout-pylon"),
    h("div", { class: "center" }, h("h1", { text: "SIGN IN." }), form)));
  return { unmount() {} };
}
