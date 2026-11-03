// The offer page an interpreter opens from the emailed link.
import type { OfferPage } from "../../shared/api.js";
import { SETTING_LABELS } from "../../shared/domain.js";
import { agencyDate, agencyTime } from "../../shared/time.js";
import { call, get } from "../api.js";
import type { Screen } from "../app.js";
import { h, replace, say, statusRegion } from "../dom.js";
import { button, when } from "../ui.js";

export async function offerScreen({ main, params }: Screen): Promise<void> {
  const token = params.token ?? "";
  const sheet = h("section", { class: "sheet narrow" });
  main.append(sheet);
  const found = await get<OfferPage>(`/api/offers/${token}`);
  if (!found.ok) {
    replace(sheet, h("h1", {}, "Offer not found"), h("p", { class: "lede" }, "This offer link is not valid. Check the link in your email, or contact dispatch."));
    return;
  }
  const { offer, request, seat } = found.data;
  const expires = new Date(offer.expires_at);
  const status = statusRegion("Offer status");
  const actions = h("div", { class: "actions" });
  const facts: [string, string][] = [
    ["Organisation", request.org_name],
    ["Setting", SETTING_LABELS[request.setting]],
    ["Assignment", request.title],
    ["Location", request.location],
    ["When", when(request.start, request.end)],
    ["Seat", `${seat.position} of ${seat.total}`],
    ["Answer by", `${agencyDate(expires)} ${agencyTime(expires)}`],
  ];
  replace(
    sheet,
    h("p", { class: "eyebrow" }, `For ${found.data.interpreter.name}`),
    h("h1", {}, `Offer for ${request.ref}`),
    h("dl", { class: "facts" }, facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    actions,
    status,
  );
  if (offer.status !== "active") {
    say(status, `This offer is no longer open (${offer.status}).`);
    return;
  }
  const accept = button("Accept offer");
  const decline = button("Decline offer", {}, "quiet");
  actions.append(accept, decline);
  const answer = async (verb: "accept" | "decline"): Promise<void> => {
    accept.disabled = true;
    decline.disabled = true;
    say(status, "Sending your answer…");
    const result = await call<{ offer: { status: string }; request: { ref: string; status: string } }>("POST", `/api/offers/${token}/${verb}`, {});
    if (result.ok) {
      actions.replaceChildren();
      say(status, verb === "accept" ? `Accepted. ${request.ref} is on your schedule.` : "Declined. The seat goes back to dispatch.");
      return;
    }
    if (result.error.code === "offer_closed") {
      actions.replaceChildren();
      say(status, `This offer is no longer open (${result.error.offer_status ?? "closed"}).`);
      return;
    }
    accept.disabled = false;
    decline.disabled = false;
    say(status, "Your answer could not be sent. Try again.");
  };
  accept.addEventListener("click", () => void answer("accept"));
  decline.addEventListener("click", () => void answer("decline"));
}
