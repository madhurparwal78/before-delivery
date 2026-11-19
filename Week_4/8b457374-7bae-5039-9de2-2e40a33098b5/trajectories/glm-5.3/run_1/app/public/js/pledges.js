import {
  STATE_WORDS,
  apiFetch,
  formatPence,
  loadingMarkup,
  mountHeader,
  startBannerRefresh
} from "./chunk-JDNZ7ISK.js";

// src/frontend/pledges.ts
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
mountHeader("pledges");
startBannerRefresh();
async function load() {
  const list = document.getElementById("pledges-list");
  if (list === null) return;
  list.innerHTML = loadingMarkup();
  const { status, body } = await apiFetch("/api/me/pledges");
  if (status === 401 || !Array.isArray(body)) {
    list.innerHTML = `
      <li class="empty">
        <div class="ring" aria-hidden="true"></div>
        <p>No pledges yet. Back a run and it will show here.</p>
      </li>`;
    return;
  }
  const pledges = body;
  if (pledges.length === 0) {
    list.innerHTML = `
      <li class="empty">
        <div class="ring" aria-hidden="true"></div>
        <p>No pledges yet. Back a run and it will show here.</p>
      </li>`;
    return;
  }
  list.innerHTML = pledges.map(
    (pledge) => `
      <li>
        <div class="campaign-row">
          ${pledge.campaign.cover_media_id === null ? `<div class="circle small" aria-hidden="true"></div>` : `<img class="circle small" src="/api/media/${pledge.campaign.cover_media_id}" alt="">`}
          <div>
            <a class="plain" href="/campaigns/${pledge.campaign.id}"><strong>${escapeHtml(pledge.campaign.title)}</strong></a>
            <p class="mark" style="margin:6px 0 0">
              <span class="glyph ${pledge.state}" aria-hidden="true"></span> ${STATE_WORDS[pledge.state] ?? pledge.state}
            </p>
          </div>
          <div class="row-total numeral">${formatPence(pledge.amount)}</div>
        </div>
        <div class="actions-row">
          ${pledge.state === "captured" ? pledge.statement === "ready" ? `<a class="plain" href="/api/pledges/${pledge.id}/statement.pdf">Download statement</a>` : `<span>Statement being prepared</span>` : ""}
          ${pledge.state === "errored" && pledge.fix_code !== null ? `<a class="plain" href="/fix/${pledge.fix_code}">Fix payment</a>` : ""}
          ${pledge.state === "authorised" ? `<a class="plain" href="/campaigns/${pledge.campaign_id}?manage=1">Manage pledge</a>` : ""}
        </div>
      </li>`
  ).join("");
}
void load();
