// New request: the requester saves a draft, then lands on its detail page to add prep and submit.
import type { RequestView } from "../../shared/api.js";
import { call } from "../api.js";
import { navigate, type Screen } from "../app.js";
import { h, say, statusRegion } from "../dom.js";
import { showErrors } from "../ui.js";
import { requestForm } from "./request-form.js";

export async function newRequestScreen({ main }: Screen): Promise<void> {
  const status = statusRegion("Request status");
  const { form, fields, body } = await requestForm("New request", null, "Save draft");
  form.append(status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    say(status, "Saving…");
    const result = await call<{ request: RequestView }>("POST", "/api/requests", body());
    if (result.ok) {
      showErrors(fields);
      navigate(`/requests/${result.data.request.id}`, `Draft ${result.data.request.ref} saved.`);
      return;
    }
    showErrors(fields, result.error.fields);
    say(status, result.error.code === "validation" ? "Check the highlighted fields." : "The draft could not be saved. Try again.");
  });
  main.append(
    h(
      "section",
      { class: "sheet" },
      h("h1", {}, "New request"),
      h("p", { class: "lede" }, "Save a draft first. On the next page you can attach prep material and submit it to dispatch."),
      form,
    ),
  );
}
