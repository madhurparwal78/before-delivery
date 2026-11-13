import { ApiFail, post } from "../api";
import { app, loadMe } from "../app";
import { h } from "../dom";
import { icon } from "../icons";
import { go } from "../router";
import type { Mount } from "../router";
import { avatarArt } from "../ui/avatar";

const WELCOME_ERRORS: Record<string, string> = {
  NAME_TAKEN: "That name is taken. Try one of these:",
  NAME_BLOCKED: "That name isn't allowed. Try one of these:",
  NAME_INVALID: "Use 3 to 16 letters, numbers or underscores.",
};

const welcome: Mount = ({ root }) => {
  let avatar = app.me?.avatar ?? 1;
  const input = h("input", {
    id: "name-input",
    name: "name",
    type: "text",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    "aria-describedby": "name-hint",
  });
  const error = h("div", { id: "name-error", class: "field-error", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn-ink" }, "Continue");
  const skip = h("button", { type: "button", class: "btn" }, "Skip");

  const radios = Array.from({ length: 24 }, (_, index) => {
    const n = index + 1;
    const radio = h("input", { type: "radio", name: "avatar", id: `avatar-${n}`, value: n, "aria-label": `Avatar ${n}` });
    radio.checked = n === avatar;
    radio.addEventListener("change", () => {
      avatar = n;
    });
    return { n, radio, cell: h("div", { class: "avatar-cell" }, radio, h("span", { class: "avatar-face" }, avatarArt(n))) };
  });

  const fail = (message: string, suggestions: string[] = []): void => {
    error.replaceChildren(
      ...[
        h("p", { class: "field-error-text" }, icon("alert", 20), h("span", {}, message)),
        suggestions.length
          ? h(
            "div",
            { class: "suggestions" },
            ...suggestions.map((name) =>
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-small",
                  onclick: () => {
                    input.value = name;
                    error.replaceChildren();
                    input.removeAttribute("aria-invalid");
                    input.setAttribute("aria-describedby", "name-hint");
                    input.focus();
                  },
                },
                name,
              ),
            ),
          )
          : null,
      ].filter((node): node is NonNullable<typeof node> => node !== null),
    );
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "name-hint name-error");
  };

  const done = async (path: string, body: Record<string, unknown>): Promise<void> => {
    submit.disabled = true;
    skip.disabled = true;
    try {
      await post(path, body);
      await loadMe();
      app.focusHeading = true;
      go("/");
    } catch (caught) {
      submit.disabled = false;
      skip.disabled = false;
      if (caught instanceof ApiFail && WELCOME_ERRORS[caught.code]) {
        fail(WELCOME_ERRORS[caught.code] as string, (caught.body.suggestions as string[] | undefined) ?? []);
      } else {
        fail("The server can't save a name right now. Try again in a minute.");
      }
    }
  };

  const form = h(
    "form",
    {
      class: "welcome-form",
      novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        error.replaceChildren();
        input.removeAttribute("aria-invalid");
        void done("/api/me/name", { name: input.value.trim(), avatar });
      },
    },
    h("label", { for: "name-input", class: "label" }, "Name"),
    h("p", { id: "name-hint", class: "hint" }, "3 to 16 letters, numbers or underscores."),
    input,
    error,
    h("div", { role: "radiogroup", "aria-label": "Avatar", class: "avatar-grid" }, ...radios.map((r) => r.cell)),
    h("div", { class: "actions" }, submit, skip),
  );
  skip.addEventListener("click", () => {
    error.replaceChildren();
    void done("/api/me/skip", {});
  });

  root.replaceChildren(
    h(
      "div",
      { class: "welcome field-cobalt" },
      h("div", { class: "welcome-inner" }, h("h1", { class: "page-title", tabindex: -1 }, "Pick a name"), form),
    ),
  );
  return undefined;
};

export default welcome;
