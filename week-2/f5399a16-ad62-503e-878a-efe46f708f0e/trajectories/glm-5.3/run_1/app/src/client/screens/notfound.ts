// The not-found screen: `Page not found`, shown for an unknown page, an
// address of another desk and an erased client's address.

import { el, type ScreenContext, heading, link } from "../lib/ui";

export async function buildNotFound(ctx: ScreenContext): Promise<{ heading: HTMLElement; body: HTMLElement }> {
  const h = heading(["Page not found"], ctx.announcer);
  const body = el("main", { class: "notfound" }, h, el("p", {}, "There is nothing at this address."), el("p", {}, link("/", "Back to the reel")));
  return { heading: h, body };
}
