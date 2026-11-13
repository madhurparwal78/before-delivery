import { PageCtx } from "../main";
import { h } from "../ui";

export async function renderNotFound(ctx: PageCtx, generic = false): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  const isOwner = ctx.user.role === "owner";
  const wrap = h("div", { class: "container", style: "padding-top:56px;padding-bottom:80px;display:flex;justify-content:center" });
  const card = h("div", { class: "card", style: "max-width:520px" });
  card.appendChild(h("h1", { style: "font-size:1.6em" }, generic ? "We couldn't find that page" : "We couldn't find that project"));
  card.appendChild(h("p", { class: "muted", style: "margin-top:8px" }, "It may have been erased, or the link is wrong."));
  card.appendChild(h("a", { class: "btn btn-primary", style: "margin-top:20px", href: isOwner ? "/desk" : "/review" }, isOwner ? "Back to your desk" : "Back to your review queue"));
  wrap.appendChild(card);
  main.appendChild(wrap);
}
