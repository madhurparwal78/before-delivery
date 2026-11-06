// The fee page: the amounts, a link to the PDF, the name field and the
// button, in English for every producer.

import { el, type ScreenContext, field } from "../lib/ui";
import { ApiError, type Json } from "../lib/state";
import { api } from "../lib/ui";
import { FEE_COPY } from "../../shared/copy";

export async function buildFee(ctx: ScreenContext, token: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const h = el("h1", {});
  const amounts = el("dl", { class: "amounts" });
  const name = field("input", { type: "text", autocomplete: "name" });
  const pdf = el("a", { href: `/api/f/${token}/pdf` }, FEE_COPY.openTheLetter);
  let jobTitle = "";

  async function load(): Promise<void> {
    let page: Json;
    try {
      page = await api.get(`/api/f/${token}`);
    } catch {
      h.textContent = "This page has ended.";
      return;
    }
    jobTitle = String(page.jobTitle);
    h.textContent = FEE_COPY.heading(jobTitle);
    amounts.replaceChildren(
      el("div", {}, el("dt", {}, "Fee"), el("dd", {}, String(page.feeText))),
      el("div", {}, el("dt", {}, "Tax"), el("dd", {}, String(page.taxText))),
      el("div", {}, el("dt", {}, "Total"), el("dd", {}, String(page.totalText))),
    );
    for (const milestone of (page.milestones as Json[]) ?? []) {
      amounts.append(el("div", {}, el("dt", {}, `Milestone ${String(milestone.number)}`), el("dd", {}, String(milestone.amountText))));
    }
  }
  await load();

  const accept = el("button", { type: "button", class: "primary" }, FEE_COPY.acceptLetter);
  accept.style.minHeight = "44px";
  accept.addEventListener("click", async () => {
    try {
      await api.post(`/api/f/${token}/accept`, { name: name.value, stamp: "stamp" });
      ctx.announcer.announce(FEE_COPY.acceptedLine);
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  });

  const body = el("main", { class: "fee" }, h, amounts, pdf, el("label", {}, FEE_COPY.yourFullName), name, accept);
  return { heading: h, body, refresh: load };
}
