// The Sealed scores marquee: one full pass every 45 seconds, paused on hover and focus, stoppable.
import { h } from "./dom.js";
import { pct } from "./dom.js";
import { get } from "./api.js";

export function marquee() {
  const reduced = () => document.documentElement.dataset.motion === "reduced";
  const track = h("ul", { class: "marquee-track" });
  const stop = h("button", { type: "button", text: "Stop scores" });
  const run = h("button", { type: "button", text: "Run scores", hidden: true });
  const region = h("section", { class: "marquee field-white", role: "region", "aria-label": "Sealed scores", "data-motion-ms": reduced() ? "0" : "45000" },
    h("div", { class: "marquee-window" }, track), h("div", { class: "marquee-controls" }, stop, run));
  let stopped = false;
  const apply = () => {
    region.dataset.motionMs = reduced() ? "0" : "45000";
    region.classList.toggle("is-stopped", stopped);
    stop.hidden = stopped || reduced();
    run.hidden = !stopped || reduced();
  };
  stop.addEventListener("click", () => { stopped = true; apply(); run.focus(); });
  run.addEventListener("click", () => { stopped = false; apply(); stop.focus(); });
  region.addEventListener("pointerenter", () => region.classList.add("is-paused"));
  region.addEventListener("pointerleave", () => region.classList.remove("is-paused"));
  region.addEventListener("focusin", () => region.classList.add("is-paused"));
  region.addEventListener("focusout", () => region.classList.remove("is-paused"));
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });

  get("/api/public/sealed-scores").then(({ items: sealedScores }) => {
    if (!sealedScores.length) {
      track.append(h("li", { class: "marquee-item", text: "NO SEALED HOURS YET." }));
      return;
    }
    const texts = sealedScores.map((score) => `${score.site_name} ${score.month} HOUR ${pct(score.hour_bp)}%`);
    for (const text of texts) track.append(h("li", { class: "marquee-item", text }));
    for (const text of texts) track.append(h("li", { class: "marquee-item", "aria-hidden": "true", text }));
  }).catch(() => {});
  apply();
  return { el: region, destroy() { observer.disconnect(); } };
}
