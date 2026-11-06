import { h, quillMark } from "./dom.js";
import { HttpError, api } from "./net.js";
import { navigate, setSession, type View } from "./router.js";
import { field, showFieldErrors } from "./ui.js";
import type { SessionPerson } from "../shared/types.js";

/** Sign-in screen: a small centred card on the desk (Screens and layout). */
export function mountSignIn(root: HTMLElement): View {
  const email = h("input", { id: "signin-email", type: "email", name: "email", autocomplete: "username", required: true });
  const password = h("input", { id: "signin-password", type: "password", name: "password", autocomplete: "current-password", required: true });
  const submit = h("button", { type: "submit", class: "btn primary wide" }, "Sign in");
  const alert = h("div", { class: "form-alert", role: "alert" });
  const form = h("form", { class: "signin-form", novalidate: true },
    field("Email", email), field("Password", password), alert, submit);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alert.textContent = "";
    submit.disabled = true;
    submit.textContent = "Signing in";
    try {
      const { person } = await api<{ person: SessionPerson }>("POST", "/api/session", { email: email.value, password: password.value });
      setSession(person);
      navigate(new URLSearchParams(location.search).get("next") ?? "/", true);
    } catch (err) {
      submit.disabled = false;
      submit.textContent = "Sign in";
      if (err instanceof HttpError && err.status === 422) showFieldErrors(form, err.fields, { email, password });
      else if (err instanceof HttpError && err.status === 401) alert.textContent = "That email and password don't match.";
      else alert.textContent = "Quillmere can't be reached right now. Try again in a minute.";
    }
  });
  root.append(h("main", { class: "signin-desk" },
    h("section", { class: "signin-card", "aria-labelledby": "signin-title" },
      h("div", { class: "brand" }, quillMark(), h("span", {}, "Quillmere Drafts")),
      h("h1", { id: "signin-title" }, "Sign in to Quillmere Drafts"),
      h("p", { class: "lede" }, "Proposals, reviewers and every margin note, on one page."),
      form)));
  email.focus();
  return { unmount: () => undefined };
}
