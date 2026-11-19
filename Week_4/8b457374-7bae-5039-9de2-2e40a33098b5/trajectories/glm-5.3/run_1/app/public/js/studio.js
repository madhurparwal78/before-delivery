import {
  mountPlateFill,
  reducedMotionRequested
} from "./chunk-V5KNXBSB.js";
import {
  apiFetch,
  formatPence,
  loadKey,
  loadingMarkup,
  mountHeader,
  startBannerRefresh,
  storeKey
} from "./chunk-JDNZ7ISK.js";

// src/frontend/studio.ts
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
mountHeader("studio");
startBannerRefresh();
async function loadCampaigns() {
  const list = document.getElementById("my-campaigns");
  if (list === null) return;
  if (loadKey() === null) {
    list.innerHTML = `
      <li class="empty">
        <div class="ring" aria-hidden="true"></div>
        <p>No campaigns yet. Start one when your printer quotes a minimum run.</p>
      </li>`;
    return;
  }
  list.innerHTML = loadingMarkup();
  const { status, body } = await apiFetch("/api/me/campaigns");
  if (status !== 200 || !Array.isArray(body)) {
    list.innerHTML = `
      <li class="empty">
        <div class="ring" aria-hidden="true"></div>
        <p>No campaigns yet. Start one when your printer quotes a minimum run.</p>
      </li>`;
    return;
  }
  const campaigns = body;
  if (campaigns.length === 0) {
    list.innerHTML = `
      <li class="empty">
        <div class="ring" aria-hidden="true"></div>
        <p>No campaigns yet. Start one when your printer quotes a minimum run.</p>
      </li>`;
    return;
  }
  list.innerHTML = campaigns.map(
    (row) => `
      <li class="campaign-row">
        ${row.cover_media_id === null ? `<div class="circle small" aria-hidden="true"></div>` : `<img class="circle small" src="/api/media/${row.cover_media_id}" alt="">`}
        <div>
          <a class="plain" href="/studio/${row.id}"><strong>${escapeHtml(row.title)}</strong></a>
          <p style="margin:4px 0 0"><span class="chip">${row.status}</span></p>
        </div>
        <div class="row-total numeral">${formatPence(row.total)}</div>
        <div style="grid-column:1/-1">
          <span class="plate-fill mini" data-gauge="${row.id}" role="img" aria-label="Plate Fill: ${row.percent}%"></span>
        </div>
      </li>`
  ).join("");
  list.querySelectorAll("[data-gauge]").forEach((container) => {
    const id = container.getAttribute("data-gauge");
    const row = campaigns.find((c) => c.id === id);
    if (row === void 0) return;
    const gauge = mountPlateFill(container, reducedMotionRequested());
    gauge.render({ total: row.total, goal: row.goal, stretch: [] }, String(row.percent));
  });
}
function openDetailsDialog() {
  const dialog = document.getElementById("details-dialog");
  if (dialog === null) return;
  const hasKey = loadKey() !== null;
  dialog.innerHTML = `
    <form method="dialog" aria-label="Your details">
      <h2>Your details</h2>
      <label for="detail-name">Name</label>
      <input id="detail-name" autocomplete="name">
      <label for="detail-email">Email</label>
      <input id="detail-email" type="email" autocomplete="email">
      <p class="field-error" id="detail-error" hidden></p>
      <div class="actions">
        <button type="button" id="detail-continue">Continue</button>
        <button type="button" class="secondary" id="detail-use-key">Use key</button>
      </div>
      <div id="key-entry" hidden>
        <label for="detail-key">Key</label>
        <input id="detail-key" autocomplete="off">
        <p class="field-error" id="key-error" hidden></p>
        <div class="actions">
          <button type="button" id="detail-adopt">Use key</button>
        </div>
      </div>
      <div id="key-shown" hidden>
        <p><strong>Your Dotgain key:</strong></p>
        <p><code id="key-text"></code></p>
        <p class="muted">Keep this key safe. It is shown only once.</p>
        <div class="actions">
          <button type="button" id="detail-done">Done</button>
        </div>
      </div>
    </form>`;
  dialog.showModal();
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialog.querySelectorAll("button, input, [href]")
    ).filter((element) => !element.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  const error = dialog.querySelector("#detail-error");
  dialog.querySelector("#detail-continue")?.addEventListener("click", async () => {
    const name = dialog.querySelector("#detail-name").value;
    const email = dialog.querySelector("#detail-email").value;
    const { status, body } = await apiFetch("/api/people", {
      method: "POST",
      body: JSON.stringify({ name, email })
    });
    if (status !== 201) {
      const fields = body.fields;
      if (error !== null) {
        error.textContent = fields?.name ?? fields?.email ?? "Enter your details.";
        error.hidden = false;
      }
      return;
    }
    const person = body;
    storeKey(person.key);
    const shown = dialog.querySelector("#key-shown");
    if (shown !== null) {
      shown.hidden = false;
      dialog.querySelector("#key-text").textContent = person.key;
    }
    const keyEntry = dialog.querySelector("#key-entry");
    if (keyEntry !== null) keyEntry.hidden = true;
  });
  dialog.querySelector("#detail-use-key")?.addEventListener("click", () => {
    const keyEntry = dialog.querySelector("#key-entry");
    if (keyEntry !== null) keyEntry.hidden = false;
    dialog.querySelector("#detail-key")?.focus();
  });
  dialog.querySelector("#detail-adopt")?.addEventListener("click", async () => {
    const key = dialog.querySelector("#detail-key").value.trim();
    const { status } = await apiFetch("/api/me", {
      headers: { Authorization: `Bearer ${key}` }
    });
    const keyError = dialog.querySelector("#key-error");
    if (status === 200) {
      storeKey(key);
      dialog.close();
      window.location.href = "/studio";
      return;
    }
    if (keyError !== null) {
      keyError.textContent = "That key was not recognised.";
      keyError.hidden = false;
    }
  });
  dialog.querySelector("#detail-done")?.addEventListener("click", () => {
    dialog.close();
    window.location.href = "/studio";
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });
  if (hasKey) {
    window.location.href = "/studio/new";
  }
}
document.getElementById("new-campaign")?.addEventListener("click", () => {
  if (loadKey() === null) {
    openDetailsDialog();
  } else {
    window.location.href = "/studio/new";
  }
});
void loadCampaigns();
