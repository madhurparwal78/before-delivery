// Home: the split hero, a short list of three kinds of work, and the link to
// the reel.

import { el, link, type ScreenContext, heading } from "../lib/ui";

export async function buildHome(ctx: ScreenContext): Promise<{ heading: HTMLElement; body: HTMLElement }> {
  const h = heading(["Boards drawn to the frame"], ctx.announcer);
  const frame = el("div", { class: "hero-frame", "aria-hidden": "true" });
  const card = el("section", { class: "hero-card" });
  const band = el("div", { class: "clapband", "aria-hidden": "true" });
  card.append(
    band,
    el("p", { class: "wordmark" }, "Noor Bakker Boards"),
    h.cloneNode(true) as HTMLElement,
    el("p", { class: "hero-copy" }, "One desk from script file to signed-off delivery and fee letter."),
    link("/reel", "See the reel", { class: "action" }),
    el("p", { class: "hero-foot" }, "See the reel"),
  );
  const hero = el("section", { class: "hero" }, frame, card);
  const kinds = el("ul", { class: "kinds" },
    el("li", {}, "Boards for a :30 that hold on a beat."),
    el("li", {}, "Story reels that land the timing."),
    el("li", {}, "Pitch frames that carry a whole room."),
  );
  const foot = el("p", { class: "home-foot" },
    link("/how-it-works", "How it works"), " · ",
    link("/how-it-works#amsterdam", "Contact"), " · ",
    link("/sign-in", "Sign in"),
  );
  const body = el("main", { class: "home" }, hero, kinds, foot);
  return { heading: h, body };
}
