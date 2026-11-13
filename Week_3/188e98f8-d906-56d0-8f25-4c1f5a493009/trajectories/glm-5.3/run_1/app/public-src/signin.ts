import { COPY } from "./copy";
import { postSession } from "./api";
import { el } from "./shell";

export function renderSignIn(main: HTMLElement, messages: import("./shell").DeskMessages): void {
  main.textContent = "";
  const card = el("section", { class: "card signin-card" });
  const form = el("form", { "aria-label": "Sign in", id: "sign-in-form" }) as HTMLFormElement;
  const codeField = el("input", {
    type: "text",
    id: "desk-code",
    name: "code",
    autocomplete: "off",
    "aria-label": "Desk code",
  }) as HTMLInputElement;
  const label = el("label", { for: "desk-code" }, "Desk code");
  const submit = el("button", { type: "submit", id: "sign-in" }, "Sign in");
  form.appendChild(label);
  form.appendChild(codeField);
  form.appendChild(submit);
  card.appendChild(form);
  main.appendChild(card);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      messages.show(COPY.checkingCode, true);
      const result = await postSession(codeField.value);
      if (result.status === 201) {
        const body = result.body as { role: "quizmaster" | "marker" | "captain" };
        const desk = body.role === "quizmaster" ? "/quizmaster" : body.role === "marker" ? "/marker" : "/captain";
        window.location.assign(desk);
        return;
      }
      messages.show(COPY.badCode);
      codeField.focus();
    })();
  });
  codeField.focus();
}
