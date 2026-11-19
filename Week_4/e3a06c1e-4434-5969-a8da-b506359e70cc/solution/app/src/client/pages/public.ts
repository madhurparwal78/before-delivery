// The public site: full-bleed hero field, the Signal path scroll scrub, Plans with the rounding
// calculator, and the trial request form, in that order.
import { billableSeconds, CENTS_PER_MINUTE, costCents, dollarsText, minutesText, parseLengthMs, type Plan } from "../../shared/billing";
import { band } from "../../shared/review";
import { api, GENERIC_FAILURE } from "../api";
import { field, h, prefersReducedMotion, say, uid } from "../dom";
import { SessionField } from "../field";
import type { PublicPage } from "../main";
import { wordmark } from "../shell";

const STAGE_PX = 320;
const STAGES: { name: string; text: string; figure: string; caption: string }[] = [
  { name: "Capture", figure: "16 kHz · 16-bit", caption: "PCM in", text: "16 kHz, 16-bit PCM arrives over the live endpoint or from an uploaded recording, and the original is kept byte for byte." },
  { name: "Stream", figure: "30 rows/s", caption: "FFT rows", text: "Every thirtieth of a second the server runs a real FFT over the newest audio, so the field advances 30 rows a second." },
  { name: "Recognise", figure: "0.85", caption: "flag threshold", text: "Words land with a confidence each. A segment whose weakest word falls below 0.85 is flagged for review." },
  { name: "Review", figure: "1.00", caption: "approved confidence", text: "Reviewers correct flagged words against the retained audio and an approver signs off. The machine original is never overwritten." },
  { name: "Meter", figure: "$0.06 / min", caption: "Pilot price", text: "At close, billable seconds are computed once under the plan in force at the start, then confirmed by billing." },
];
// The demo recording's words, with their machine confidences.
const DEMO_WORDS: [string, number][] = [
  ["patient", 0.97], ["reports", 0.95], ["dizziness", 0.91], ["after", 0.93], ["starting", 0.88], ["lisinopril", 0.52],
  ["fifteen", 0.71], ["milligrams", 0.9], ["daily", 0.94], ["review", 0.96], ["in", 0.93], ["two", 0.58], ["weeks", 0.9],
];
const RULE: Record<Plan, string> = {
  pilot: "Each session rounds up to whole minutes, per channel.",
  scale: "Billed per second with a 15-second minimum, per channel.",
};

