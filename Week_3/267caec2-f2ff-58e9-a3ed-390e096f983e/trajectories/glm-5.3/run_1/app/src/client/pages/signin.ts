import { post, setSession, User } from "../api.js";
import { h, deskStatus, deskError, deskErrorFrom, showFieldErrors, withPending } from "../ui.js";
import { navigate } from "../main.js";
import { setBand } from "../band.js";

export async function renderSignIn(main: HTMLElement): Promise<void> {
  setBand({ contextName: "Cutline Jury Desk", countdownIso: null });
  main.textContent = "";
  const email = h("input", { type: "email", name: "email", id: "signin-email", autocomplete: "email" }) as HTMLInputElement;
  const password = h("input", { type: "password", name: "password", id: "signin-password", autocomplete: "current-password" }) as HTMLInputElement;
  const submit = h("button", { class: "primary", type: "submit", text: "Sign in" }) as HTMLButtonElement;
  const form = h("form", { class: "panel", "aria-label": "Sign in" },
    h("h1", { class: "page-title", text: "Sign in" }),
    h("label", { class: "field", for: "signin-email" }, h("span", { text: "Email" }), email),
    h("label", { class: "field", for: "signin-password" }, h("span", { text: "Password" }), password),
    submit,
    h("p", {}, h("a", { href: "/signup", text: "Create a studio account" })),
  ) as HTMLFormElement;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withPending(submit, "Signing in…", async () => {
        const result = await post<{ user: User }>("/api/session", { email: email.value, password: password.value });
        setSession(result.user);
        deskStatus("Signed in.");
        const after = sessionStorage.getItem("cutline-after-signin");
        sessionStorage.removeItem("cutline-after-signin");
        await navigate(after && after !== "/signin" ? after : homeFor(result.user));
      });
    } catch (error) {
      showFieldErrors(form, error);
      deskError(deskErrorFrom(error));
    }
  });
  main.append(h("div", { class: "two-col" }, h("div", {}, form), h("div")));
}

export async function renderSignUp(main: HTMLElement): Promise<void> {
  setBand({ contextName: "Cutline Jury Desk", countdownIso: null });
  main.textContent = "";
  const fields: [string, string, string][] = [
    ["studioName", "Studio name", "text"],
    ["contactName", "Contact name", "text"],
    ["email", "Email", "email"],
    ["password", "Password", "password"],
  ];
  const inputs = new Map<string, HTMLInputElement>();
  const form = h("form", { class: "panel", "aria-label": "Create a studio account" }, h("h1", { class: "page-title", text: "Create a studio account" })) as HTMLFormElement;
  for (const [name, label, type] of fields) {
    const input = h("input", { type, name, id: `signup-${name}`, autocomplete: type === "password" ? "new-password" : "off" }) as HTMLInputElement;
    inputs.set(name, input);
    form.append(h("label", { class: "field", for: `signup-${name}` }, h("span", { text: label }), input));
  }
  const submit = h("button", { class: "primary", type: "submit", text: "Create studio account" }) as HTMLButtonElement;
  form.append(submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withPending(submit, "Creating your studio…", async () => {
        await post<{ user: User }>("/api/studios", {
          studioName: inputs.get("studioName")?.value ?? "",
          contactName: inputs.get("contactName")?.value ?? "",
          email: inputs.get("email")?.value ?? "",
          password: inputs.get("password")?.value ?? "",
        });
        deskStatus("Studio account created.");
        const session = await post<{ user: User }>("/api/session", {
          email: inputs.get("email")?.value ?? "",
          password: inputs.get("password")?.value ?? "",
        });
        setSession(session.user);
        await navigate("/studio");
      });
    } catch (error) {
      showFieldErrors(form, error);
      deskError(deskErrorFrom(error));
    }
  });
  main.append(h("div", { class: "two-col" }, h("div", {}, form), h("div")));
}

function homeFor(user: User): string {
  if (user.role === "director") {
    return "/director";
  }
  if (user.role === "juror") {
    return "/jury";
  }
  return "/studio";
}
