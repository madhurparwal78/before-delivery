import {
  mountPlateFill,
  reducedMotionRequested
} from "./chunk-V5KNXBSB.js";
import {
  STATE_WORDS,
  apiFetch,
  countriesSorted,
  formatPence,
  loadKey,
  loadingMarkup,
  mountHeader,
  parsePoundsField,
  startBannerRefresh
} from "./chunk-JDNZ7ISK.js";

// src/frontend/editor.ts
var pathMatch = window.location.pathname.match(/^\/studio\/campaigns\/([^/]+)$/);
var newPathMatch = window.location.pathname === "/studio/new";
var campaignId = pathMatch !== null ? pathMatch[1] : "";
var reducedMotion = reducedMotionRequested();
var campaign = null;
var breaks = [];
var tiers = [];
var plateFill = null;
mountHeader("studio");
startBannerRefresh();
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function announce(text) {
  const region = document.getElementById("studio-result");
  if (region !== null) region.textContent = text;
}
function timeZones() {
  return Intl.supportedValuesOf("timeZone");
}
function renderForm() {
  if (campaign === null) return;
  const form = document.getElementById("editor-form");
  if (form === null) return;
  const deadlineValue = campaign.deadline_local.slice(0, 16).replace("T", " ");
  const zoneOptions = timeZones().map((zone) => `<option value="${zone}"${zone === campaign?.time_zone ? " selected" : ""}>${zone}</option>`).join("");
  const countryOptions = countriesSorted().map(
    (country) => `<option value="${country.code}"${country.code === campaign?.ships_from ? " selected" : ""}>${country.name}</option>`
  ).join("");
  form.innerHTML = `
    <form id="campaign-form" onsubmit="return false">
      <label for="f-title">Title</label>
      <input id="f-title" value="${escapeHtml(campaign.title)}">
      <label for="f-story">Story</label>
      <textarea id="f-story">${escapeHtml(campaign.story)}</textarea>
      <label for="f-goal">Goal (\xA3)</label>
      <input class="numeral" id="f-goal" inputmode="decimal" value="${(campaign.goal / 100).toFixed(2)}">
      <label for="f-min-run">Minimum run (copies)</label>
      <input class="numeral" id="f-min-run" type="number" min="10" value="${campaign.min_run_copies}">
      <label for="f-ships">Ships from</label>
      <select id="f-ships">${countryOptions}</select>
      <label for="f-zone">Time zone</label>
      <select id="f-zone">${zoneOptions}</select>
      <label for="f-deadline">Deadline</label>
      <input id="f-deadline" placeholder="YYYY-MM-DD HH:MM" value="${deadlineValue}">
      <p id="field-errors" class="field-error" hidden></p>
      <div class="pledge-actions">
        <button type="button" id="save-draft">Save draft</button>
      </div>
      <h3>Break points</h3>
      <div id="breaks"></div>
      <p><button type="button" class="secondary" id="add-break">Add break point</button></p>
      <h3>Tiers</h3>
      <div id="tiers"></div>
      <p><button type="button" class="secondary" id="add-tier">Add tier</button></p>
      <h3>Images</h3>
      <label for="cover-input">Cover art</label>
      <input id="cover-input" type="file" accept="image/png,image/jpeg,image/webp">
      <label for="spread-input">Spread previews</label>
      <input id="spread-input" type="file" accept="image/png,image/jpeg,image/webp" multiple>
      <ul class="plain" id="images" aria-label="Images"></ul>
      <div class="pledge-actions">
        <button type="button" id="launch-campaign">Launch campaign</button>
      </div>
    </form>`;
  renderBreaks();
  renderTiers();
  renderImages();
  document.getElementById("save-draft")?.addEventListener("click", () => {
    void saveDraft();
  });
  document.getElementById("add-break")?.addEventListener("click", () => {
    breaks.push({ copies: "", amount: "" });
    renderBreaks();
  });
  document.getElementById("add-tier")?.addEventListener("click", () => {
    tiers.push({ title: "", description: "", price: "", quantity: "", domestic: "", europe: "", restOfWorld: "" });
    renderTiers();
  });
  document.getElementById("launch-campaign")?.addEventListener("click", () => {
    void launch();
  });
  document.getElementById("cover-input")?.addEventListener("change", (event) => {
    void uploadImages(event, "cover");
  });
  document.getElementById("spread-input")?.addEventListener("change", (event) => {
    void uploadImages(event, "spread");
  });
}
function renderBreaks() {
  const container = document.getElementById("breaks");
  if (container === null) return;
  if (breaks.length === 0) {
    container.innerHTML = `<p class="muted">No break points yet.</p>`;
    return;
  }
  container.innerHTML = breaks.map(
    (entry, index) => `
      <fieldset class="fieldset">
        <legend class="legend">Break point ${index + 1}</legend>
        <div class="break-grid">
          <div>
            <label for="break-copies-${index}">Copies</label>
            <input class="numeral" id="break-copies-${index}" type="number" min="1" value="${entry.copies}">
          </div>
          <div>
            <label for="break-amount-${index}">Amount (\xA3)</label>
            <input class="numeral" id="break-amount-${index}" inputmode="decimal" value="${entry.amount}">
          </div>
        </div>
      </fieldset>`
  ).join("");
  breaks.forEach((_, index) => {
    const copies = document.getElementById(`break-copies-${index}`);
    const amount = document.getElementById(`break-amount-${index}`);
    copies?.addEventListener("input", () => {
      breaks[index] = { ...breaks[index], copies: copies.value };
    });
    amount?.addEventListener("input", () => {
      breaks[index] = { ...breaks[index], amount: amount.value };
    });
  });
}
function renderTiers() {
  const container = document.getElementById("tiers");
  if (container === null) return;
  if (tiers.length === 0) {
    container.innerHTML = `<p class="muted">No tiers yet.</p>`;
    return;
  }
  container.innerHTML = tiers.map(
    (tier, index) => `
      <fieldset class="fieldset" data-tier-index="${index}">
        <legend class="legend">Tier ${index + 1}</legend>
        <label for="tier-title-${index}">Tier title</label>
        <input id="tier-title-${index}" value="${escapeHtml(tier.title)}">
        <label for="tier-desc-${index}">Description</label>
        <textarea id="tier-desc-${index}" style="min-height:80px">${escapeHtml(tier.description)}</textarea>
        <div class="break-grid">
          <div>
            <label for="tier-price-${index}">Price (\xA3)</label>
            <input class="numeral" id="tier-price-${index}" inputmode="decimal" value="${tier.price}">
          </div>
          <div>
            <label for="tier-qty-${index}">Copies available</label>
            <input class="numeral" id="tier-qty-${index}" type="number" min="1" value="${tier.quantity}">
          </div>
        </div>
        <div class="break-grid">
          <div>
            <label for="tier-dom-${index}">Domestic shipping (\xA3)</label>
            <input class="numeral" id="tier-dom-${index}" inputmode="decimal" value="${tier.domestic}">
          </div>
          <div>
            <label for="tier-eu-${index}">Europe shipping (\xA3)</label>
            <input class="numeral" id="tier-eu-${index}" inputmode="decimal" value="${tier.europe}">
          </div>
        </div>
        <label for="tier-row-${index}">Rest of world shipping (\xA3)</label>
        <input class="numeral" id="tier-row-${index}" inputmode="decimal" value="${tier.restOfWorld}">
        <div class="pledge-actions">
          <button type="button" id="tier-save-${index}">Save tier</button>
          <button type="button" class="secondary" id="tier-remove-${index}">Remove tier</button>
        </div>
      </fieldset>`
  ).join("");
  tiers.forEach((tier, index) => {
    bindTierField(`tier-title-${index}`, () => {
      tiers[index] = { ...tier, title: valueOf(`tier-title-${index}`) };
    });
    bindTierField(`tier-desc-${index}`, () => {
      tiers[index] = { ...tier, description: valueOf(`tier-desc-${index}`) };
    });
    bindTierField(`tier-price-${index}`, () => {
      tiers[index] = { ...tier, price: valueOf(`tier-price-${index}`) };
    });
    bindTierField(`tier-qty-${index}`, () => {
      tiers[index] = { ...tier, quantity: valueOf(`tier-qty-${index}`) };
    });
    bindTierField(`tier-dom-${index}`, () => {
      tiers[index] = { ...tier, domestic: valueOf(`tier-dom-${index}`) };
    });
    bindTierField(`tier-eu-${index}`, () => {
      tiers[index] = { ...tier, europe: valueOf(`tier-eu-${index}`) };
    });
    bindTierField(`tier-row-${index}`, () => {
      tiers[index] = { ...tier, restOfWorld: valueOf(`tier-row-${index}`) };
    });
    document.getElementById(`tier-save-${index}`)?.addEventListener("click", () => {
      void saveTier(index);
    });
    document.getElementById(`tier-remove-${index}`)?.addEventListener("click", () => {
      void removeTier(index);
    });
  });
}
function bindTierField(id, apply) {
  const field = document.getElementById(id);
  field?.addEventListener("input", apply);
}
function valueOf(id) {
  return document.getElementById(id)?.value ?? "";
}
function tierFromEditor(index) {
  const tier = tiers[index];
  const price = parsePoundsField(tier.price);
  const domestic = parsePoundsField(tier.domestic);
  const europe = parsePoundsField(tier.europe);
  const restOfWorld = parsePoundsField(tier.restOfWorld);
  if (price === null || domestic === null || europe === null || restOfWorld === null) {
    return "Enter an amount in pounds, for example 2400.00.";
  }
  const quantity = tier.quantity.trim() === "" ? null : Number.parseInt(tier.quantity, 10);
  if (quantity !== null && !Number.isInteger(quantity)) {
    return "Enter a whole number of copies.";
  }
  return {
    title: tier.title,
    description: tier.description,
    price,
    quantity,
    shipping: { domestic, europe, rest_of_world: restOfWorld }
  };
}
async function saveTier(index) {
  if (campaign === null) return;
  const parsed = tierFromEditor(index);
  if (typeof parsed === "string") {
    announce(parsed);
    return;
  }
  const existingId = tiers[index].id;
  const endpoint = existingId !== void 0 ? `/api/tiers/${existingId}` : `/api/campaigns/${campaign.id}/tiers`;
  const { status, body } = await apiFetch(endpoint, {
    method: existingId !== void 0 ? "PATCH" : "POST",
    body: JSON.stringify(parsed)
  });
  if (status === 201 || status === 200) {
    const tier = body;
    tiers[index] = {
      ...tiers[index],
      id: tier.id,
      title: tier.title,
      description: tier.description,
      price: (tier.price / 100).toFixed(2),
      quantity: tier.quantity === null ? "" : String(tier.quantity),
      domestic: (tier.shipping.domestic / 100).toFixed(2),
      europe: (tier.shipping.europe / 100).toFixed(2),
      restOfWorld: (tier.shipping.rest_of_world / 100).toFixed(2)
    };
    announce("Tier saved.");
    renderTiers();
    return;
  }
  const fields = body.fields;
  announce(fields !== void 0 ? "Check the highlighted fields." : "Check the highlighted fields.");
  showCheckFields(Object.keys(fields ?? {}));
}
async function removeTier(index) {
  const existingId = tiers[index].id;
  if (existingId !== void 0) {
    await apiFetch(`/api/tiers/${existingId}`, { method: "DELETE" });
  }
  tiers.splice(index, 1);
  renderTiers();
}
function showCheckFields(fieldNames) {
  const region = document.getElementById("check-fields");
  if (region === null) return;
  if (fieldNames.length === 0) {
    region.hidden = true;
    return;
  }
  const labels = {
    title: "Title",
    story: "Story",
    goal: "Goal (\xA3)",
    min_run_copies: "Minimum run (copies)",
    stretch: "Break points",
    ships_from: "Ships from",
    time_zone: "Time zone",
    deadline_local: "Deadline",
    cover: "Cover art",
    tiers: "Tiers"
  };
  region.hidden = false;
  region.innerHTML = `
    <p><strong>Check these fields</strong></p>
    <ul>
      ${fieldNames.map((name) => `<li><a class="plain" href="#f-${name}">${labels[name] ?? name}</a></li>`).join("")}
    </ul>`;
}
function renderImages() {
  if (campaign === null) return;
  const list = document.getElementById("images");
  if (list === null) return;
  list.innerHTML = campaign.media.map(
    (media) => `
      <li>
        <span>${media.kind === "cover" ? "Cover" : "Spread"} \u2014
          ${media.status === "stored" ? "Stored" : media.status === "uploading" ? "Uploading" : "Not stored"}</span>
        <button type="button" class="secondary" data-remove-media="${media.id}" style="min-height:36px;padding:4px 14px">Remove image</button>
      </li>`
  ).join("");
  list.querySelectorAll("[data-remove-media]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-remove-media");
      if (id === null) return;
      await apiFetch(`/api/media/${id}`, { method: "DELETE" });
      await load();
    });
  });
  const preview = document.getElementById("preview-cover");
  const cover = campaign.media.find((m) => m.kind === "cover" && m.status === "stored");
  if (preview !== null) {
    if (cover !== void 0) {
      preview.src = `/api/media/${cover.id}`;
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
  }
}
async function uploadImages(event, kind) {
  if (campaign === null) return;
  const input = event.target;
  const files = Array.from(input.files ?? []);
  for (const file of files) {
    announce(`Uploading ${file.name}.`);
    const bytes = await file.arrayBuffer();
    const { status, body } = await apiFetch(
      `/api/campaigns/${campaign.id}/media?kind=${kind}`,
      {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-Filename": file.name
        },
        body: bytes
      }
    );
    if (status === 201) {
      announce(kind === "cover" ? "Cover stored." : "Image stored.");
    } else if (body.error === "storage_unavailable") {
      announce("Media storage is unavailable. The image was not stored.");
    } else {
      announce("Check the highlighted fields.");
    }
  }
  input.value = "";
  await load();
}
function readForm() {
  const errors = {};
  const values = {};
  const title = valueOf("f-title");
  if (title.length < 1 || title.length > 120) errors.title = "Enter a title.";
  values.title = title;
  const story = valueOf("f-story");
  if (story.length > 2e4) errors.story = "Keep the story under 20,000 characters.";
  values.story = story;
  const goalPence = parsePoundsField(valueOf("f-goal"));
  if (goalPence === null) errors.goal = "Enter an amount in pounds, for example 2400.00.";
  else if (goalPence < 1e4 || goalPence > 1e7) errors.goal = "Enter a goal between \xA3100 and \xA3100,000.";
  else values.goal = goalPence;
  const minRun = Number.parseInt(valueOf("f-min-run"), 10);
  if (!Number.isInteger(minRun) || minRun < 10 || minRun > 1e5) {
    errors.min_run_copies = "Enter a minimum run between 10 and 100,000 copies.";
  } else {
    values.min_run_copies = minRun;
  }
  values.ships_from = valueOf("f-ships");
  values.time_zone = valueOf("f-zone");
  const deadline = valueOf("f-deadline").trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(deadline)) {
    errors.deadline_local = "Enter the deadline as YYYY-MM-DD HH:MM.";
  } else {
    values.deadline_local = deadline.replace(" ", "T");
  }
  const stretch = [];
  let validStretch = true;
  for (const entry of breaks) {
    const copies = Number.parseInt(entry.copies, 10);
    const amount = parsePoundsField(entry.amount);
    if (!Number.isInteger(copies) || amount === null) {
      validStretch = false;
      break;
    }
    stretch.push({ copies, amount });
  }
  if (!validStretch) {
    errors.stretch = "Each break point needs copies and an amount in pounds.";
  } else {
    values.stretch = stretch;
  }
  return { values, errors };
}
async function saveDraft() {
  if (campaign === null) return;
  announce("Saving draft.");
  const { values, errors } = readForm();
  if (Object.keys(errors).length > 0) {
    announce("Check the highlighted fields.");
    showCheckFields(Object.keys(errors));
    return;
  }
  const { status, body } = await apiFetch(`/api/campaigns/${campaign.id}`, {
    method: "PATCH",
    body: JSON.stringify(values)
  });
  if (status === 200) {
    campaign = body;
    announce("Draft saved.");
    await load();
    return;
  }
  const fields = body.fields ?? {};
  announce("Check the highlighted fields.");
  showCheckFields(Object.keys(fields));
}
async function launch() {
  if (campaign === null) return;
  await saveDraft();
  const { status, body } = await apiFetch(`/api/campaigns/${campaign.id}/launch`, {
    method: "POST"
  });
  if (status === 200) {
    announce("Campaign launched.");
    window.location.href = `/campaigns/${campaign.id}`;
    return;
  }
  const shape = body;
  if (shape.error === "media_not_stored") {
    announce("Launch needs every image stored. Re-upload or remove the images marked Not stored.");
    return;
  }
  if (shape.fields !== void 0) {
    announce("Check the highlighted fields.");
    showCheckFields(Object.keys(shape.fields));
    return;
  }
  announce("Check the highlighted fields.");
}
async function load() {
  if (campaignId === "") return;
  const { status, body } = await apiFetch(`/api/campaigns/${campaignId}`);
  if (status !== 200) {
    window.location.href = "/404";
    return;
  }
  campaign = body;
  document.title = `${campaign.title} \u2014 Studio`;
  const heading = document.getElementById("editor-title");
  if (heading !== null) heading.textContent = campaign.title;
  breaks = campaign.stretch.map((s) => ({
    copies: String(s.copies),
    amount: (s.amount / 100).toFixed(2)
  }));
  tiers = campaign.tiers.map((tier) => ({
    id: tier.id,
    title: tier.title,
    description: tier.description,
    price: (tier.price / 100).toFixed(2),
    quantity: tier.quantity === null ? "" : String(tier.quantity),
    domestic: (tier.shipping.domestic / 100).toFixed(2),
    europe: (tier.shipping.europe / 100).toFixed(2),
    restOfWorld: (tier.shipping.rest_of_world / 100).toFixed(2)
  }));
  renderForm();
  if (plateFill === null) {
    plateFill = mountPlateFill(
      document.getElementById("preview-plate"),
      reducedMotion
    );
  }
  plateFill.render(
    { total: 0, goal: campaign.goal, stretch: [] },
    "0"
  );
  const live = document.getElementById("live-section");
  if (live !== null) live.hidden = campaign.status === "draft";
  if (campaign.status !== "draft") {
    await loadBackers();
    await loadSettlement();
    const cancelButton = document.getElementById("cancel-campaign");
    if (cancelButton !== null) {
      cancelButton.hidden = campaign.status !== "live";
    }
  }
}
async function loadBackers() {
  if (campaign === null) return;
  const { status, body } = await apiFetch(`/api/campaigns/${campaign.id}/pledges`);
  const table = document.getElementById("backers-table");
  if (table === null || status !== 200 || !Array.isArray(body)) return;
  const pledges = body;
  const rows = pledges.map(
    (pledge) => `
      <tr>
        <td data-label="Backer">${escapeHtml(pledge.backer.name)}</td>
        <td data-label="Email">${escapeHtml(pledge.backer.email)}</td>
        <td data-label="Tier">${escapeHtml(pledge.tier_title)}</td>
        <td data-label="Amount">${formatPence(pledge.amount)}</td>
        <td data-label="State"><span class="mark"><span class="glyph ${pledge.state}" aria-hidden="true"></span> ${STATE_WORDS[pledge.state] ?? pledge.state}</span></td>
      </tr>`
  );
  table.querySelector("tbody").innerHTML = rows.join("");
  const empty = document.getElementById("backers-empty");
  if (empty !== null) empty.hidden = pledges.length > 0;
}
async function loadSettlement() {
  if (campaign === null) return;
  const { status, body } = await apiFetch(`/api/campaigns/${campaign.id}/settlement`);
  const panel = document.getElementById("settlement-panel");
  if (panel === null) return;
  if (status !== 200) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const settlement = body;
  const summary = document.getElementById("settlement-summary");
  if (summary !== null) {
    summary.innerHTML = `
      <p style="margin:4px 0">Gross <span class="numeral">${formatPence(settlement.gross)}</span></p>
      <p style="margin:4px 0">Platform fees <span class="numeral">${formatPence(settlement.platform_fee)}</span></p>
      <p style="margin:4px 0">Processing fees <span class="numeral">${formatPence(settlement.processing_fee)}</span></p>
      <p style="margin:4px 0">Net to creator <span class="numeral">${formatPence(settlement.net)}</span></p>`;
  }
  const link = document.getElementById("settlement-link");
  if (link !== null) {
    link.hidden = settlement.pdf !== "ready";
    if (settlement.pdf === "ready") {
      link.setAttribute("href", `/api/campaigns/${campaign.id}/settlement.pdf`);
    }
  }
}
function openCancelDialog() {
  const dialog = document.getElementById("cancel-dialog");
  if (dialog === null || campaign === null) return;
  dialog.innerHTML = `
    <form method="dialog" aria-label="Cancel campaign">
      <h2>Cancel campaign</h2>
      <p>Release every held card and close the campaign?</p>
      <div class="actions">
        <button type="button" id="cancel-confirm">Yes, release every card</button>
        <button type="button" class="secondary" id="cancel-back">Keep campaign</button>
      </div>
    </form>`;
  dialog.showModal();
  dialog.querySelector("#cancel-confirm")?.focus();
  const close = () => dialog.close();
  dialog.querySelector("#cancel-back")?.addEventListener("click", close);
  dialog.querySelector("#cancel-confirm")?.addEventListener("click", async () => {
    if (campaign === null) return;
    const { status } = await apiFetch(`/api/campaigns/${campaign.id}/cancel`, { method: "POST" });
    if (status === 200) {
      announce("Campaign cancelled. Every held card was released.");
      close();
      await load();
    }
  });
}
document.getElementById("cancel-campaign")?.addEventListener("click", openCancelDialog);
if (newPathMatch && campaignId === "") {
  void (async () => {
    if (loadKey() === null) {
      window.location.href = "/studio";
      return;
    }
    const { status, body } = await apiFetch("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        title: "Untitled campaign",
        story: "",
        goal: 1e4,
        min_run_copies: 10,
        stretch: [],
        ships_from: "GB",
        time_zone: "Europe/London",
        deadline_local: defaultDeadline()
      })
    });
    if (status === 201) {
      const created = body;
      window.history.replaceState(null, "", `/studio/campaigns/${created.id}`);
      window.location.href = `/studio/campaigns/${created.id}`;
    }
  })();
}
function defaultDeadline() {
  const date = new Date(Date.now() + 30 * 86400 * 1e3);
  const pad = (value) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T20:00`;
}
if (campaignId !== "") {
  const form = document.getElementById("editor-form");
  if (form !== null) form.innerHTML = loadingMarkup();
  void load();
}
