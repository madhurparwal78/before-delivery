/** Settings: the cancellation policy and its history. */

import type { CancellationPolicy, User } from "../../shared/api-types.js";
import { ApiClientError, apiJson } from "../api.js";
import type { Feedback } from "../feedback.js";
import { clearActivity, fallbackCopy, showActivity, showError } from "../feedback.js";

interface ScreenDeps {
  user: User | null;
  feedback: Feedback;
  navigate(path: string): void;
}

export async function renderSettings(root: HTMLElement, deps: ScreenDeps): Promise<void> {
  const user = deps.user;
  if (user === null || user.role !== "operator") return;
  const screen = document.createElement("div");
  screen.className = "screen";
  const title = document.createElement("h1");
  title.textContent = "Settings";
  screen.appendChild(title);

  const panel = document.createElement("section");
  panel.className = "panel";
  const form = document.createElement("form");
  form.setAttribute("aria-label", "Cancellation policy");
  form.className = "form-row";
  form.innerHTML = `
    <div><label for="free-window">Free cancellation window (hours)</label></div>
    <div><label for="late-charge">Late cancellation charge (%)</label></div>`;
  const freeWindow = document.createElement("input");
  freeWindow.type = "number";
  freeWindow.id = "free-window";
  freeWindow.min = "0";
  freeWindow.max = "168";
  freeWindow.step = "1";
  form.children[0].appendChild(freeWindow);
  const lateCharge = document.createElement("input");
  lateCharge.type = "number";
  lateCharge.id = "late-charge";
  lateCharge.min = "0";
  lateCharge.max = "100";
  lateCharge.step = "1";
  form.children[1].appendChild(lateCharge);
  const save = document.createElement("button");
  save.className = "btn primary";
  save.type = "submit";
  save.textContent = "Save policy";
  form.appendChild(save);
  panel.appendChild(form);
  screen.appendChild(panel);

  const historyPanel = document.createElement("section");
  historyPanel.className = "panel";
  const historyTitle = document.createElement("h2");
  historyTitle.textContent = "Policy history";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data";
  table.setAttribute("aria-label", "Policy history");
  table.innerHTML = `<thead><tr><th scope="col">Version</th><th scope="col">Free window</th><th scope="col">Late charge</th><th scope="col">Effective</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  wrap.appendChild(table);
  historyPanel.append(historyTitle, wrap);
  screen.appendChild(historyPanel);
  root.replaceChildren(screen);

  let basedOnVersion = 1;

  async function load(): Promise<void> {
    showActivity(deps.feedback, "Loading…");
    try {
      const res = await apiJson<{ current: CancellationPolicy; history: CancellationPolicy[] }>(
        "GET",
        "/api/cancellation-policy"
      );
      clearActivity(deps.feedback);
      basedOnVersion = res.current.version;
      freeWindow.value = String(res.current.free_window_hours);
      lateCharge.value = String(res.current.late_fee_percent);
      tbody.replaceChildren();
      for (const policy of res.history) {
        const tr = document.createElement("tr");
        const cells: Array<[string, string]> = [
          ["Version", String(policy.version)],
          ["Free window", `${policy.free_window_hours} hours`],
          ["Late charge", `${policy.late_fee_percent}%`],
          ["Effective", policy.effective_at.slice(0, 16).replace("T", " ")]
        ];
        for (const [label, value] of cells) {
          const td = document.createElement("td");
          td.dataset.label = label;
          td.textContent = value;
          td.className = "mono";
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    } catch (e) {
      clearActivity(deps.feedback);
      if (e instanceof ApiClientError) showError(deps.feedback, fallbackCopy(e));
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    showActivity(deps.feedback, "Saving policy…");
    try {
      const policy = await apiJson<CancellationPolicy>("PUT", "/api/cancellation-policy", {
        free_window_hours: Number(freeWindow.value),
        late_fee_percent: Number(lateCharge.value),
        based_on_version: basedOnVersion
      });
      clearActivity(deps.feedback);
      showActivity(
        deps.feedback,
        `Policy version ${policy.version} applies to bookings confirmed from now on. Existing bookings keep their terms.`
      );
      await load();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.detail.code === "stale_version") {
          showError(
            deps.feedback,
            `The policy changed since you opened it. Reload to see version ${e.detail.details["current_version"]}.`
          );
        } else {
          showError(deps.feedback, fallbackCopy(e));
        }
      }
    } finally {
      save.disabled = false;
    }
  });

  await load();
}
