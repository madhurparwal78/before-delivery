// Sign-in and join screens.
import { api, ApiFail, type User } from "../api.js";
import { h, errorMessage, errorFields, fixFieldsAlert } from "../ui.js";
import { state, navigate } from "../client.js";

export async function renderSignIn(): Promise<void> {
  const root = document.getElementById("root") as HTMLElement;
  root.textContent = "";
  state.user = null;

  const wrap = h("div", { class: "content", style: "max-width:420px;margin:48px auto" });
  wrap.appendChild(h("h1", { text: "Sign in to Conecount Paddock" }));

  const alertBox = h("div", null);

  const form = document.createElement("form");
  const fields: Record<string, HTMLElement> = {};

  const email = document.createElement("input");
  email.type = "email";
  email.id = "signin-email";
  email.autocomplete = "email";
  const emailField = h("div", { class: "field" }, h("label", { for: "signin-email", text: "Email" }), email, h("div", { class: "field-error", id: "err-email" }));
  fields.email = email;
  form.appendChild(emailField);

  const password = document.createElement("input");
  password.type = "password";
  password.id = "signin-password";
  const passwordField = h("div", { class: "field" }, h("label", { for: "signin-password", text: "Password" }), password, h("div", { class: "field-error", id: "err-password" }));
  fields.password = password;
  form.appendChild(passwordField);

  const submit = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Sign in" });
  form.appendChild(submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    alertBox.textContent = "";
    document.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
    submit.disabled = true;
    submit.textContent = "Signing in";
    try {
      const result = await api.post<{ user: User }>("/api/session", {
        email: email.value,
        password: password.value,
      });
      state.user = result.user;
      await navigate(result.user.roles.includes("operator") ? "/operator" : "/events");
    } catch (e) {
      submit.disabled = false;
      submit.textContent = "Sign in";
      if (e instanceof ApiFail && e.body.fields) {
        for (const [field, message] of Object.entries(e.body.fields)) {
          const target = document.getElementById(`err-${field}`);
          if (target) target.textContent = message;
        }
        alertBox.appendChild(fixFieldsAlert(e.body.fields, fields));
      } else {
        alertBox.appendChild(h("div", { class: "alert-fix", role: "alert", text: errorMessage(e) }));
      }
    }
  });

  wrap.appendChild(alertBox);
  wrap.appendChild(form);
  root.appendChild(wrap);
  email.focus();
}

export async function renderJoin(clubSlug: string): Promise<void> {
  const root = document.getElementById("root") as HTMLElement;
  root.textContent = "";
  state.user = null;

  const wrap = h("div", { class: "content", style: "max-width:420px;margin:48px auto" });
  const title = h("h1", { text: `Join ${clubSlug}` });
  wrap.appendChild(title);

  const alertBox = h("div", null);

  const form = document.createElement("form");
  const fields: Record<string, HTMLElement> = {};

  const name = document.createElement("input");
  name.id = "join-name";
  name.autocomplete = "name";
  form.appendChild(h("div", { class: "field" }, h("label", { for: "join-name", text: "Full name" }), name, h("div", { class: "field-error", id: "err-name" })));
  fields.name = name;

  const email = document.createElement("input");
  email.type = "email";
  email.id = "join-email";
  email.autocomplete = "email";
  form.appendChild(h("div", { class: "field" }, h("label", { for: "join-email", text: "Email" }), email, h("div", { class: "field-error", id: "err-email" })));
  fields.email = email;

  const password = document.createElement("input");
  password.type = "password";
  password.id = "join-password";
  password.autocomplete = "new-password";
  form.appendChild(h("div", { class: "field" }, h("label", { for: "join-password", text: "Password" }), password, h("div", { field: "", class: "field-error", id: "err-password" })));
  fields.password = password;

  const submit = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Create driver account" });
  form.appendChild(submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    alertBox.textContent = "";
    document.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
    submit.disabled = true;
    submit.textContent = "Creating account";
    try {
      const result = await api.post<{ user: User }>(`/api/clubs/${clubSlug}/signup`, {
        name: name.value,
        email: email.value,
        password: password.value,
      });
      state.user = result.user;
      await navigate("/events");
    } catch (e) {
      submit.disabled = false;
      submit.textContent = "Create driver account";
      const fieldsErrors = errorFields(e);
      if (Object.keys(fieldsErrors).length > 0) {
        for (const [field, message] of Object.entries(fieldsErrors)) {
          const target = document.getElementById(`err-${field}`);
          if (target) target.textContent = message;
        }
        alertBox.appendChild(fixFieldsAlert(fieldsErrors, fields));
      } else {
        alertBox.appendChild(h("div", { class: "alert-fix", role: "alert", text: errorMessage(e) }));
      }
    }
  });

  wrap.appendChild(alertBox);
  wrap.appendChild(form);
  root.appendChild(wrap);
  name.focus();

  // The heading shows the club's real name once it loads.
  try {
    const info = await api.get<{ club: { name: string } }>(`/api/clubs/${clubSlug}`);
    title.textContent = `Join ${info.club.name}`;
  } catch {
    /* unknown club: the slug-based heading stands */
  }
}
