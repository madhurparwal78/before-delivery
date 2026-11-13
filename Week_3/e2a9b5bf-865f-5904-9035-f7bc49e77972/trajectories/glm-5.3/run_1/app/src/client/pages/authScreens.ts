// Sign up and Sign in screens (DP-01, DP-61, DP-70, DP-94).
import { app, navigate, signIn } from "../app.js";
import { el } from "../dom.js";
import { apiPost, ApiError } from "../api.js";
import { accountSentences } from "../../shared/sentences.js";

export function renderSignup(root: HTMLElement): void {
  const column = el("div", { class: "column narrow" });
  const problem = el("div", { class: "alert problem", role: "alert", "aria-label": "Account problem", hidden: "hidden" });
  const email = el("input", { class: "input", type: "email", id: "su-email", autocomplete: "email" }) as HTMLInputElement;
  const password = el("input", { class: "input", type: "password", id: "su-password", autocomplete: "new-password" }) as HTMLInputElement;
  const name = el("input", { class: "input", type: "text", id: "su-name", autocomplete: "name" }) as HTMLInputElement;
  let inFlight = false;

  const submit = el("button", {
    class: "button primary",
    text: "Create account",
    onclick: async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const account = await apiPost.signup({
          email: email.value,
          password: password.value,
          display_name: name.value,
        });
        app.account = account.account;
        app.state.signedInAccountId = account.account.id;
        app.state.accountEmail = account.account.email;
        app.state.lastSignedInEmail = account.account.email;
        app.state.signedOutExplicitly = false;
        navigate("/kit");
      } catch (error) {
        showProblem(problem, error);
      } finally {
        inFlight = false;
      }
    },
  });

  column.append(
    el("h1", { class: "heading", text: "Create your log" }),
    field("Email", email),
    field("Password", password),
    field("Your name", name),
    problem,
    submit,
  );
  root.append(column);
}

export function renderSignin(root: HTMLElement, next: string): void {
  const column = el("div", { class: "column narrow" });
  const problem = el("div", { class: "alert problem", role: "alert", "aria-label": "Account problem", hidden: "hidden" });
  const email = el("input", { class: "input", type: "email", id: "si-email", autocomplete: "email" }) as HTMLInputElement;
  const password = el("input", { class: "input", type: "password", id: "si-password", autocomplete: "current-password" }) as HTMLInputElement;
  let inFlight = false;

  const submit = el("button", {
    class: "button primary",
    text: "Sign in",
    onclick: async () => {
      if (inFlight) return;
      if (!navigator.onLine) {
        showProblemText(problem, "That needs signal. Nothing was changed.");
        return;
      }
      inFlight = true;
      try {
        await signIn(email.value, password.value);
        app.state.signedOutExplicitly = false;
        navigate(next);
      } catch (error) {
        showProblem(problem, error);
      } finally {
        inFlight = false;
      }
    },
  });

  column.append(
    el("h1", { class: "heading", text: "Sign in" }),
    field("Email", email),
    field("Password", password),
    problem,
    submit,
  );
  root.append(column);
  email.focus();
}

function field(labelText: string, input: HTMLElement): HTMLElement {
  const label = el("label", { class: "field-label", for: input.id }, labelText);
  return el("div", { class: "field" }, label, input);
}

function showProblem(problem: HTMLElement, error: unknown): void {
  const apiError = error as ApiError;
  let sentence = "Something went wrong on our side. Nothing was lost; try again.";
  if (apiError?.status === 409 && apiError.code === "email_taken") sentence = accountSentences.emailTaken;
  else if (apiError?.status === 401) sentence = accountSentences.badCredentials;
  else if (apiError?.status === 429) sentence = accountSentences.tooManyAttempts;
  else if (apiError?.status === 422 && apiError.fields) sentence = Object.values(apiError.fields)[0] ?? sentence;
  else if (apiError?.status === 0) sentence = "That needs signal. Nothing was changed.";
  showProblemText(problem, sentence);
}

function showProblemText(problem: HTMLElement, sentence: string): void {
  problem.textContent = sentence;
  problem.removeAttribute("hidden");
}
