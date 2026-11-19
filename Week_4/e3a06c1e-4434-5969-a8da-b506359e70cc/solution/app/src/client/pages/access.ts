// Sign in and join: a single centred card on the near-black ground.
import type { User } from "../../shared/types";
import { api, GENERIC_FAILURE } from "../api";
import { field, h, say } from "../dom";
import { navigate, type PublicPage } from "../main";
import { wordmark } from "../shell";

function card(title: string, lead: string, form: HTMLFormElement): HTMLElement {
  return h(
    "div",
    { class: "access" },
    h("a", { href: "/", class: "wordmark access-mark" }, wordmark()),
    h("main", { class: "card access-card" }, h("h1", {}, title), h("p", { class: "muted" }, lead), form),
    h("p", { class: "access-foot muted" }, "Lowfield Console · governed live speech recognition"),
  );
}

export function renderSignIn(page: PublicPage): void {
  const email = h("input", { type: "email", autocomplete: "username", spellcheck: "false" });
  const password = h("input", { type: "password", autocomplete: "current-password" });
  const status = h("p", { role: "status", "aria-label": "Sign-in status", class: "status-line" });
  const submit = h("button", { type: "submit", class: "primary wide" }, "Sign in");
  const form = h("form", { novalidate: true, class: "stack" }, field("Email", email).root, field("Password", password).root, submit, status);
  page.root.append(card("Sign in", "Use the email and password of your Lowfield workspace.", form));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const result = await api<{ user: User; landing: string }>("POST", "/api/auth/sign-in", { email: email.value, password: password.value });
    submit.disabled = false;
    if (result.ok) navigate(result.data.landing);
    else say(status, result.status === 401 ? "That email and password don't match." : GENERIC_FAILURE);
  });
}

export function renderJoin(page: PublicPage): void {
  const token = page.params[0];
  const password = h("input", { type: "password", autocomplete: "new-password" });
  const passwordField = field("Choose a password", password, "At least 12 characters.");
  const status = h("p", { role: "status", "aria-label": "Join status", class: "status-line" });
  const submit = h("button", { type: "submit", class: "primary wide" }, "Join workspace");
  const form = h("form", { novalidate: true, class: "stack" }, passwordField.root, submit, status);
  page.root.append(card("Join your team", "Choose a password to accept this invitation.", form));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    passwordField.error(null);
    submit.disabled = true;
    const result = await api<{ user: User; landing: string }>("POST", `/api/invitations/${encodeURIComponent(token)}/accept`, { password: password.value });
    submit.disabled = false;
    if (result.ok) {
      navigate(result.data.landing);
      return;
    }
    if (result.error.error === "invitation_used") say(status, "This invitation has already been used.");
    else if (result.error.fields?.password) {
      say(status, "");
      passwordField.error(result.error.fields.password);
    } else if (result.status === 404) say(status, "This invitation link isn't valid. Ask your admin for a new one.");
    else say(status, GENERIC_FAILURE);
  });
}
