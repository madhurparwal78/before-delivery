import { api, navigate, state, clear, appEl, el, ApiFailure } from "../app.js";

export async function renderAuth(mode: "signup" | "signin"): Promise<() => void> {
  document.title = mode === "signup" ? "Create account · Cupfold" : "Sign in · Cupfold";
  const app = appEl();
  clear(app);
  const next = new URLSearchParams(location.search).get("next") ?? "/t";
  const form = el("form", { class: "card stack", attrs: { style: "max-width:440px" } }, [
    el("h2", {}, [mode === "signup" ? "Create account" : "Sign in"]),
    fieldRow("Username", "username"),
    fieldRow("Password", "password", "password"),
    errorHost(),
    el("div", { class: "sheet-actions" }, [
      el("button", { class: "btn", type: "submit" }, [mode === "signup" ? "Create account" : "Sign in"]),
    ]),
    el("p", { class: "small muted" }, [
      mode === "signup" ? "Already have an account? " : "New here? ",
      el("a", { href: mode === "signup" ? "/signin" : "/signup" }, [mode === "signup" ? "Sign in" : "Create account"]),
    ]),
  ]);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearErrors();
    const username = (form.querySelector('[name="username"]') as HTMLInputElement).value;
    const password = (form.querySelector('[name="password"]') as HTMLInputElement).value;
    try {
      const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/signin";
      await api("POST", path, { username, password });
      state.username = username.toLowerCase();
      navigate(next);
    } catch (e) {
      if (e instanceof ApiFailure) {
        showFieldErrors(e.body.fields ?? {});
        if (!e.body.fields) showError(e.body.message);
      }
    }
  });
  app.appendChild(el("main", { class: "page" }, [form]));
  const first = form.querySelector("input");
  if (first) first.focus();
  return () => {};
}

function fieldRow(label: string, name: string, type = "text"): HTMLElement {
  return el("div", { class: "field" }, [
    el("label", { attrs: { for: `f-${name}` } }, [label]),
    el("input", { id: `f-${name}`, attrs: { name, autocomplete: "username" }, type }),
  ]);
}

function errorHost(): HTMLElement {
  return el("div", { id: "auth-errors" });
}

function showError(text: string): void {
  const host = document.getElementById("auth-errors");
  host?.appendChild(el("p", { class: "field-error", attrs: { role: "alert" } }, [text]));
}

function showFieldErrors(fields: Record<string, string>): void {
  for (const [key, message] of Object.entries(fields)) {
    const input = document.querySelector(`[name="${key}"]`) as HTMLInputElement | null;
    if (input) {
      const wrap = input.closest(".field");
      wrap?.appendChild(el("p", { class: "field-error" }, [message]));
    } else {
      showError(message);
    }
  }
}

function clearErrors(): void {
  const host = document.getElementById("auth-errors");
  if (host) clear(host);
  document.querySelectorAll(".field-error").forEach((n) => n.remove());
}
