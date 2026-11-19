import { apiFetch, formatPence, mountHeader, headerMarkup, loadingMarkup, startBannerRefresh } from "./api.js";
import { mountPlateFill, reducedMotionRequested, type PlateFill } from "./plate-fill.js";

interface CampaignRow {
  id: string;
  title: string;
  status: string;
  total: number;
  goal: number;
  percent: number;
  pledging_open: boolean;
  cover_media_id: string | null;
}

/** The halftone ramp: a row of shrinking dots fading the disc edge into paper. */
function buildHalftoneRamp(): void {
  const ramp = document.getElementById("hero-ramp");
  if (ramp === null) return;
  const dotCount = 14;
  const parts: string[] = [];
  for (let i = 0; i < dotCount; i += 1) {
    const t = i / (dotCount - 1);
    const size = 34 * (1 - t);
    const opacity = 1 - t * 0.9;
    const right = i * 26;
    parts.push(
      `<span class="hdot" style="width:${size}px;height:${size}px;right:${right}px;top:calc(50% - ${size / 2}px);opacity:${opacity}"></span>`,
    );
  }
  ramp.innerHTML = parts.join("");
}

async function loadCampaigns(): Promise<void> {
  const list = document.getElementById("live-campaigns");
  if (list === null) return;
  list.innerHTML = loadingMarkup();
  const { body } = await apiFetch("/api/campaigns");
  const campaigns = (Array.isArray(body) ? body : []).filter(
    (row: CampaignRow) => row.status === "live",
  ) as CampaignRow[];
  if (campaigns.length === 0) {
    list.innerHTML = `
      <li class="empty">
        <div class="ring" aria-hidden="true"></div>
        <p>No live campaigns right now.</p>
      </li>`;
    return;
  }
  const items: string[] = [];
  const gauges: { container: HTMLElement; row: CampaignRow }[] = [];
  campaigns.forEach((row) => {
    const cover =
      row.cover_media_id === null
        ? `<div class="circle small" aria-hidden="true"></div>`
        : `<img class="circle small" src="/api/media/${row.cover_media_id}" alt="">`;
    items.push(`
      <li class="campaign-row">
        ${cover}
        <div>
          <a class="plain" href="/campaigns/${row.id}"><strong>${escapeHtml(row.title)}</strong></a>
        </div>
        <div class="row-total">
          <span class="numeral">${formatPence(row.total)}</span>
        </div>
        <div class="row-gauge" style="grid-column: 1 / -1">
          <span class="plate-fill mini" data-gauge="${row.id}" role="img" aria-label="Plate Fill: ${row.percent}%"></span>
        </div>
      </li>`);
  });
  list.innerHTML = items.join("");
  list.querySelectorAll<HTMLElement>("[data-gauge]").forEach((container) => {
    const id = container.getAttribute("data-gauge");
    const row = campaigns.find((c) => c.id === id);
    if (row !== undefined) {
      gauges.push({ container, row });
    }
  });
  for (const gauge of gauges) {
    const plateFill = mountPlateFill(gauge.container, reducedMotionRequested());
    plateFill.render(
      { total: gauge.row.total, goal: gauge.row.goal, stretch: [] },
      String(gauge.row.percent),
    );
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mountStartButton(): void {
  const anchor = document.getElementById("start-campaign");
  if (anchor === null) return;
  const button = document.createElement("button");
  button.textContent = "Start a campaign";
  button.setAttribute("aria-label", "Start a campaign");
  button.addEventListener("click", () => {
    window.location.href = "/studio";
  });
  anchor.replaceChildren(button);
}

mountHeader("home");
mountStartButton();
buildHalftoneRamp();
startBannerRefresh();
loadCampaigns().catch(() => undefined);
