import { api, ApiCallError, type Person } from "../api";
import { h, liveRegion, announce } from "../ui";
import { setMe, navigate, homeFor, connectEvents } from "../main";

export function renderSignin(root: HTMLElement): void {
  const status = liveRegion("Sign-in status");
  const studio = h("input", { class: "input", type: "text", id: "signin-studio", "data-field": "studio", autocomplete: "off" });
  const email = h("input", { class: "input", type: "email", id: "signin-email", autocomplete: "off" });
  const password = h("input", { class: "input", type: "password", id: "signin-password" });
  const submit = h("button", { class: "btn primary", text: "Sign in", type: "submit" });
  const field = (label: string, input: HTMLElement, id: string) =>
    h("div", { class: "field" }, h("label", { for: id, text: label }), input, h("div", { class: "field-error", "data-for": id, role: undefined }));
  const form = h(
    "form",
    {
      class: "panel narrow",
      onsubmit: (e: Event) => {
        e.preventDefault();
        void signIn();
      },
    },
    h("h1", { class: "heading", text: "Sign in" }),
    field("Studio", studio, "signin-studio"),
    field("Email", email, "signin-email"),
    field("Password", password, "signin-password"),
    submit,
    status,
  );
  const panel = h("div", { class: "center-wrap" }, form);
  root.appendChild(panel);

  async function signIn(): Promise<void> {
    submit.setAttribute("disabled", "true");
    announce(status, "Signing in…");
    try {
      const res = await api<{ user: Person }>("/api/session", {
        method: "POST",
        skipAuthRedirect: true,
        body: { studio: (studio as HTMLInputElement).value.trim(), email: (email as HTMLInputElement).value.trim(), password: (password as HTMLInputElement).value },
      });
      setMe({ person: res.user, timeZone: res.user.studio.time_zone });
      connectEvents();
      navigate(homeFor(res.user.role), true);
    } catch (err) {
      if (err instanceof ApiCallError && err.kind === "api") {
        announce(status, err.body.message);
      } else {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
    } finally {
      submit.removeAttribute("disabled");
    }
  }
}
