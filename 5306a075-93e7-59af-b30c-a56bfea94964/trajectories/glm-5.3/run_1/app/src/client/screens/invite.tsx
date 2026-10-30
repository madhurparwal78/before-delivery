import { ApiFailure } from "../api.js";
import { h } from "../dom.js";
import { setFeedback } from "../ui.js";

/** The invitation accept page (DP-35). */
export async function renderInvite(token: string): Promise<HTMLElement> {
  const alert = h("div", { class: "page-alert", role: "alert" });
  setFeedback({
    saveStatus: () => undefined,
    evidence: () => undefined,
    board: () => undefined,
    alert: (text) => {
      alert.replaceChildren(text);
    },
    clearAlert: () => {
      alert.replaceChildren();
    },
  });

  let info: { email: string; workspaceName: string } | null = null;
  let goneHeading: string | null = null;
  try {
    const response = await fetch(`/api/invitations/${token}`, { credentials: "same-origin" });
    if (response.status === 410) {
      const body = (await response.json()) as { error: { code: string } };
      const headings: Record<string, string> = {
        invitation_used: "This invitation has already been used",
        invitation_expired: "This invitation has expired",
        invitation_replaced: "This invitation was replaced by a newer one",
      };
      goneHeading = headings[body.error.code] ?? "This invitation has expired";
    } else if (response.ok) {
      info = (await response.json()) as { email: string; workspaceName: string };
    }
  } catch {
    goneHeading = "This invitation has expired";
  }

  if (goneHeading !== null) {
    return h("div", { class: "screen" },
      h("div", { class: "panel", style: { maxWidth: "420px", margin: "4rem auto" } },
        h("h1", null, goneHeading),
      ),
    );
  }
  if (info === null) {
    return h("div", { class: "screen" },
      h("div", { class: "panel", style: { maxWidth: "420px", margin: "4rem auto" } },
        h("h1", null, "This invitation has expired"),
      ),
    );
  }

  const name = h("input", { type: "text", "aria-label": "Your name", autocomplete: "name" }) as HTMLInputElement;
  const password = h("input", { type: "password", "aria-label": "Password", autocomplete: "new-password" }) as HTMLInputElement;
  const nameError = h("span", { class: "field-error" });
  const passwordError = h("span", { class: "field-error" });
  const submit = h("button", { type: "submit", class: "primary" }, "Join workspace") as HTMLButtonElement;

  const form = h(
    "form",
    {
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        nameError.replaceChildren();
        passwordError.replaceChildren();
        submit.textContent = "Joining…";
        try {
          const response = await fetch(`/api/invitations/${token}/accept`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.value, password: password.value }),
          });
          if (response.ok) {
            history.pushState(null, "", "/inbox");
            window.dispatchEvent(new PopStateEvent("popstate"));
            return;
          }
          if (response.status === 410) {
            const body = (await response.json()) as { error: { code: string } };
            const headings: Record<string, string> = {
              invitation_used: "This invitation has already been used",
              invitation_expired: "This invitation has expired",
              invitation_replaced: "This invitation was replaced by a newer one",
            };
            alert.replaceChildren(headings[body.error.code] ?? "This invitation has expired");
            submit.textContent = "Join workspace";
            return;
          }
          const body = (await response.json()) as {
            error: { fields?: Record<string, string>; message: string };
          };
          if (body.error.fields?.name !== undefined) nameError.replaceChildren(body.error.fields.name);
          if (body.error.fields?.password !== undefined) {
            passwordError.replaceChildren(body.error.fields.password);
          }
          submit.textContent = "Join workspace";
        } catch (err) {
          if (err instanceof ApiFailure) {
            alert.replaceChildren(err.error.error.message);
          } else {
            alert.replaceChildren("Something went wrong on our side. Nothing was saved.");
          }
          submit.textContent = "Join workspace";
        }
      },
    },
    h("label", null, "Your name"),
    name,
    nameError,
    h("label", null, "Password"),
    password,
    passwordError,
    h("div", { class: "dialog-actions" }, submit),
  );

  return h(
    "div",
    { class: "screen" },
    h("div", { class: "panel", style: { maxWidth: "420px", margin: "4rem auto" } },
      h("h1", null, `Join ${info.workspaceName}`),
      h("p", null, `Invited as ${info.email}`),
      alert,
      form,
    ),
  );
}
