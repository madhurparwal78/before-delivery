import { apiFetch, formatPence, mountHeader, headerMarkup, loadingMarkup, startBannerRefresh } from "./api.js";
import { mountPlateFill, reducedMotionRequested } from "./plate-fill.js";

interface CampaignRow {
  id: string;
  title: string;
  status: string;
  total: number;
  goal: number;
  percent: number;
  cover_media_id: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

mountHeader("campaigns");
startBannerRefresh();

const list = document.getElementById("campaigns-list");
if (list !== null) {
  list.innerHTML = loadingMarkup();
  void (async () => {
    const { body } = await apiFetch("/api/campaigns");
    const campaigns = (Array.isArray(body) ? body : []) as CampaignRow[];
    if (campaigns.length === 0) {
      list.innerHTML = `
        <li class="empty">
          <div class="ring" aria-hidden="true"></div>
          <p>No live campaigns right now.</p>
        </li>`;
      return;
    }
    list.innerHTML = campaigns
      .map(
        (row) => `
        <li class="campaign-row">
          ${
            row.cover_media_id === null
              ? `<div class="circle small" aria-hidden="true"></div>`
              : `<img class="circle small" src="/api/media/${row.cover_media_id}" alt="">`
          }
          <div>
            <a class="plain" href="/campaigns/${row.id}"><strong>${escapeHtml(row.title)}</strong></a>
            <p class="muted" style="margin:4px 0 0">${row.status}</p>
          </div>
          <div class="row-total numeral">${formatPence(row.total)}</div>
          <div style="grid-column:1/-1">
            <span class="plate-fill mini" data-gauge="${row.id}" role="img" aria-label="Plate Fill: ${row.percent}%"></span>
          </div>
        </li>`,
      )
      .join("");
    list.querySelectorAll<HTMLElement>("[data-gauge]").forEach((container) => {
      const id = container.getAttribute("data-gauge");
      const row = campaigns.find((c) => c.id === id);
      if (row === undefined) return;
      const gauge = mountPlateFill(container, reducedMotionRequested());
      gauge.render({ total: row.total, goal: row.goal, stretch: [] }, String(row.percent));
    });
  })();
}
