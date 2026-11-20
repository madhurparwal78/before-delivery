// Sign in and the profile's display name.
import { ApiError, patch, post } from "../api.js";
import { field, h, say, status } from "../dom.js";
import { panel, screen } from "./common.js";

export function signIn({ firstScreen }) {
  const email = h("input", { type: "email", autocomplete: "username", required: true });
  const password = h("input", { type: "password", autocomplete: "current-password", required: true });
  const region = status("Sign-in status");
  const button = h("button", { type: "submit", class: "primary", text: "Sign in" });
  const form = h("form", { class: "sign-in-form", novalidate: true, "aria-label": "Sign in" },
    field("Email", email, "email"), field("Password", password, "password"), button, region);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    say(region, "Signing in…", "pending");
    try {
      const { user } = await post("/api/session", { email: email.value, password: password.value });
      location.assign(firstScreen(user.role));
    } catch (error) {
      say(region, error.message, "error");
      button.disabled = false;
    }
  });
  return h("main", { class: "sign-in" },
    h("div", { class: "sign-in-card" },
      h("div", { class: "brand" }, h("img", { src: "/assets/mark.svg", alt: "", width: 28, height: 28 }),
        h("span", { text: "Tallow Cover" })),
      h("h1", { text: "Sign in to Tallow Cover" }),
      h("p", { class: "lede", text: "Attendance, leave and cover for Hollins Vale Care homes." }),
      form));
}

export function profile(work, { me }) {
  const name = h("input", { type: "text", value: me.display_name, maxlength: 60, autocomplete: "name" });
  const region = status("Profile status");
  const button = h("button", { type: "submit", class: "primary", text: "Save name" });
  const form = h("form", { novalidate: true, class: "stack" }, field("Display name", name, "display-name"), button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    say(region, "Saving…", "pending");
    try {
      await patch("/api/me", { display_name: name.value });
      say(region, "Name updated.", "success");
      document.querySelector(".who-name").textContent = name.value;
    } catch (error) {
      say(region, error instanceof ApiError && error.body.errors ? error.fieldMessages() : error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  work.append(screen("Profile", panel("Your name", h("p", { class: "meta", text: me.email }), form, region)));
}
