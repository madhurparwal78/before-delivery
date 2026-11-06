// Sign-in and sign-up: the published routes land on the published route with
// a live session.

import { el, link, type ScreenContext, heading, problems, workingButton, field } from "../lib/ui";
import { ApiError } from "../lib/state";
import { api } from "../lib/ui";

export async function buildSignIn(ctx: ScreenContext, query: URLSearchParams): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const h = heading(["Sign in"], ctx.announcer);
  const email = field("input", { type: "email", autocomplete: "email" });
  const password = field("input", { type: "password", autocomplete: "current-password" });
  const problem = problems();
  const next = query.get("next") ?? "/desk/jobs";
  const form = el("form", { "aria-label": "Sign in", novalidate: "" });
  form.append(
    el("label", { for: "si-email" }, "Email"),
    email,
    el("label", { for: "si-password" }, "Password"),
    password,
    problem.region,
    workingButton("Sign in", async () => {
      try {
        await api.post("/api/sign-in", { email: email.value.trim(), password: password.value });
        await ctx.router.go(next);
      } catch (e) {
        if (e instanceof ApiError) {
          problem.show([{ field: "email", text: e.message }]);
          ctx.announcer.announce(e.message);
        }
      }
    }, "Working…"),
  );
  const body = el("main", { class: "auth" }, h, form, el("p", {}, link("/sign-up", "Start a desk")));
  return { heading: h, body, refresh: null };
}

export async function buildSignUp(ctx: ScreenContext): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const h = heading(["Start a desk"], ctx.announcer);
  const name = field("input", { type: "text", autocomplete: "name" });
  const email = field("input", { type: "email", autocomplete: "email" });
  const password = field("input", { type: "password", autocomplete: "new-password" });
  const problem = problems();
  const form = el("form", { "aria-label": "Start a desk", novalidate: "" });
  form.append(
    el("label", { for: "su-name" }, "Name"),
    name,
    el("label", { for: "su-email" }, "Email"),
    email,
    el("label", { for: "su-password" }, "Password"),
    password,
    problem.region,
    workingButton("Start a desk", async () => {
      const fields: { field: string; text: string }[] = [];
      if (name.value.trim().length === 0) fields.push({ field: "name", text: "Type a name." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        fields.push({ field: "email", text: "Type a mail address such as name@example.test." });
      }
      if (password.value.length < 10) fields.push({ field: "password", text: "A password has at least 10 characters." });
      problem.show(fields);
      if (fields.length > 0) return;
      try {
        await api.post("/api/sign-up", { name: name.value.trim(), email: email.value.trim(), password: password.value });
        await ctx.router.go("/desk/jobs");
      } catch (e) {
        if (e instanceof ApiError) {
          problem.show([{ field: "email", text: e.message }]);
          ctx.announcer.announce(e.message);
        }
      }
    }, "Working…"),
  );
  const body = el("main", { class: "auth" }, h, form, el("p", {}, link("/sign-in", "Sign in")));
  return { heading: h, body, refresh: null };
}
