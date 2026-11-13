/**
 * Objectives: the service strip above the objective panel (rule M).
 */
import { addLiveHandler, api } from "./api";
import { namedAlert } from "./shell";
import { h } from "./core";

interface ObjectiveView {
  id: string;
  service: string;
  name: string;
  target: number;
  budget_remaining: string;
  long: { bad: number; total: number; burn: string };
  short: { bad: number; total: number; burn: string };
  status: string;
  objective_counts: { bad: number; total: number };
}

export function buildObjectives(view: HTMLElement): void {
  const services = h("div", { role: "list", "aria-label": "Services" });
  services.style.display = "flex";
  services.style.gap = "8px";
  services.style.flexWrap = "wrap";
  const panel = h("div", { role: "region", "aria-label": "Objective", class: "card" });
  panel.style.marginTop = "12px";
  const holder = h("div", {});
  view.append(services, panel, holder);

  async function load(): Promise<void> {
    try {
      const res = await api<{ objectives: ObjectiveView[] }>("/api/objectives");
      services.replaceChildren();
      for (const o of res.objectives) {
        const btn = h("button", { class: "btn", "aria-label": o.service }, o.service);
        btn.addEventListener("click", () => fillPanel(o));
        services.append(btn);
      }
      if (res.objectives.length > 0) fillPanel(res.objectives[0]);
      if (res.objectives.length === 0) {
        const link = document.createElement("a");
        link.href = "/rules";
        link.textContent = "Published rules";
        const band = h("div", { class: "empty-band", role: "region", "aria-label": "Empty" });
        band.append(h("div", {}, "No objectives yet."), link);
        holder.append(band);
      }
    } catch {
      holder.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  }

  function fillPanel(o: ObjectiveView): void {
    panel.replaceChildren();
    panel.append(h("h3", {}, o.name));
    const lines = [
      `Budget remaining ${o.budget_remaining}%`,
      `Long burn ${o.long.burn}`,
      `Short burn ${o.short.burn}`,
      `Status ${o.status}`,
      `${o.objective_counts.bad} bad of ${o.objective_counts.total}`,
    ];
    for (const line of lines) {
      panel.append(Object.assign(document.createElement("div"), { textContent: line, className: "mono" }));
    }
  }

  addLiveHandler("upload", () => void load());
  addLiveHandler("clock", () => void load());
  void load();
}
