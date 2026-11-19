import {
  mountPlateFill,
  reducedMotionRequested
} from "./chunk-V5KNXBSB.js";
import {
  STATE_WORDS,
  ZONE_NAMES,
  apiFetch,
  countriesSorted,
  formatCountdown,
  formatPence,
  loadKey,
  loadingMarkup,
  mountHeader,
  startBannerRefresh
} from "./chunk-JDNZ7ISK.js";

// src/frontend/campaign.ts
var campaignPath = window.location.pathname.match(/^\/campaigns\/([^/]+)$/);
var campaignId = campaignPath !== null ? campaignPath[1] : "";
var reducedMotion = reducedMotionRequested();
var plateFill = mountPlateFill(
  document.getElementById("plate-fill-container"),
  reducedMotion
);
var campaign = null;
var ownPledge = null;
var selectedTier = null;
var selectedCountry = "";
var addOnPence = 0;
var currentQuote = null;
var quoteTimer = null;
var confirmCounter = 0;
var countdownAnchor = null;
var editing = false;
mountHeader("campaigns");
startBannerRefresh();
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function announce(text) {
  const region = document.getElementById("pledge-result");
  if (region !== null) region.textContent = text;
}
function renderCampaignHeader() {
  if (campaign === null) return;
  document.title = `${campaign.title} \u2014 Dotgain`;
  const title = document.getElementById("title");
  if (title !== null) title.textContent = campaign.title;
  const creator = document.getElementById("creator");
  if (creator !== null) creator.textContent = `by ${campaign.creator.name}`;
  const story = document.getElementById("story");
  if (story !== null) {
    story.innerHTML = campaign.story.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  }
  const cover = document.getElementById("cover");
  const coverMedia = campaign.media.find((m) => m.kind === "cover" && m.status === "stored");
  if (cover !== null) {
    if (coverMedia !== void 0) {
      cover.src = `/api/media/${coverMedia.id}`;
      cover.hidden = false;
    } else {
      cover.hidden = true;
    }
  }
  const goal = document.getElementById("goal");
  if (goal !== null) goal.textContent = formatPence(campaign.goal);
  const minRun = document.getElementById("min-run");
  if (minRun !== null) minRun.textContent = campaign.min_run_copies.toLocaleString("en-GB");
  renderTotal(campaign.total);
  plateFill.render(
    { total: campaign.total, goal: campaign.goal, stretch: campaign.stretch },
    String(campaign.percent)
  );
  if (campaign.seconds_left !== null) {
    countdownAnchor = Date.now() + campaign.seconds_left * 1e3;
    tickCountdown();
  }
}
function renderTotal(total) {
  const totalElement = document.getElementById("total");
  if (totalElement !== null) {
    if (reducedMotion) {
      totalElement.textContent = formatPence(total);
    } else {
      countUp(totalElement, total);
    }
  }
}
function countUp(element, target) {
  const start = Number(element.dataset.pence ?? "0");
  if (start === target) {
    element.textContent = formatPence(target);
    return;
  }
  element.dataset.pence = String(target);
  const startedAt = performance.now();
  const duration = 500;
  const step = (now) => {
    const t = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - (1 - t) * (1 - t);
    const value = Math.round(start + (target - start) * eased);
    element.textContent = formatPence(value);
    if (t < 1) {
      window.requestAnimationFrame(step);
    } else {
      element.textContent = formatPence(target);
    }
  };
  window.requestAnimationFrame(step);
}
function tickCountdown() {
  if (campaign === null) return;
  const countdown = document.getElementById("countdown");
  if (countdownAnchor === null) return;
  const secondsLeft = Math.max(0, Math.floor((countdownAnchor - Date.now()) / 1e3));
  if (countdown !== null) countdown.textContent = formatCountdown(secondsLeft);
  window.setTimeout(() => {
    void tick();
  }, 1e3);
}
async function tick() {
  if (countdownAnchor !== null && countdownAnchor <= Date.now()) {
    await refresh();
    return;
  }
  tickCountdown();
}
function renderTiers() {
  if (campaign === null) return;
  const container = document.getElementById("tiers");
  if (container === null) return;
  const items = campaign.tiers.map((tier) => {
    const soldOut = tier.quantity !== null && tier.remaining === 0;
    const availability = tier.quantity === null ? "Open edition" : soldOut ? "Gone" : `${tier.remaining} of ${tier.quantity} left`;
    const radio = `
      <input type="radio" name="tier" id="tier-${tier.id}" value="${tier.id}"
        ${soldOut ? "disabled" : ""} data-tier="${tier.id}">
      <span>${escapeHtml(tier.title)} \u2014 <span class="numeral">${formatPence(tier.price)}</span></span>`;
    return `
      <div class="tier-item" id="tier-item-${tier.id}">
        <div class="tier-row">
          ${radio}
          <span class="chip">${availability}</span>
          <button type="button" class="secondary" data-expand="${tier.id}"
            aria-expanded="false" aria-controls="tier-body-${tier.id}"
            style="min-height:36px;padding:4px 14px">Open ${escapeHtml(tier.title)}</button>
        </div>
        <div class="tier-body" id="tier-body-${tier.id}" role="group" aria-label="${escapeHtml(tier.title)}">
          <p>${escapeHtml(tier.description)}</p>
          <table class="responsive">
            <thead><tr><th>Zone</th><th>Shipping</th></tr></thead>
            <tbody>
              <tr><td data-label="Zone">Domestic</td><td data-label="Shipping">${formatPence(tier.shipping.domestic)}</td></tr>
              <tr><td data-label="Zone">Europe</td><td data-label="Shipping">${formatPence(tier.shipping.europe)}</td></tr>
              <tr><td data-label="Zone">Rest of world</td><td data-label="Shipping">${formatPence(tier.shipping.rest_of_world)}</td></tr>
            </tbody>
          </table>
          <img class="full-cover" src="/api/media/${coverMediaId()}" alt="The full cover" loading="lazy">
        </div>
      </div>`;
  });
  container.innerHTML = `<h3 class="visually-hidden">Reward tier</h3>${items.join("")}`;
  container.querySelectorAll("[data-expand]").forEach((button) => {
    button.addEventListener("click", () => {
      const tierId = button.getAttribute("data-expand");
      const item = document.getElementById(`tier-item-${tierId ?? ""}`);
      if (item === null) return;
      const open = item.classList.toggle("open");
      button.setAttribute("aria-expanded", String(open));
    });
  });
  container.querySelectorAll("input[name='tier']").forEach((input) => {
    input.addEventListener("change", () => {
      selectedTier = input.value;
      queueQuote();
    });
  });
  const firstRadio = container.querySelector("input[name='tier']:not(:disabled)");
  if (firstRadio !== null) firstRadio.tabIndex = 0;
  container.querySelectorAll("input[name='tier']").forEach((input) => {
    input.tabIndex = input.checked ? 0 : -1;
  });
}
function coverMediaId() {
  const media = campaign?.media.find((m) => m.kind === "cover" && m.status === "stored");
  return media?.id ?? "";
}
function closedHeading() {
  if (campaign === null) return null;
  switch (campaign.status) {
    case "funded":
    case "collecting":
    case "settled":
      return "Funded. This run goes to press.";
    case "unfunded":
      return "Not funded. No card was charged.";
    case "cancelled":
      return "Cancelled by the creator. No card was charged.";
    default:
      return null;
  }
}
function renderStage() {
  if (campaign === null) return;
  const body = document.getElementById("stage-body");
  if (body === null) return;
  const heading = closedHeading();
  if (heading !== null) {
    body.innerHTML = `<h2>${escapeHtml(heading)}</h2>`;
    renderPledgeSummary();
    return;
  }
  if (ownPledge !== null && ownPledge.state === "authorised" && !editing) {
    renderHeldPledge();
    return;
  }
  renderPledgeForm();
}
function renderHeldPledge() {
  if (ownPledge === null || campaign === null) return;
  const body = document.getElementById("stage-body");
  if (body === null) return;
  const tier = campaign.tiers.find((t) => t.id === ownPledge?.tier_id);
  body.innerHTML = `
    <div class="pledge-stage">
      <p class="mark"><span class="glyph authorised" aria-hidden="true"></span> ${STATE_WORDS.authorised}</p>
      <p style="margin:10px 0 0">Your pledge of <span class="numeral">${formatPence(ownPledge.amount)}</span>
        on ${escapeHtml(tier?.title ?? "")} is held on your card.</p>
      <div class="pledge-actions">
        <button type="button" id="change-pledge">Change pledge</button>
        <button type="button" class="secondary" id="cancel-pledge">Cancel pledge</button>
      </div>
    </div>`;
  document.getElementById("change-pledge")?.addEventListener("click", () => {
    editing = true;
    selectedTier = ownPledge?.tier_id ?? null;
    selectedCountry = ownPledge?.country ?? "";
    const addOnField = document.getElementById("add-on");
    addOnPence = ownPledge?.add_on ?? 0;
    renderStage();
    const changeButton = document.getElementById("change-pledge");
    if (changeButton !== null) changeButton.focus();
  });
  document.getElementById("cancel-pledge")?.addEventListener("click", () => {
    openCancelDialog();
  });
}
function renderPledgeForm() {
  if (campaign === null) return;
  const body = document.getElementById("stage-body");
  if (body === null) return;
  const options = countriesSorted().map(
    (country2) => `<option value="${country2.code}"${country2.code === selectedCountry ? " selected" : ""}>${country2.name}</option>`
  ).join("");
  const addOnValue = (addOnPence / 100).toFixed(2);
  body.innerHTML = `
    <div class="pledge-stage" aria-label="Pledge">
      <fieldset style="border:none;padding:0;margin:0">
        <legend class="visually-hidden">Reward tier</legend>
        ${campaign.tiers.map(
    (tier) => `
          <label style="display:flex;align-items:center;gap:10px;margin:8px 0">
            <input type="radio" name="stage-tier" value="${tier.id}"
              ${tier.quantity !== null && tier.remaining === 0 ? "disabled" : ""}
              ${selectedTier === tier.id ? "checked" : ""}>
            ${escapeHtml(tier.title)} \u2014 <span class="numeral">${formatPence(tier.price)}</span>
            ${tier.quantity !== null && tier.remaining === 0 ? "<em>Gone</em>" : ""}
          </label>`
  ).join("")}
      </fieldset>
      <label for="country">Shipping country</label>
      <select id="country">${options}</select>
      <label for="add-on">Add-on (\xA3)</label>
      <input class="numeral" id="add-on" type="text" inputmode="decimal" value="${addOnValue}">
      <p id="add-on-error" class="field-error" hidden></p>
      <div class="pledge-preview" id="pledge-preview" role="status" aria-live="polite"></div>
      <div class="pledge-actions">
        <button type="button" id="review-pledge" ${selectedTier === null ? "disabled" : ""}>Review pledge</button>
      </div>
    </div>`;
  body.querySelectorAll("input[name='stage-tier']").forEach((input) => {
    input.addEventListener("change", () => {
      selectedTier = input.value;
      document.getElementById("review-pledge").disabled = selectedTier === null;
      queueQuote();
    });
  });
  const country = document.getElementById("country");
  country?.addEventListener("change", () => {
    selectedCountry = country.value;
    queueQuote();
  });
  const addOn = document.getElementById("add-on");
  addOn?.addEventListener("input", () => {
    queueQuote();
  });
  document.getElementById("review-pledge")?.addEventListener("click", () => {
    openConfirmDialog(editing && ownPledge !== null ? "change" : "pledge");
  });
  queueQuote();
}
function queueQuote() {
  if (quoteTimer !== null) window.clearTimeout(quoteTimer);
  quoteTimer = window.setTimeout(() => {
    void requestQuote();
  }, 150);
}
async function requestQuote() {
  if (campaign === null || selectedTier === null) return;
  const addOnText = document.getElementById("add-on")?.value ?? "0";
  const addOn = Math.round((Number.parseFloat(addOnText) || 0) * 100);
  const { status, body } = await apiFetch(`/api/campaigns/${campaign.id}/quote`, {
    method: "POST",
    body: JSON.stringify({
      tier_id: selectedTier,
      country: selectedCountry || campaign.ships_from,
      add_on: addOn
    })
  });
  if (status === 422 && body.fields !== void 0) {
    const fields = body.fields;
    const error2 = document.getElementById("add-on-error");
    if (error2 !== null && fields.add_on !== void 0) {
      error2.textContent = fields.add_on;
      error2.hidden = false;
    }
    return;
  }
  if (status !== 200) return;
  const error = document.getElementById("add-on-error");
  if (error !== null) error.hidden = true;
  currentQuote = body;
  addOnPence = currentQuote.add_on;
  renderPreview();
}
function renderPreview() {
  const preview = document.getElementById("pledge-preview");
  if (preview === null || currentQuote === null) return;
  preview.innerHTML = `
    <p>Reward: ${formatPence(currentQuote.reward)}</p>
    <p>Shipping (${ZONE_NAMES[currentQuote.zone] ?? currentQuote.zone}): ${formatPence(currentQuote.shipping)}</p>
    <p>Add-on: ${formatPence(currentQuote.add_on)}</p>
    <p>Pledge total: ${formatPence(currentQuote.amount)}</p>
    <p>Your pledge would bring this to ${currentQuote.projected_percent}%</p>`;
  if (campaign !== null) {
    plateFill.renderProof({
      total: currentQuote.projected_total,
      goal: campaign.goal,
      stretch: campaign.stretch
    });
  }
}
function renderPledgeSummary() {
  if (ownPledge === null) return;
  const stage = document.getElementById("stage-body");
  if (stage === null) return;
  const existing = stage.querySelector(".pledge-summary");
  if (existing !== null) return;
  const summary = document.createElement("p");
  summary.className = "pledge-summary mark";
  summary.innerHTML = `<span class="glyph ${ownPledge.state}" aria-hidden="true"></span> ${STATE_WORDS[ownPledge.state] ?? ""}`;
  stage.appendChild(summary);
}
function focusTrap(dialog) {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialog.querySelectorAll(
        "button, input, select, textarea, [href]"
      )
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
}
function openConfirmDialog(kind) {
  if (campaign === null || currentQuote === null) return;
  const dialog = document.getElementById("confirm-dialog");
  if (dialog === null) return;
  const hasKey = loadKey() !== null;
  const opener = document.activeElement;
  const fields = [];
  if (!hasKey && kind === "pledge") {
    fields.push({ id: "name", label: "Name" });
    fields.push({ id: "email", label: "Email", type: "email" });
  }
  if (kind === "pledge") {
    fields.push({ id: "card", label: "Card number", value: "" });
  }
  dialog.innerHTML = `
    <form method="dialog" aria-label="${kind === "pledge" ? "Confirm pledge" : "Confirm change"}">
      <h2>${kind === "pledge" ? "Confirm pledge" : "Confirm change"}</h2>
      <div class="summary">
        <p style="margin:4px 0">Tier: ${escapeHtml(tierTitle(currentQuote.tier_id))}</p>
        <p style="margin:4px 0">Shipping (${ZONE_NAMES[currentQuote.zone]}): ${formatPence(currentQuote.shipping)}</p>
        <p style="margin:4px 0">Add-on: ${formatPence(currentQuote.add_on)}</p>
        <p style="margin:4px 0">Total: <span class="numeral">${formatPence(currentQuote.amount)}</span></p>
      </div>
      ${fields.map(
    (field) => `
        <label for="dialog-${field.id}">${field.label}</label>
        <input id="dialog-${field.id}" ${field.type !== void 0 ? `type="${field.type}"` : ""} value="${field.value ?? ""}" autocomplete="off">`
  ).join("")}
      <p class="field-error" id="dialog-error" hidden></p>
      <div class="actions">
        <button type="button" id="dialog-confirm">${kind === "pledge" ? "Confirm pledge" : "Confirm change"}</button>
        <button type="button" class="secondary" id="dialog-back">Back</button>
      </div>
    </form>`;
  dialog.showModal();
  focusTrap(dialog);
  const firstField = dialog.querySelector("input");
  const firstButton = dialog.querySelector("button");
  (firstField ?? firstButton)?.focus();
  const close = () => {
    dialog.close();
    if (opener !== null && document.contains(opener)) {
      opener.focus();
    } else {
      document.getElementById("review-pledge")?.focus();
    }
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.querySelector("#dialog-back")?.addEventListener("click", close);
  const confirm = dialog.querySelector("#dialog-confirm");
  confirm?.addEventListener("click", () => {
    void submitPledge(kind, dialog, close);
  });
  const cardField = dialog.querySelector("#dialog-card");
  cardField?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirm?.click();
    }
  });
}
function tierTitle(tierId) {
  return campaign?.tiers.find((tier) => tier.id === tierId)?.title ?? "";
}
async function submitPledge(kind, dialog, close) {
  if (campaign === null || currentQuote === null || selectedTier === null) return;
  const confirm = dialog.querySelector("#dialog-confirm");
  if (confirm !== null) confirm.disabled = true;
  const error = dialog.querySelector("#dialog-error");
  const cardField = dialog.querySelector("#dialog-card");
  const nameField = dialog.querySelector("#dialog-name");
  const emailField = dialog.querySelector("#dialog-email");
  confirmCounter += 1;
  announce(`Asking the payment service to hold ${formatPence(currentQuote.amount)}.`);
  const payload = {
    tier_id: selectedTier,
    country: selectedCountry || campaign.ships_from,
    add_on: currentQuote.add_on
  };
  if (kind === "pledge") {
    const cardNumber = cardField?.value ?? "";
    payload.card_number = cardNumber;
    if (nameField !== null) payload.name = nameField.value;
    if (emailField !== null) payload.email = emailField.value;
  }
  const idempotencyKey = `pledge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${confirmCounter}`;
  const { status, body } = await apiFetch(
    kind === "pledge" ? `/api/campaigns/${campaign.id}/pledges` : `/api/pledges/${ownPledge?.id ?? ""}`,
    {
      method: kind === "pledge" ? "POST" : "PATCH",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload)
    }
  );
  if (status === 201) {
    const result = body;
    if (typeof result.key === "string") {
      window.localStorage.setItem("dotgain_key", result.key);
    }
    ownPledge = result;
    editing = false;
    close();
    plateFill.clearProof();
    await plateFill.inkTo(
      {
        total: result.campaign_total,
        goal: campaign.goal,
        stretch: campaign.stretch
      },
      String(campaign.percent)
    );
    renderTotal(result.campaign_total);
    announce(
      kind === "pledge" ? `Pledge authorised: ${formatPence(currentQuote.amount)} held on your card. You are charged only if the run is funded.` : `Pledge changed: ${formatPence(currentQuote.amount)} held on your card. The earlier hold was released.`
    );
    renderStage();
    document.getElementById("change-pledge")?.focus();
    return;
  }
  const shape = body;
  if (confirm !== null) confirm.disabled = false;
  if (shape.fields !== void 0) {
    const firstFieldId = Object.keys(shape.fields)[0];
    if (error !== null) {
      error.textContent = Object.values(shape.fields)[0] ?? "";
      error.hidden = false;
    }
    const target = dialog.querySelector(`#dialog-${firstFieldId}`);
    (target ?? cardField)?.focus();
    return;
  }
  if (shape.error === "card_declined") {
    announce("Card declined. No hold was placed. Try another card.");
    (cardField ?? confirm)?.focus();
    return;
  }
  close();
  switch (shape.error) {
    case "tier_sold_out":
      plateFill.clearProof();
      announce("That tier just sold out. No hold was placed.");
      await refresh();
      break;
    case "payment_unavailable":
      plateFill.clearProof();
      announce("Payment service unavailable. No hold was placed. Try again in a few minutes.");
      break;
    case "campaign_closed":
      plateFill.clearProof();
      announce("Pledging has closed for this campaign.");
      await refresh();
      break;
    case "would_unfund":
      announce(
        "This change would take a funded run below its minimum in the final 24 hours, so it cannot be made."
      );
      break;
    default:
      announce("Something went wrong. Try again.");
  }
  document.getElementById("review-pledge")?.focus();
}
function openCancelDialog() {
  if (campaign === null || ownPledge === null) return;
  const dialog = document.getElementById("confirm-dialog");
  if (dialog === null) return;
  const opener = document.activeElement;
  dialog.innerHTML = `
    <form method="dialog" aria-label="Cancel pledge">
      <h2>Cancel pledge</h2>
      <p>Release the hold of <span class="numeral">${formatPence(ownPledge.amount)}</span> on your card?</p>
      <div class="actions">
        <button type="button" id="dialog-confirm">Yes, release my card</button>
        <button type="button" class="secondary" id="dialog-back">Keep pledge</button>
      </div>
    </form>`;
  dialog.showModal();
  focusTrap(dialog);
  dialog.querySelector("#dialog-confirm")?.focus();
  const close = () => {
    dialog.close();
    if (opener !== null && document.contains(opener)) opener.focus();
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.querySelector("#dialog-back")?.addEventListener("click", close);
  dialog.querySelector("#dialog-confirm")?.addEventListener("click", () => {
    void submitCancel(close);
  });
}
async function submitCancel(close) {
  if (campaign === null || ownPledge === null) return;
  const { status, body } = await apiFetch(`/api/pledges/${ownPledge.id}/cancel`, {
    method: "POST"
  });
  if (status === 200) {
    ownPledge = null;
    close();
    announce("Pledge cancelled. The hold on your card was released.");
    await refresh();
    return;
  }
  const shape = body;
  close();
  if (shape.error === "payment_unavailable") {
    announce("Payment service unavailable. Your pledge is unchanged.");
  } else if (shape.error === "would_unfund") {
    announce(
      "This change would take a funded run below its minimum in the final 24 hours, so it cannot be made."
    );
  } else if (shape.error === "campaign_closed") {
    announce("Pledging has closed for this campaign.");
  } else {
    announce("Something went wrong. Try again.");
  }
}
async function refresh() {
  const { body } = await apiFetch(`/api/campaigns/${campaignId}`);
  if (body.id !== void 0) {
    campaign = body;
    renderCampaignHeader();
    renderTiers();
  }
  const pledgesResult = await apiFetch("/api/me/pledges");
  if (Array.isArray(pledgesResult.body)) {
    ownPledge = pledgesResult.body.find(
      (pledge) => pledge.campaign_id === campaignId && pledge.state === "authorised"
    ) ?? null;
  }
  renderStage();
  if (campaign !== null && campaign.seconds_left !== null) {
    countdownAnchor = Date.now() + campaign.seconds_left * 1e3;
  }
}
if (campaignId !== "") {
  const stageBody = document.getElementById("stage-body");
  if (stageBody !== null) stageBody.innerHTML = loadingMarkup();
  void (async () => {
    const { body } = await apiFetch(`/api/campaigns/${campaignId}`);
    if (body.id === void 0) {
      window.location.href = "/404";
      return;
    }
    await refresh();
    window.setInterval(() => {
      void refresh();
    }, 3e4);
  })();
}
