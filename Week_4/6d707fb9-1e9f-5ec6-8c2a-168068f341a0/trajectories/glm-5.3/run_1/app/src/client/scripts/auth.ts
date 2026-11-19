// Sign-in and sign-up: the forms land on /styles with a live session.

import { announce, api, el } from "./api.js";
import type { RouteCtx } from "./app.js";
import { UI } from "./copy.js";
import { handleSessionEnd } from "./app.js";

function problemsRegion(): HTMLElement {
  return el("div", { class: "problems", role: "region", "aria-label": UI.problems });
}

export function registerSignIn(ctx: RouteCtx): void {
  const main = ctx.main;
  const h1 = el("h1", {}, "Sign in");
  const form = el("form");
  const problems = problemsRegion();
  problems.hidden = true;

  const email = el("label", { class: "field" }, el("span", {}, "Email"));
  const emailInput = el("input", { type: "email", name: "email", autocomplete: "email" });
  emailInput.id = "email";
  email.append(emailInput);

  const password = el("label", { class: "field" }, el("span", {}, "Password"));
  const passwordInput = el("input", { type: "password", name: "password", autocomplete: "current-password" });
  passwordInput.id = "password";
  password.append(passwordInput);

  const submit = el("button", { class: "btn btn-primary", type: "submit" }, "Sign in");
  form.append(problems, email, password, submit);
  main.append(h1, form);

  const bottomBar = el("div", { class: "bottom-bar" });
  bottomBar.append(submit.cloneNode(true) as HTMLElement);
  main.append(bottomBar);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.textContent = UI.working;
    submit.setAttribute("aria-disabled", "true");
    try {
      await api("/api/sign-in", {
        method: "POST",
        body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
      });
      const next = ctx.params.get("next") ?? "/styles";
      location.href = next;
    } catch (err) {
      submit.textContent = "Sign in";
      submit.removeAttribute("aria-disabled");
      const message = err instanceof Error && "status" in err && (err as { status: number }).status === 401
        ? `That email and password don't match.`
        : `Something went wrong.`;
      announce(message);
      problems.hidden = false;
      problems.textContent = "";
      problems.append(el("p", {}, message));
      problems.focus?.();
    }
  });
}

export function registerSignUp(ctx: RouteCtx): void {
  const main = ctx.main;
  const h1 = el("h1", {}, "Start a desk");
  const form = el("form");
  const problems = problemsRegion();
  problems.hidden = true;

  const name = el("label", { class: "field" }, el("span", {}, "Name"));
  const nameInput = el("input", { type: "text", name: "name", autocomplete: "name" });
  nameInput.id = "name";
  name.append(nameInput);

  const email = el("label", { class: "field" }, el("span", {}, "Email"));
  const emailInput = el("input", { type: "email", name: "email", autocomplete: "email" });
  emailInput.id = "email";
  email.append(emailInput);

  const password = el("label", { class: "field" }, el("span", {}, "Password"));
  const passwordInput = el("input", { type: "password", name: "password", autocomplete: "new-password" });
  passwordInput.id = "password";
  password.append(passwordInput);

  const submit = el("button", { class: "btn btn-primary", type: "submit" }, "Start a desk");
  form.append(problems, name, email, password, submit);
  main.append(h1, form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.textContent = UI.working;
    submit.setAttribute("aria-disabled", "true");
    try {
      await api("/api/sign-up", {
        method: "POST",
        body: JSON.stringify({
          name: nameInput.value,
          email: emailInput.value,
          password: passwordInput.value,
        }),
      });
      location.href = "/styles";
    } catch (err) {
      submit.textContent = "Start a desk";
      submit.removeAttribute("aria-disabled");
      const failure = err as { status?: number; fields?: Record<string, string>; message?: string };
      const message = failure.status === 409 ? `That email already has a desk.` : failure.message ?? `Give a value here.`;
      announce(message);
      problems.hidden = false;
      problems.textContent = "";
      const keys = Object.keys(failure.fields ?? {});
      if (keys.length > 0) {
        for (const key of keys) {
          const link = el("a", { href: "#" }, failure.fields?.[key] ?? message);
          link.addEventListener("click", (ev) => {
            ev.preventDefault();
            const target = document.getElementById(key);
            target?.focus();
            target?.setAttribute("aria-invalid", "true");
          });
          problems.append(el("p", {}, link));
        }
      } else {
        problems.append(el("p", {}, message));
      }
      problems.focus?.();
    }
  });
}
