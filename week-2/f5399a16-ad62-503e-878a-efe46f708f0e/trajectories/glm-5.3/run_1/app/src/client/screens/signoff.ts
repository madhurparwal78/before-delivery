// The sign-off page: the cut's frames as a read-only list with captions, the
// name field and the button, in the producer's language.

import { el, type ScreenContext, field } from "../lib/ui";
import { ApiError, type Json } from "../lib/state";
import { api } from "../lib/ui";
import { PRIVATE_COPY, type Language } from "../../shared/copy";

export async function buildSignOff(ctx: ScreenContext, token: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const h = el("h1", {});
  const list = el("ul", { class: "frames-list" });
  const name = field("input", { type: "text", autocomplete: "name" });
  const result = el("p", { class: "signed-text" });
  let language = "en" as Language;

  async function load(): Promise<void> {
    let page: Json;
    try {
      page = await api.get(`/api/s/${token}`);
    } catch {
      h.textContent = "This page has ended.";
      return;
    }
    language = String(page.language) as Language;
    const copy = PRIVATE_COPY[language];
    h.textContent = copy.signOffHeading.replace("<title>", String(page.jobTitle));
    list.replaceChildren();
    for (const frame of (page.frames as Json[]) ?? []) {
      list.append(el("li", {}, `Frame ${String(frame.number)} · ${String(frame.timecodeIn)} · ${String(frame.actionNote)}`));
    }
    if (page.signedOffText !== null && page.signedOffText !== undefined) {
      result.textContent = String(page.signedOffText);
    }
  }
  await load();

  const sign = el("button", { type: "button", class: "primary" }, PRIVATE_COPY[language].signOffButton);
  sign.style.minHeight = "44px";
  sign.addEventListener("click", async () => {
    try {
      const answer = await api.post(`/api/s/${token}/sign`, { name: name.value });
      ctx.announcer.announce(String(answer.signedOffText ?? ""));
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        ctx.announcer.announce(e.message);
        result.textContent = e.message;
      }
    }
  });

  const body = el("main", { class: "signoff", lang: language, dir: language === "ar" ? "rtl" : "ltr" }, h, list, el("label", {}, PRIVATE_COPY[language].nameField), name, sign, result);
  return { heading: h, body, refresh: load };
}
