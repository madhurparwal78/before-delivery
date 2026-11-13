/**
 * Sign-in and sign-up: the form beside the product statement and the lifecycle drawing.
 */
import { h } from "./core";
import { ApiFail, api } from "./api";
import { formError } from "./shell";

/** The four-band lifecycle drawing, drawn by the app. */
function lifecycleDrawing(): HTMLElement {
  const wrap = h("div", { role: "img", "aria-label": "Lifecycle: hot, warm, archive, delete" });
  wrap.style.display = "flex";
  wrap.style.gap = "6px";
  wrap.style.marginTop = "10px";
  const bands: [string, string][] = [
    ["hot", "#9c2f26"],
    ["warm", "#9a6b1f"],
    ["archive", "#3f5f7a"],
    ["delete", "#5c665d"],
  ];
  const inner = h("div", {});
  inner.style.display = "flex";
  inner.style.gap = "6px";
  for (const [label, color] of bands) {
    const col = h("div", {});
    col.style.flex = "1";
    const band = h("div", {});
    band.style.height = "64px";
    band.style.background = color;
    band.style.opacity = "0.85";
    const name = h("div", { class: "mono" }, label);
    name.style.fontSize = "12px";
    name.style.marginTop = "4px";
    col.append(band, name);
    inner.append(col);
  }
  wrap.append(inner);
  return wrap;
}

export function buildAuth(main: HTMLElement, mode: "signin" | "signup"): void {
  const isPhone = window.innerWidth < 768;
  const layout = h("div", { class: "auth-layout" });
  layout.style.display = "flex";
  layout.style.gap = "40px";
  layout.style.padding = "30px 20px";
  layout.style.maxWidth = "1000px";
  layout.style.margin = "0 auto";
  if (isPhone) layout.style.flexDirection = "column";

  const formCard = h("div", { class: "card" });
  formCard.style.flex = "1";
  const heading = h("h1", {}, mode === "signin" ? "Sign in" : "Create an account");
  const errorHolder = h("div", {});

  const username = document.createElement("input");
  username.className = "input mono";
  username.setAttribute("aria-label", "Username");
  username.name = "username";
  username.autocomplete = "username";
  username.placeholder = "username";
  username.style.marginTop = "10px";
  const usernameError = h("div", { class: "muted" });
  usernameError.style.fontSize = "12px";

  const password = document.createElement("input");
  password.type = "password";
  password.className = "input mono";
  password.setAttribute("aria-label", "Password");
  password.name = "password";
  password.autocomplete = "current-password";
  password.placeholder = "password";
  password.style.marginTop = "10px";
  const passwordError = h("div", { class: "muted" });
  passwordError.style.fontSize = "12px";

  const submit = h("button", { class: "btn-main", type: "submit" }, mode === "signin" ? "Sign in" : "Create account");
  submit.style.marginTop = "14px";

  const form = h("form", {});
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorHolder.replaceChildren();
    usernameError.textContent = "";
    passwordError.textContent = "";
    submit.setAttribute("aria-busy", "true");
    try {
      const path = mode === "signin" ? "/api/signin" : "/api/signup";
      await api(path, {
        method: "POST",
        body: JSON.stringify({ username: username.value, password: password.value }),
        headers: { "Content-Type": "application/json" },
      });
      location.href = "/explore";
    } catch (err) {
      if (err instanceof ApiFail) {
        errorHolder.append(formError(err.body.fields, err.body.message));
        if (err.body.fields?.username) usernameError.textContent = err.body.fields.username;
        if (err.body.fields?.password) passwordError.textContent = err.body.fields.password;
      } else {
        errorHolder.append(formError(undefined, "Spoorline can't reach the server. Retry when your connection is back."));
      }
    } finally {
      submit.removeAttribute("aria-busy");
    }
  });

  form.append(heading, errorHolder, username, usernameError, password, passwordError, submit);

  if (mode === "signin") {
    const link = document.createElement("a");
    link.href = "/signup";
    link.textContent = "Create an account";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      history.pushState(null, "", "/signup");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    form.append(h("div", { style: { marginTop: "12px" } }, link));
  } else {
    const link = document.createElement("a");
    link.href = "/signin";
    link.textContent = "Sign in instead";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      history.pushState(null, "", "/signin");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    form.append(h("div", { style: { marginTop: "12px" } }, link));
  }

  formCard.append(form);

  const statementCard = h("div", {});
  statementCard.style.flex = "1";
  const statement = h("div", {}, "Every rule in Spoorline is published, so anyone can check any number it shows.");
  statement.style.fontSize = "16px";
  statement.style.maxWidth = "420px";
  const drawing = lifecycleDrawing();
  statementCard.append(statement, drawing);

  if (isPhone) {
    layout.append(statementCard, formCard);
  } else {
    layout.append(formCard, statementCard);
  }
  main.replaceChildren(layout);
}