export function renderPublic(page: PublicPage): void {
  const reduced = prefersReducedMotion();
  const fieldSlot = h("div", { class: "hero-field" });
  const demoRibbon = h(
    "ol",
    { class: "hero-ribbon", "aria-hidden": "true" },
    ...DEMO_WORDS.map(([word, confidence]) => h("li", { class: `tile band-${band(confidence)}` }, h("span", {}, word), band(confidence) === "low" ? h("span", { class: "tile-flag" }, "low") : null)),
  );
  const counters = { audio: h("span", { class: "num" }, "0.000"), billed: h("span", { class: "num" }, "0.00"), cost: h("span", { class: "num" }, "$0.00") };
  const demoStats = h(
    "dl",
    { class: "hero-stats", "aria-hidden": "true" },
    h("div", {}, h("dt", {}, "Audio s"), h("dd", {}, counters.audio)),
    h("div", {}, h("dt", {}, "Billed min"), h("dd", {}, counters.billed)),
    h("div", {}, h("dt", {}, "Cost"), h("dd", {}, counters.cost)),
  );
  const signIn = h("a", { href: "/sign-in", class: "button primary" }, "Sign in");
  const copy = h(
    "div",
    { class: "hero-copy" },
    h("p", { class: "eyebrow" }, "Lowfield Signal"),
    h("h1", {}, "Live speech recognition, metered to the second."),
    h("p", { class: "lead" }, "Per-project quotas, billing your finance team can reconcile, and a review flow that never overwrites the machine original."),
    signIn,
  );
  const hero = h("div", { class: "hero" }, h("div", { class: "hero-visual" }, fieldSlot, demoRibbon, demoStats), copy);

  const items = STAGES.map((stage, i) => h("li", { class: "stage-item" }, h("span", { class: "num stage-n" }, `0${i + 1}`), h("span", { class: "stage-name" }, stage.name)));
  const panels = STAGES.map((stage) => h(
      "article",
      { class: "stage-panel" },
      h("h3", {}, stage.name),
      h("p", {}, stage.text),
      h("p", { class: "stage-figure", "aria-hidden": "true" }, h("span", { class: "num" }, stage.figure), h("span", { class: "label" }, stage.caption)),
    ),
  );
  const signal = h(
    "section",
    { "aria-label": "Signal path", class: "signal", "data-stage": reduced ? "5" : "1" },
    h("div", { class: "signal-head" }, h("h2", {}, "Signal path"), h("p", { class: "muted" }, "From the first sample to the billed minute.")),
    h("ol", { class: "stage-list" }, ...items),
    h("div", { class: "stage-panels" }, ...panels),
  );
  const scrub = h("section", { class: `scrub${reduced ? " still" : ""}` }, h("div", { class: "scrub-stage" }, hero, signal));

  // ---- Plans and the rounding calculator ----
  const card = (plan: Plan, title: string, lead: string) =>
    h("article", { class: "plan" }, h("h3", {}, title), h("p", { class: "price num" }, dollarsText(CENTS_PER_MINUTE[plan]), h("span", {}, " per billable minute")), h("p", {}, RULE[plan]), h("p", { class: "muted" }, lead));
  const length = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false" });
  const lengthField = field("Session length in seconds", length, "Up to 3600 seconds, with up to three decimals.");
  const mono = h("input", { type: "radio", name: "channels", value: "1", id: uid("mono"), checked: true });
  const stereo = h("input", { type: "radio", name: "channels", value: "2", id: uid("stereo") });
  const channels = h(
    "fieldset",
    { role: "radiogroup", "aria-label": "Channels", class: "choices" },
    h("legend", {}, "Channels"),
    h("label", { for: mono.id, class: "choice" }, mono, h("span", {}, "Mono")),
    h("label", { for: stereo.id, class: "choice" }, stereo, h("span", {}, "Stereo")),
  );
  const billed = h("p", { role: "status", "aria-label": "Billed minutes", class: "billed num" });
  const recompute = () => {
    const text = length.value;
    if (text === "") {
      lengthField.error(null);
      say(billed, "");
      return;
    }
    const ms = parseLengthMs(text);
    if (ms === null) {
      lengthField.error("Enter a length from 0 to 3600 seconds.");
      say(billed, "");
      return;
    }
    lengthField.error(null);
    const n = stereo.checked ? 2 : 1;
    say(billed, `Pilot: ${minutesText(billableSeconds("pilot", ms, n))} billed minutes. Scale: ${minutesText(billableSeconds("scale", ms, n))} billed minutes.`);
  };
  for (const input of [length, mono, stereo]) input.addEventListener("input", recompute);
  for (const input of [mono, stereo]) input.addEventListener("change", recompute);
  const plans = h(
    "section",
    { "aria-label": "Plans", class: "plans band" },
    h("div", { class: "band-head" }, h("h2", {}, "Plans"), h("p", { class: "muted" }, "Two published rounding rules. Every figure says which one produced it.")),
    h("div", { class: "plan-cards" }, card("pilot", "Pilot", "For pilots and low-volume dictation."), card("scale", "Scale", "For contact centres streaming all day.")),
    h("div", { class: "calculator" }, h("h3", {}, "Rounding calculator"), h("div", { class: "calculator-grid" }, lengthField.root, channels), h("div", { class: "calc-result" }, h("span", { class: "label", "aria-hidden": "true" }, "Billed minutes"), billed)),
  );

  // ---- Trial request ----
  const inputs = { name: h("input", { type: "text", autocomplete: "name" }), email: h("input", { type: "email", autocomplete: "email" }), company: h("input", { type: "text", autocomplete: "organization" }) };
  const team = h("select", {}, h("option", { value: "contact_centre" }, "Contact centre"), h("option", { value: "clinical_dictation" }, "Clinical dictation"));
  const fields = { name: field("Name", inputs.name), email: field("Work email", inputs.email), company: field("Company", inputs.company), team: field("Team", team) };
  const send = h("button", { type: "submit", class: "primary" }, "Request trial");
  const trialStatus = h("p", { role: "status", "aria-label": "Trial status", class: "status-line" });
  const fieldset = h("div", { class: "trial-fields" }, fields.name.root, fields.email.root, fields.company.root, fields.team.root, h("div", { class: "button-row" }, send));
  const form = h("form", { "aria-label": "Request a trial workspace", novalidate: true, class: "trial-form" }, fieldset, trialStatus);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    Object.values(fields).forEach((f) => f.error(null));
    send.disabled = true;
    const result = await api<{ id: string }>("POST", "/api/trial-requests", { name: inputs.name.value, email: inputs.email.value, company: inputs.company.value, team: team.value });
    send.disabled = false;
    if (result.ok) {
      fieldset.remove();
      say(trialStatus, "Trial request received. We reply within two working days.");
      return;
    }
    if (result.error.fields) {
      for (const key of ["name", "email", "company", "team"] as const) fields[key].error(result.error.fields[key] ?? null);
    } else say(trialStatus, GENERIC_FAILURE);
  });
  const trial = h(
    "section",
    { "aria-labelledby": "trial-title", class: "trial band" },
    h("div", { class: "band-head" }, h("h2", { id: "trial-title" }, "Request a trial workspace"), h("p", { class: "muted" }, "A governed workspace with seeded projects, ready to stream within a day.")),
    form,
  );

  page.root.append(
    h("header", { class: "site-head" }, h("a", { href: "/", class: "wordmark" }, wordmark())),
    h("main", { class: "public" }, scrub, plans, trial),
    h("footer", { class: "site-foot" }, h("p", { class: "muted" }, "Lowfield Signal · speech recognition with a meter you can audit.")),
  );

  // ---- the scroll scrub: each stage owns 320 px of the first 1,600 ----
  let field_: SessionField | null = null;
  let stage = 0;
  const setStage = (next: number) => {
    if (next === stage) return;
    stage = next;
    signal.dataset.stage = String(next);
    items.forEach((item, i) => (i === next - 1 ? item.setAttribute("aria-current", "step") : item.removeAttribute("aria-current")));
    panels.forEach((panel, i) => panel.classList.toggle("active", i === next - 1));
    hero.dataset.stage = String(next);
    if (field_) field_.stage = next;
  };
  if (reduced) {
    items[4].setAttribute("aria-current", "step");
    hero.dataset.stage = "5";
  } else {
    const onScroll = () => setStage(Math.min(Math.floor(Math.max(0, scrollY) / STAGE_PX), 4) + 1);
    addEventListener("scroll", onScroll, { passive: true });
    page.onLeave(() => removeEventListener("scroll", onScroll));
    onScroll();
  }

  // ---- Meter stage: the demo recording's figures count up over 0.5 s, metered on Pilot ----
  let counting = 0;
  let demoMs = 0;
  const showMeter = (t: number) => {
    const seconds = billableSeconds("pilot", demoMs, 1);
    say(counters.audio, (Math.round(demoMs * t) / 1000).toFixed(3));
    say(counters.billed, minutesText(Math.round(seconds * t)));
    say(counters.cost, dollarsText(Math.round(costCents("pilot", seconds) * t)));
  };
  const countUp = () => {
    let begun = -1;
    const run = (now: number) => {
      if (begun < 0) begun = now;
      const t = Math.min(1, (now - begun) / 500);
      showMeter(t);
      if (t < 1) counting = requestAnimationFrame(run);
    };
    cancelAnimationFrame(counting);
    counting = requestAnimationFrame(run);
  };
  const observer = new MutationObserver(() => hero.dataset.stage === "5" && !reduced && countUp());
  observer.observe(hero, { attributes: true, attributeFilter: ["data-stage"] });
  page.onLeave(() => {
    observer.disconnect();
    cancelAnimationFrame(counting);
    field_?.destroy();
  });

  void api<{ frame_rate: number; rows: number[][] }>("GET", "/api/public/demo-spectrum").then((demo) => {
    if (!page.current()) return;
    const rows = demo.ok ? demo.data.rows : [];
    demoMs = Math.round((rows.length * 1000) / (demo.ok ? demo.data.frame_rate : 30));
    if (reduced) showMeter(1);
    field_ = new SessionField("Session field", { reducedMotion: reduced, demo: rows });
    field_.stage = reduced ? 5 : stage;
    fieldSlot.append(field_.canvas);
  });
}
