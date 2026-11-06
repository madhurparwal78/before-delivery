// The review page: steps Frames, Notes and Send, a film strip, a large frame
// with pins, and the Notes sheet — in the producer's language.

import { el, type ScreenContext } from "../lib/ui";
import { type Json } from "../lib/state";
import { api } from "../lib/ui";
import { PRIVATE_COPY, type Language, type PrivateKey } from "../../shared/copy";

export async function buildReview(_ctx: ScreenContext, token: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  let page: Json = {};
  let language = "en" as Language;
  let title = "Review";
  const h = el("h1", {});
  const steps = el("div", { role: "group", class: "steps" });
  const strip = el("div", { class: "film-strip", "aria-label": "Film strip" });
  const frameView = el("div", { "data-part": "frame-view", class: "frame-view" });
  const notesSheet = el("div", { class: "notes-sheet" });
  let step = 0;

  async function load(): Promise<void> {
    try {
      page = await api.get(`/api/r/${token}`);
    } catch {
      h.textContent = "This page has ended.";
      return;
    }
    language = String(page.language) as Language;
    const copy = PRIVATE_COPY[language];
    title = copy.reviewHeading.replace("<title>", String(page.jobTitle));
    h.textContent = title;
    steps.replaceChildren();
    const labels: PrivateKey[] = ["stepFrames", "stepNotes", "stepSend"];
    labels.forEach((key, index) => {
      const name = copy[key];
      const stepButton = el("button", { type: "button", class: "step" }, name);
      if (index === step) stepButton.setAttribute("aria-current", "step");
      stepButton.addEventListener("click", () => {
        step = index;
        void load();
      });
      steps.append(stepButton);
    });
    strip.replaceChildren();
    for (const frame of (page.frames as Json[]) ?? []) {
      const clip = el("button", {
        type: "button",
        "data-part": "clip",
        "data-frame": String(frame.number),
        "data-duration": String(frame.durationFrames),
        class: "clip",
      }, copy.clip.replace("<number>", String(frame.number)));
      clip.style.width = `${Number(frame.durationFrames) * 2}px`;
      strip.append(clip);
    }
  }
  await load();

  void notesSheet;
  const body = el("main", { class: "review", lang: language, dir: language === "ar" ? "rtl" : "ltr" }, h, steps, strip, frameView);
  return { heading: h, body, refresh: load };
}
