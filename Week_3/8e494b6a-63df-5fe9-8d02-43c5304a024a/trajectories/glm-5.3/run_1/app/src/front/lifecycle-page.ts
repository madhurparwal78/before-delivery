/**
 * The lifecycle page: policy form above the generation timeline.
 */
import { addLiveHandler, api, ApiFail, showNotice } from "./api";
import { formatInZone } from "../shared/tz";
import { me } from "./api";
import { h } from "./core";
import type { GenerationInfo, LifecyclePolicy } from "../shared/types";

export function buildLifecycle(view: HTMLElement, stream: string): void {
  const wrap = h("div", {});
  const policyCard = h("div", { class: "card" });
  policyCard.style.maxWidth = "560px";
  const fields: [string, string][] = [
    ["rollover_max_age_ms", "Rollover max age (ms)"],
    ["rollover_max_events", "Rollover max events"],
    ["warm_after_ms", "Warm after (ms)"],
    ["archive_after_ms", "Archive after (ms)"],
    ["delete_after_ms", "Delete after (ms)"],
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  const rows = h("div", { style: { display: "grid", gridTemplateColumns: "240px 140px", gap: "8px" } });
  for (const [key, label] of fields) {
    const lab = h("label", { for: `lc-${key}` }, label);
    const input = document.createElement("input");
    input.className = "input mono";
    input.id = `lc-${key}`;
    input.setAttribute("aria-label", label);
    inputs[key] = input;
    rows.append(lab, input);
  }
  const save = h("button", { class: "btn-main" }, "Save policy");
  save.addEventListener("click", async () => {
    save.setAttribute("aria-busy", "true");
    const body: Record<string, number | null> = {};
    for (const [key] of fields) {
      const v = inputs[key].value.trim();
      body[key] = v === "" ? null : Number(v);
    }
    try {
      const res = await api<{ policy: LifecyclePolicy; message: string }>(
        `/api/streams/${encodeURIComponent(stream)}/lifecycle`,
        {
          method: "PUT",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        },
      );
      showNotice(res.message);
      void loadTimeline();
    } catch (err) {
      if (err instanceof ApiFail) showNotice(err.body.message);
    } finally {
      save.removeAttribute("aria-busy");
    }
  });
  policyCard.append(h("h2", {}, "Lifecycle policy"), rows, save);

  const timeline = h("div", { role: "list", "aria-label": "Generation timeline", class: "card" });
  const notice = h("div", {});

  wrap.append(policyCard, timeline, notice);
  view.append(wrap);

  async function loadTimeline(): Promise<void> {
    try {
      const res = await api<{ generations: GenerationInfo[] }>(
        `/api/streams/${encodeURIComponent(stream)}/generations`,
      );
      timeline.replaceChildren(h("h3", {}, "Generation timeline"));
      for (const g of res.generations) {
        const item = h("div", { role: "listitem", class: "mono" });
        item.style.padding = "8px 0";
        item.style.borderBottom = "1px solid var(--hairline)";
        const bands = h("div", {});
        bands.style.display = "flex";
        bands.style.gap = "4px";
        bands.style.marginTop = "4px";
        for (const phase of ["hot", "warm", "archive", "delete"]) {
          const band = h("div", {});
          band.style.flex = "1";
          band.style.height = "8px";
          band.style.background =
            phase === g.phase
              ? "var(--accent)"
              : phase === "delete"
                ? "var(--hairline)"
                : "var(--hairline)";
          if (phase === g.phase) band.style.opacity = "1";
          else band.style.opacity = "0.4";
          bands.append(band);
        }
        item.append(Object.assign(document.createElement("div"), { textContent: g.timeline }), bands);
        timeline.append(item);
      }
    } catch {
      timeline.replaceChildren();
    }
  }

  addLiveHandler("lifecycle", (data) => {
    void loadTimeline();
  });

  void loadTimeline();
}
