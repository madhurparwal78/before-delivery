import { apiJson, el, navigate, ApiError } from "./api.js";

/** `/` — sign-in and sign-up. */
export function renderSignIn(): void {
  document.title = "Sixbell Rest Log";
  const app = document.getElementById("app")!;
  app.textContent = "";

  const heading = el("h1", {}, "Sixbell Rest Log");
  const feedback = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Feedback" });

  const email = el("input", { type: "email", id: "si-email", autocomplete: "email" });
  const passcode = el("input", { type: "password", id: "si-passcode", autocomplete: "current-password" });
  const emailLabel = el("label", { for: "si-email" }, "Email");
  const passcodeLabel = el("label", { for: "si-passcode" }, "Passcode");

  const signIn = el("button", { type: "submit", class: "primary" }, "Sign in");
  signIn.setAttribute("aria-label", "Sign in");

  const form = el("form", { "aria-label": "Sign in" },
    emailLabel, email, passcodeLabel, passcode,
    el("div", { class: "dialog-row" }, signIn));

  const createButton = el("button", { type: "button" }, "Create an owner account");

  const main = el("div", { class: "pane", style: "max-width:520px;margin:40px auto;" },
    heading,
    el("p", { class: "muted small" }, "Hours of rest for owner-run workboats, survey boats, small coasters and charter yachts."),
    feedback,
    form,
    createButton);

  app.append(main);

  async function attemptSignIn(): Promise<void> {
    feedback.textContent = "Signing in.";
    try {
      const result = await apiJson<{ role: "owner_master" | "crew" }>("/api/session", {
        method: "POST",
        body: JSON.stringify({ email: email.value, passcode: passcode.value }),
      });
      navigate(result.role === "owner_master" ? "/fleet" : "/log");
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) feedback.textContent = "That email and passcode do not match.";
        else if (error.fieldErrors) feedback.textContent = Object.values(error.fieldErrors)[0] ?? "Something went wrong. Try again.";
        else feedback.textContent = "Something went wrong. Try again.";
      } else {
        feedback.textContent = "Something went wrong. Try again.";
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void attemptSignIn();
  });

  createButton.addEventListener("click", () => {
    const dialog = el("dialog", { "aria-label": "Create an owner account" });
    const title = el("h3", {}, "Create an owner account");
    const nameLabel = el("label", { for: "su-name" }, "Your name");
    const name = el("input", { type: "text", id: "su-name" });
    const emailLabel2 = el("label", { for: "su-email" }, "Email");
    const email2 = el("input", { type: "email", id: "su-email" });
    const passcodeLabel2 = el("label", { for: "su-passcode" }, "Passcode");
    const passcode2 = el("input", { type: "password", id: "su-passcode" });
    const innerFeedback = el("p", { class: "field-error", role: "alert" });
    const create = el("button", { type: "submit", class: "primary" }, "Create account");
    const cancel = el("button", { type: "button" }, "Cancel");
    const row = el("div", { class: "dialog-row" }, cancel, create);
    const form2 = el("form", {},
      title, nameLabel, name, emailLabel2, email2, passcodeLabel2, passcode2, innerFeedback, row);
    dialog.append(form2);
    document.body.append(dialog);

    const close = (): void => {
      dialog.close();
      dialog.remove();
      createButton.focus();
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    cancel.addEventListener("click", () => close());
    form2.addEventListener("submit", async (event) => {
      event.preventDefault();
      create.textContent = "Signing in.";
      try {
        await apiJson("/api/owners", {
          method: "POST",
          body: JSON.stringify({ name: name.value, email: email2.value, passcode: passcode2.value }),
        });
        navigate("/fleet");
      } catch (error) {
        create.textContent = "Create account";
        if (error instanceof ApiError) {
          if (error.status === 409) innerFeedback.textContent = "That email already has an account.";
          else if (error.fieldErrors) innerFeedback.textContent = Object.values(error.fieldErrors)[0] ?? "Something went wrong. Try again.";
          else innerFeedback.textContent = "Something went wrong. Try again.";
        } else {
          innerFeedback.textContent = "Something went wrong. Try again.";
        }
      }
    });
    dialog.showModal();
    name.focus();
  });
}
