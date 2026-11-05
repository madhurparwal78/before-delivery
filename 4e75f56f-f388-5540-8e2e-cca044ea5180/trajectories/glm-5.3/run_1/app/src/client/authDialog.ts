import { openDialog, field } from "./ui.js";
import { api } from "./api.js";
import { refreshMe, emit } from "./state.js";

/** The shared sign-in and create-account dialogs. */
export function openSignInDialog(opener: HTMLElement, onDone?: () => void): void {
  let signedIn = false;
  openDialog({
    label: "Sign in",
    opener,
    build: (dialog) => {
      const form = document.createElement("form");
      const email = document.createElement("input") as HTMLInputElement;
      email.type = "email";
      const password = document.createElement("input") as HTMLInputElement;
      password.type = "password";
      const errorNote = document.createElement("p");
      errorNote.className = "field-error";
      errorNote.hidden = true;
      const submit = document.createElement("button");
      submit.className = "btn btn-live";
      submit.type = "submit";
      submit.textContent = "Sign in";
      const create = document.createElement("button");
      create.className = "btn btn-quiet";
      create.type = "button";
      create.textContent = "Create an account";
      const close = document.createElement("button");
      close.className = "btn btn-quiet";
      close.type = "button";
      close.textContent = "Close";
      const h2 = document.createElement("h2");
      h2.textContent = "Sign in";
      form.append(h2, field("Email", email), field("Password", password), errorNote, submit, create, close);
      close.addEventListener("click", () => dialog.close());
      create.addEventListener("click", () => {
        dialog.close();
        openCreateAccountDialog(opener, onDone);
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await api("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: email.value, password: password.value }) });
          await refreshMe();
          emit();
          signedIn = true;
          dialog.close();
        } catch {
          errorNote.hidden = false;
          errorNote.textContent = "Email or password is incorrect.";
        }
      });
      return form;
    },
    onClose: () => {
      if (signedIn) onDone?.();
    },
  });
}

export function openCreateAccountDialog(opener: HTMLElement, onDone?: () => void): void {
  let created = false;
  openDialog({
    label: "Create account",
    opener,
    build: (dialog) => {
      const form = document.createElement("form");
      const name = document.createElement("input") as HTMLInputElement;
      name.type = "text";
      const email = document.createElement("input") as HTMLInputElement;
      email.type = "email";
      const password = document.createElement("input") as HTMLInputElement;
      password.type = "password";
      const clinicName = document.createElement("input") as HTMLInputElement;
      clinicName.type = "text";
      const pract = document.createElement("input") as HTMLInputElement;
      pract.type = "radio";
      pract.name = "kind";
      pract.value = "practitioner";
      pract.checked = true;
      const clinic = document.createElement("input") as HTMLInputElement;
      clinic.type = "radio";
      clinic.name = "kind";
      clinic.value = "clinic";
      const radios = document.createElement("div");
      radios.className = "radios";
      radios.setAttribute("role", "radiogroup");
      radios.setAttribute("aria-label", "Account type");
      const practLabel = document.createElement("label");
      practLabel.className = "radiolabel";
      practLabel.append(pract, "Practitioner");
      const clinicLabel = document.createElement("label");
      clinicLabel.className = "radiolabel";
      clinicLabel.append(clinic, "Clinic");
      radios.append(practLabel, clinicLabel);
      const clinicWrap = field("Clinic name", clinicName);
      clinicWrap.hidden = true;
      clinic.addEventListener("change", () => {
        clinicWrap.hidden = false;
      });
      pract.addEventListener("change", () => {
        clinicWrap.hidden = true;
      });
      const errorNote = document.createElement("p");
      errorNote.className = "field-error";
      errorNote.hidden = true;
      const submit = document.createElement("button");
      submit.className = "btn btn-live";
      submit.type = "submit";
      submit.textContent = "Create account";
      const close = document.createElement("button");
      close.className = "btn btn-quiet";
      close.type = "button";
      close.textContent = "Close";
      const h2 = document.createElement("h2");
      h2.textContent = "Create account";
      form.append(h2, field("Name", name), field("Email", email), field("Password", password), radios, clinicWrap, errorNote, submit, close);
      close.addEventListener("click", () => dialog.close());
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const body: Record<string, unknown> = {
          name: name.value,
          email: email.value,
          password: password.value,
          kind: clinic.checked ? "clinic" : "practitioner",
        };
        if (clinic.checked) body.clinic_name = clinicName.value;
        try {
          await api("/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
          await refreshMe();
          emit();
          created = true;
          dialog.close();
        } catch (e) {
          errorNote.hidden = false;
          errorNote.textContent = e instanceof Error ? (e as { body?: { message?: string } }).body?.message ?? "That did not work." : "That did not work.";
        }
      });
      return form;
    },
    onClose: () => {
      if (created) onDone?.();
    },
  });
}
