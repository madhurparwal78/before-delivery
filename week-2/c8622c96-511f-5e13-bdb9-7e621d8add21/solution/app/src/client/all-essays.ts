// All essays (desk editor): every essay with its state, and legal takedowns.
import { attempt, call, failureText, get } from "./api.js";
import { openDialog } from "./dialog.js";
import { h, icon, replace, say } from "./dom.js";
import type { Essay } from "./types.js";
import { badge, dataTable, ESSAY_STATE, mono, outageFrom, pageHead, statusLine } from "./ui.js";

const TAKEDOWN_FROM = new Set(["embargoed", "live", "withdrawn"]);
const TONE: Record<string, string> = { embargoed: "embargo", live: "neutral", taken_down: "muted", withdrawn: "muted" };

export function mountAllEssays(root: HTMLElement): () => void {
  const status = statusLine("Desk status");
  const body = h("div", {});
  replace(root, pageHead("All essays", "Every essay in the co-operative, in any state. Legal takedowns remove all imagery and revoke every licence."),
    status, body);

  function takedown(essay: Essay, opener: HTMLButtonElement): void {
    openDialog("Legal takedown", opener, (close) => {
      const reference = h("input", { id: "legal-reference", type: "text", maxlength: 200, autocomplete: "off" });
      const error = h("p", { class: "field-error", id: "legal-reference-error", hidden: true });
      const confirmBox = h("input", { id: "takedown-confirm", type: "checkbox" });
      const submit = h("button", { type: "submit", class: "button button-danger", disabled: true }, icon("gavel"), "Take down essay");
      const cancel = h("button", { type: "button", class: "button button-quiet" }, "Cancel");
      confirmBox.addEventListener("change", () => {
        submit.disabled = !confirmBox.checked;
      });
      cancel.addEventListener("click", close);
      const form = h("form", { class: "modal-form" },
        h("label", { for: "legal-reference" }, "Legal reference"), reference, error,
        h("div", { class: "check-row" }, confirmBox,
          h("label", { for: "takedown-confirm" }, "I confirm this removes all imagery and revokes every licence")),
        h("div", { class: "modal-actions" }, cancel, submit));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void (async () => {
          submit.disabled = true;
          const answer = await attempt(() => call<{ revoked_licences: number }>("POST",
            `/api/essays/${encodeURIComponent(essay.id)}/takedown`, { reference: reference.value }));
          if (answer?.ok) {
            close();
            say(status, "Essay taken down. Licensees have been notified.");
            await load();
            status.focus();
            return;
          }
          submit.disabled = !confirmBox.checked;
          error.hidden = false;
          error.textContent = answer?.error?.fields?.reference ?? failureText(answer);
          reference.setAttribute("aria-describedby", "legal-reference-error");
          reference.focus();
        })();
      });
      return [
        h("h2", { class: "modal-title" }, "Legal takedown"),
        h("p", { class: "modal-lede" }, h("strong", {}, essay.title), " disappears from the contact sheet, search, every shortlist and every export. Its images stop answering and each licensee newsroom gets a notice."),
        form,
      ];
    });
  }

  async function load(): Promise<void> {
    const answer = await attempt(() => get<{ essays: Essay[] }>("/api/desk/essays"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data) return;
    replace(body, dataTable("All essays", ["Essay", "Credit", "State", "Lift", "Action"], answer.data.essays.map((essay) => {
      let action: Node | string = "";
      if (TAKEDOWN_FROM.has(essay.state)) {
        const button = h("button", { type: "button", class: "button button-ghost", "aria-label": `Legal takedown for ${essay.title}` },
          icon("gavel"), "Legal takedown");
        button.addEventListener("click", () => takedown(essay, button));
        action = button;
      }
      return [h("span", { class: "item-title" }, essay.title), essay.credit_line,
        badge(ESSAY_STATE[essay.state] ?? essay.state, TONE[essay.state] ?? "neutral"), mono(essay.lift_display), action];
    }), [3]));
  }

  status.tabIndex = -1;
  void load();
  return () => undefined;
}
