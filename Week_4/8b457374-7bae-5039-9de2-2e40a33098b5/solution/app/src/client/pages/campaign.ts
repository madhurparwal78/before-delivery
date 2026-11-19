import type { Campaign, MyPledge, OwnPledge, PledgeResult, Quote, Tier } from "../../shared/api.js";
import { ZONE_NAMES } from "../../shared/api.js";
import { COUNTRIES, countryOf } from "../../shared/countries.js";
import { decimalPounds, parsePounds } from "../../shared/money.js";
import { api, heldKey, holdKey, newIdempotencyKey, type Result } from "../api.js";
import { openDialog, type OpenDialog } from "../dialog.js";
import { announce, h, reducedMotion, uid } from "../dom.js";
import { loading, stateMark } from "../marks.js";
import { countdown, cover, field, money, moneyInput, title, type Page } from "../page.js";
import { countUp, PlateFill } from "../platefill.js";
import { notFoundPage } from "./notfound.js";

// The campaign page (brief: Screens and layout › Campaign page; DP-11 to DP-34, DP-52, DP-53).

const COPY = {
  authorised: (a: number) => `Pledge authorised: ${money(a)} held on your card. You are charged only if the run is funded.`,
  changed: (a: number) => `Pledge changed: ${money(a)} held on your card. The earlier hold was released.`,
  pending: (a: number) => `Asking the payment service to hold ${money(a)}.`,
  cancelled: "Pledge cancelled. The hold on your card was released.",
  declined: "Card declined. No hold was placed. Try another card.",
  soldOut: "That tier just sold out. No hold was placed.",
  wouldUnfund: "This change would take a funded run below its minimum in the final 24 hours, so it cannot be made.",
  closed: "Pledging has closed for this campaign.",
  paymentDown: "Payment service unavailable. No hold was placed. Try again in a few minutes.",
  paymentDownKept: "Payment service unavailable. Your pledge is unchanged.",
  addOn: "Enter an add-on from 0.00 to 500.00.",
};

const HEADINGS: Partial<Record<Campaign["status"], string>> = {
  funded: "Funded. This run goes to press.",
  collecting: "Funded. This run goes to press.",
  settled: "Funded. This run goes to press.",
  unfunded: "Not funded. No card was charged.",
  cancelled: "Cancelled by the creator. No card was charged.",
};

function availability(t: Tier): string {
  if (t.quantity === null) return "Open edition";
  return t.remaining === 0 ? "Gone" : `${t.remaining} of ${t.quantity} left`;
}

function countryName(code: string): string {
  return countryOf(code)?.name ?? code;
}

export const campaignPage: Page = (main, id, onLeave) => {
  main.append(loading());
  const load = () => Promise.all([
    api<Campaign>("GET", `/api/campaigns/${id}`),
    heldKey() ? api<MyPledge[]>("GET", "/api/me/pledges") : Promise.resolve(null),
  ]);
  void load().then(([found, mine]) => {
    if (!found.ok) {
      main.replaceChildren();
      notFoundPage(main, "", onLeave);
      return;
    }
    build(main, found.data, heldOf(found.data.id, mine), load, onLeave);
  });
};

function heldOf(campaignId: string, mine: Result<MyPledge[]> | null): OwnPledge | null {
  return mine?.ok ? (mine.data.find((p) => p.campaign_id === campaignId && p.state === "authorised") ?? null) : null;
}

function build(
  main: HTMLElement, first: Campaign, firstOwn: OwnPledge | null,
  load: () => Promise<[Result<Campaign>, Result<MyPledge[]> | null]>, onLeave: (done: () => void) => void,
): void {
  let campaign = first;
  let own = firstOwn;
  let mode: "form" | "held" | "change" = own ? "held" : "form";
  let shownTotal = campaign.total;
  title(campaign.title);

  const coverMedia = campaign.media.find((m) => m.kind === "cover" && m.status === "stored");
  const coverSrc = coverMedia ? `/api/media/${coverMedia.id}` : null;

  // Plate Fill, totals and countdown
  const gauge = new PlateFill(campaign.goal, campaign.stretch.map((p) => p.amount), campaign.total, campaign.percent, " of the minimum run");
  const totalEl = h("p", { class: "figure figure-total" }, money(campaign.total));
  const percentEl = h("span", { class: "figure-inline" }, `${campaign.percent}%`);
  const backersEl = h("span", {}, "");
  const timerEl = h("p", { class: "figure figure-countdown", role: "timer", "aria-label": "Time left" });
  const stretchList = h("ul", { class: "stretch-list" });
  const setCountdown = countdown(timerEl, onLeave, () => void refresh());
  const result = h("div", { class: "result", role: "status", "aria-live": "polite", "aria-label": "Pledge result" });
  const stageHost = h("div", { class: "stage-host" });
  const tierList = h("ul", { class: "tier-list", "aria-label": "Reward tiers" });

  const aside = h("div", { class: "campaign-aside" },
    h("div", { class: "gauge-wrap" }, gauge.el),
    h("div", { class: "totals" },
      h("p", { class: "label" }, "Pledged so far"),
      totalEl,
      h("p", { class: "goal-line" }, percentEl, ` of the ${campaign.min_run_copies.toLocaleString("en-GB")}-copy minimum run · goal ${money(campaign.goal)}`),
      stretchList,
      h("p", { class: "meta-line" }, backersEl),
      h("p", { class: "label" }, "Time left"),
      timerEl),
    stageHost,
    result);

  const story = h("div", { class: "story" }, ...campaign.story.split(/\n{2,}/).filter(Boolean).map((para) => h("p", {}, para)));
  main.append(h("div", { class: "campaign-grid" },
    h("div", { class: "campaign-lead" },
      cover(coverSrc, `Cover of ${campaign.title}`, "lead"),
      h("h1", { class: "campaign-title" }, campaign.title),
      h("p", { class: "byline" }, `by ${campaign.creator.name}`)),
    aside,
    h("div", { class: "campaign-body" },
      h("h2", { class: "section-title" }, "The story"),
      story,
      h("div", { class: "band", "aria-hidden": "true" }),
      h("h2", { class: "section-title" }, "Reward tiers"),
      tierList)));

  // The pinned column at 1200+: stick with a top that keeps the column's bottom in view.
  const pin = () => aside.style.setProperty("--pin-top", `${Math.min(16, innerHeight - aside.offsetHeight - 16)}px`);
  const observer = new ResizeObserver(pin);
  observer.observe(aside);
  addEventListener("resize", pin);
  onLeave(() => {
    observer.disconnect();
    removeEventListener("resize", pin);
  });

  function paintTotals(): void {
    percentEl.textContent = `${campaign.percent}%`;
    backersEl.textContent = `${campaign.backer_count} ${campaign.backer_count === 1 ? "backer" : "backers"}`;
    stretchList.replaceChildren(...campaign.stretch.map((p) =>
      h("li", { class: p.reached ? "reached" : "" }, h("span", { class: "bullet", "aria-hidden": "true" }),
        `${p.copies.toLocaleString("en-GB")} copies at ${money(p.amount)}${p.reached ? " · reached" : ""}`)));
    setCountdown(campaign.seconds_left ?? 0);
  }

  function paintTiers(): void {
    tierList.replaceChildren(...campaign.tiers.map((t) => {
      const panelId = uid("tier-panel");
      const toggle = h("button", { type: "button", class: "tier-toggle", "aria-expanded": "false", "aria-controls": panelId },
        h("span", { class: "tier-dot", "aria-hidden": "true" }),
        h("span", { class: "sr-only" }, "Open "), h("span", { class: "tier-name" }, t.title));
      const panel = h("div", { class: "tier-panel", id: panelId, hidden: true },
        t.description ? h("p", {}, t.description) : null,
        h("table", { class: "ship-table" },
          h("caption", {}, "Shipping"),
          h("tbody", {}, ...(["domestic", "europe", "rest_of_world"] as const).map((z) =>
            h("tr", {}, h("th", { scope: "row" }, ZONE_NAMES[z]), h("td", {}, money(t.shipping[z])))))),
        coverSrc ? h("img", { class: "cover-full", src: coverSrc, alt: `Full cover of ${campaign.title}`, loading: "lazy" }) : null);
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open));
        panel.hidden = !open;
      });
      return h("li", { class: `tier-item${t.remaining === 0 ? " gone" : ""}` },
        h("div", { class: "tier-head" }, toggle, h("span", { class: "tier-price figure-inline" }, money(t.price)),
          h("span", { class: "tier-left" }, availability(t))),
        panel);
    }));
  }

  // The pledge stage
  let selection = { tier: null as string | null, country: campaign.ships_from, addOn: "0.00" };
  let quote: Quote | null = null;
  let quoteSeq = 0;
  let quoteTimer: number | undefined;
  let radios: HTMLInputElement[] = [];
  let review: HTMLButtonElement | null = null;
  let addOnField: ReturnType<typeof field> | null = null;
  let preview: HTMLElement | null = null;
  let changeButton: HTMLButtonElement | null = null;
  let cancelButton: HTMLButtonElement | null = null;
  let stageHeading: HTMLElement | null = null;

  function clearQuote(): void {
    quote = null;
    gauge.proof(null);
    if (preview) preview.replaceChildren(h("p", { class: "hint" }, "Choose a reward tier to see your pledge total."));
  }

  function addOnPence(): number | null {
    const pence = parsePounds(selection.addOn);
    return pence !== null && pence <= 50_000 ? pence : null;
  }

  async function fetchQuote(): Promise<Quote | null> {
    const seq = ++quoteSeq;
    if (!selection.tier) {
      clearQuote();
      return null;
    }
    const addOn = addOnPence();
    if (addOn === null) {
      addOnField?.set(COPY.addOn);
      clearQuote();
      return null;
    }
    addOnField?.set(null);
    const found = await api<Quote>("POST", `/api/campaigns/${campaign.id}/quote`, { body: { tier_id: selection.tier, country: selection.country, add_on: addOn } });
    if (seq !== quoteSeq) return quote;
    if (!found.ok) {
      clearQuote();
      if (found.error.fields?.add_on) addOnField?.set(COPY.addOn);
      if (found.error.error === "campaign_closed") void refresh();
      return null;
    }
    quote = found.data;
    preview?.replaceChildren(...[
      `Reward: ${money(quote.reward)}`,
      `Shipping (${ZONE_NAMES[quote.zone]}): ${money(quote.shipping)}`,
      `Add-on: ${money(quote.add_on)}`,
      `Pledge total: ${money(quote.amount)}`,
      `Your pledge would bring this to ${quote.projected_percent}%`,
    ].map((line, n) => h("p", { class: n === 3 ? "preview-total" : n === 4 ? "preview-sentence" : "" }, line)));
    gauge.proof(quote.projected_total);
    return quote;
  }

  function scheduleQuote(): void {
    window.clearTimeout(quoteTimer);
    quoteTimer = window.setTimeout(() => void fetchQuote(), 150);
  }
  onLeave(() => window.clearTimeout(quoteTimer));

  function paintRadios(): void {
    for (const radio of radios) {
      const tier = campaign.tiers.find((t) => t.id === radio.value);
      const gone = tier?.remaining === 0 && tier.id !== own?.tier_id;
      radio.disabled = gone;
      const left = radio.closest("label")?.querySelector(".tier-option-left");
      if (left && tier) left.textContent = gone ? "Gone" : availability(tier);
    }
    if (review) review.disabled = !selection.tier;
  }

  function formStage(): HTMLElement {
    const changing = mode === "change" && own;
    selection = changing
      ? { tier: own!.tier_id, country: own!.country, addOn: decimalPounds(own!.add_on) }
      : { tier: null, country: campaign.ships_from, addOn: "0.00" };
    const legendId = uid("tier-legend");
    radios = [];
    const options = campaign.tiers.map((t) => {
      const nameId = uid("tier-name");
      const radio = h("input", { type: "radio", name: "reward-tier", value: t.id, "aria-labelledby": nameId });
      radio.checked = selection.tier === t.id;
      radio.addEventListener("change", () => {
        selection.tier = t.id;
        if (review) review.disabled = false;
        scheduleQuote();
      });
      radios.push(radio);
      return h("label", { class: "tier-option" }, radio,
        h("span", { class: "tier-option-text" }, h("span", { class: "tier-option-name", id: nameId }, t.title),
          h("span", { class: "tier-option-left" }, availability(t))),
        h("span", { class: "tier-option-price figure-inline" }, money(t.price)));
    });
    const group = h("fieldset", { class: "tier-group", role: "radiogroup", "aria-labelledby": legendId },
      h("legend", { id: legendId }, "Reward tier"), ...options);
    const select = h("select", { autocomplete: "country-name" },
      ...COUNTRIES.map((c) => h("option", { value: c.code }, c.name)));
    select.value = selection.country;
    select.addEventListener("change", () => {
      selection.country = select.value;
      scheduleQuote();
    });
    const country = field(uid("country"), "Shipping country", select);
    const addOnInput = moneyInput(selection.addOn);
    addOnInput.setAttribute("role", "spinbutton");
    addOnInput.setAttribute("aria-valuemin", "0");
    addOnInput.setAttribute("aria-valuemax", "500");
    const syncValue = () => {
      const pence = parsePounds(addOnInput.value);
      if (pence === null) addOnInput.removeAttribute("aria-valuenow");
      else addOnInput.setAttribute("aria-valuenow", decimalPounds(pence));
    };
    syncValue();
    addOnInput.addEventListener("input", () => {
      selection.addOn = addOnInput.value;
      syncValue();
      scheduleQuote();
    });
    addOnInput.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const now = parsePounds(addOnInput.value) ?? 0;
      const next = Math.min(50_000, Math.max(0, now + (event.key === "ArrowUp" ? 100 : -100)));
      addOnInput.value = decimalPounds(next);
      selection.addOn = addOnInput.value;
      syncValue();
      scheduleQuote();
    });
    addOnField = field(uid("addon"), "Add-on (£)", addOnInput, "Pounds and pence, up to 500.00");
    preview = h("div", { class: "preview", role: "status", "aria-live": "polite", "aria-label": "Pledge preview" });
    review = h("button", { type: "button", class: "btn btn-wide" }, "Review pledge");
    review.disabled = !selection.tier;
    review.addEventListener("click", () => void openReview());
    stageHeading = h("h2", { class: "stage-title", tabindex: "-1" }, changing ? "Change your pledge" : "Back this run");
    const actions = h("div", { class: "stage-actions" }, review);
    const stage = h("section", { class: "stage", "aria-label": "Pledge" }, stageHeading, group, country.wrap, addOnField.wrap, preview, actions);
    if (changing) {
      const keep = h("button", { type: "button", class: "btn btn-quiet btn-wide" }, "Back to my pledge");
      keep.addEventListener("click", () => {
        mode = "held";
        paintStage();
        changeButton?.focus();
      });
      actions.append(keep);
    }
    clearQuote();
    if (changing) void fetchQuote();
    return stage;
  }

  function heldStage(pledge: OwnPledge): HTMLElement {
    const tier = campaign.tiers.find((t) => t.id === pledge.tier_id);
    changeButton = h("button", { type: "button", class: "btn" }, "Change pledge");
    cancelButton = h("button", { type: "button", class: "btn btn-quiet" }, "Cancel pledge");
    changeButton.addEventListener("click", () => {
      mode = "change";
      paintStage();
      radios.find((r) => r.checked)?.focus();
    });
    cancelButton.addEventListener("click", () => openCancel());
    stageHeading = h("h2", { class: "stage-title", tabindex: "-1" }, "Your pledge");
    return h("section", { class: "stage", "aria-label": "Pledge" },
      stageHeading,
      h("p", { class: "held-state" }, stateMark(pledge.state)),
      h("dl", { class: "pledge-lines" },
        h("dt", {}, "Tier"), h("dd", {}, tier?.title ?? ""),
        h("dt", {}, `Shipping (${ZONE_NAMES[pledge.zone]})`), h("dd", {}, h("span", { class: "nowrap" }, `${countryName(pledge.country)} ·`), " ", h("span", { class: "nowrap" }, money(pledge.shipping))),
        h("dt", {}, "Add-on"), h("dd", {}, money(pledge.add_on)),
        h("dt", {}, "Total held"), h("dd", { class: "figure-inline" }, money(pledge.amount))),
      h("p", { class: "hint" }, `The card ending ${pledge.card_last4} is held, not charged. You are charged only if the run is funded.`),
      h("div", { class: "stage-actions" }, changeButton, cancelButton));
  }

  function paintStage(): void {
    changeButton = null;
    cancelButton = null;
    review = null;
    preview = null;
    addOnField = null;
    radios = [];
    if (!campaign.pledging_open) {
      gauge.proof(null);
      const heading = HEADINGS[campaign.status];
      stageHost.replaceChildren(heading
        ? h("h2", { class: "closed-heading" }, heading)
        : h("p", { class: "closed-note" }, campaign.status === "draft" ? "This campaign is a draft. Launch it from the Studio." : COPY.closed));
      if (campaign.status === "live") setTimeout(() => void refresh(), 3000);
      return;
    }
    stageHost.replaceChildren(mode === "held" && own ? heldStage(own) : formStage());
    paintRadios();
  }

  /** The confirmed-hold sequence: rings ink, the figure counts, then the announcement. */
  function inkTo(total: number, message: string | null): void {
    const reduced = reducedMotion();
    const from = shownTotal;
    shownTotal = total;
    gauge.ink(total, campaign.percent, reduced);
    void countUp(totalEl, from, total, money, reduced).then(() => {
      if (message) announce(result, message);
    });
  }

  function applyCampaign(next: Campaign): void {
    const modeBefore = campaign.pledging_open;
    campaign = next;
    paintTotals();
    paintTiers();
    if (next.total !== shownTotal) inkTo(next.total, null);
    if (modeBefore !== next.pledging_open || !next.pledging_open) paintStage();
    else paintRadios();
  }

  async function refresh(): Promise<void> {
    const [found, mine] = await load();
    if (!found.ok) return;
    const held = heldOf(found.data.id, mine);
    if (mode !== "form" && !held) {
      own = null;
      mode = "form";
      campaign = found.data;
      paintStage();
    }
    if (held) own = held;
    applyCampaign(found.data);
  }

  async function openReview(): Promise<void> {
    if (!review) return;
    const opener = review;
    if (addOnPence() === null) {
      addOnField?.set(COPY.addOn);
      addOnField?.input.focus();
      return;
    }
    if (radios.find((r) => r.checked)?.disabled) {
      announce(result, COPY.soldOut);
      return;
    }
    window.clearTimeout(quoteTimer);
    const q = quote && quote.tier_id === selection.tier ? quote : await fetchQuote();
    if (!q) return;
    if (mode === "change" && own) openChange(q, opener);
    else openConfirm(q, opener);
  }

  function summary(q: Quote): HTMLElement {
    const tier = campaign.tiers.find((t) => t.id === q.tier_id);
    return h("dl", { class: "pledge-lines" },
      h("dt", {}, "Tier"), h("dd", {}, tier?.title ?? ""),
      h("dt", {}, `Shipping (${ZONE_NAMES[q.zone]})`), h("dd", {}, h("span", { class: "nowrap" }, `${countryName(selection.country)} ·`), " ", h("span", { class: "nowrap" }, money(q.shipping))),
      h("dt", {}, "Add-on"), h("dd", {}, money(q.add_on)),
      h("dt", {}, "Pledge total"), h("dd", { class: "figure-inline" }, money(q.amount)));
  }

  /** A refused or failed answer that closes the dialog and hands focus back to Review pledge. */
  function closeWith(open: OpenDialog, message: string, focusTo: HTMLElement | null): void {
    gauge.proof(null);
    quote = null;
    open.close(focusTo);
    announce(result, message);
  }

  function openConfirm(q: Quote, opener: HTMLButtonElement): void {
    const needsIdentity = !heldKey();
    const name = needsIdentity ? field(uid("cp-name"), "Name", h("input", { type: "text", autocomplete: "name", maxlength: 80 })) : null;
    const email = needsIdentity ? field(uid("cp-email"), "Email", h("input", { type: "email", autocomplete: "email", maxlength: 254 })) : null;
    const card = field(uid("cp-card"), "Card number", h("input", { type: "text", inputmode: "numeric", autocomplete: "cc-number", spellcheck: "false" }),
      "A test card from the payment setup");
    const confirm = h("button", { type: "submit", class: "btn" }, "Confirm pledge");
    const back = h("button", { type: "button", class: "btn btn-quiet" }, "Back");
    const form = h("form", { class: "dialog-form", novalidate: true }, summary(q), name?.wrap, email?.wrap, card.wrap, h("div", { class: "actions" }, confirm, back));
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "confirm-title" }, h("h2", { id: "confirm-title" }, "Confirm pledge"), form);
    const open = openDialog(dialog, opener, (name ?? card).input);
    back.addEventListener("click", () => open.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (confirm.disabled) return;
      name?.set(name.input.value.trim() ? null : "Enter your name.");
      email?.set(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.input.value.trim()) ? null : "Enter an email address.");
      card.set(null);
      const firstWrong = [name, email].find((f) => f?.error.textContent);
      if (firstWrong) {
        firstWrong.input.focus();
        return;
      }
      confirm.disabled = true;
      announce(result, COPY.pending(q.amount));
      const body: Record<string, unknown> = { tier_id: q.tier_id, country: selection.country, add_on: q.add_on, card_number: card.input.value };
      if (name && email) Object.assign(body, { name: name.input.value.trim(), email: email.input.value.trim() });
      const made = await api<PledgeResult>("POST", `/api/campaigns/${campaign.id}/pledges`, { body, headers: { "Idempotency-Key": newIdempotencyKey() } });
      confirm.disabled = false;
      if (made.ok) {
        if (made.data.key) holdKey(made.data.key);
        own = made.data;
        mode = "held";
        campaign = { ...campaign, total: made.data.campaign_total, percent: made.data.campaign_percent };
        paintTotals();
        paintStage();
        open.close(changeButton);
        inkTo(made.data.campaign_total, COPY.authorised(made.data.amount));
        setTimeout(() => void refresh(), 1000);
        return;
      }
      const code = made.error.error;
      if (code === "card_declined") {
        announce(result, COPY.declined);
        card.input.focus();
      } else if (code === "invalid") {
        announce(result, "");
        const fields = made.error.fields ?? {};
        name?.set(fields.name ?? null);
        email?.set(fields.email ?? null);
        card.set(fields.card_number ?? null);
        if (fields.add_on) {
          open.close(addOnField?.input ?? null);
          addOnField?.set(COPY.addOn);
          return;
        }
        ([name, email, card].find((f) => f && fields[f === card ? "card_number" : f === name ? "name" : "email"]) ?? card).input.focus();
      } else if (code === "tier_sold_out") {
        closeWith(open, COPY.soldOut, opener);
        void refresh();
      } else if (code === "payment_unavailable") {
        closeWith(open, COPY.paymentDown, opener);
      } else if (code === "campaign_closed") {
        closeWith(open, COPY.closed, opener);
        void refresh();
      } else if (code === "already_pledged") {
        closeWith(open, "You already have a pledge on this campaign.", opener);
        void refresh();
      } else if (code === "own_campaign") {
        closeWith(open, "This is your own campaign, so you cannot back it.", opener);
      } else {
        announce(result, "Something went wrong. No hold was placed. Try again.");
      }
    });
  }

  function openChange(q: Quote, opener: HTMLButtonElement): void {
    const pledge = own as OwnPledge;
    const confirm = h("button", { type: "submit", class: "btn" }, "Confirm change");
    const back = h("button", { type: "button", class: "btn btn-quiet" }, "Back");
    const form = h("form", { class: "dialog-form", novalidate: true }, summary(q),
      h("p", { class: "hint" }, `A new hold of ${money(q.amount)} is placed on the card ending ${pledge.card_last4}; the earlier hold of ${money(pledge.amount)} is then released.`),
      h("div", { class: "actions" }, confirm, back));
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "change-title" }, h("h2", { id: "change-title" }, "Confirm change"), form);
    const open = openDialog(dialog, opener, confirm);
    back.addEventListener("click", () => open.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (confirm.disabled) return;
      const body: Record<string, unknown> = {};
      if (q.tier_id !== pledge.tier_id) body.tier_id = q.tier_id;
      if (selection.country !== pledge.country) body.country = selection.country;
      if (q.add_on !== pledge.add_on) body.add_on = q.add_on;
      confirm.disabled = true;
      announce(result, COPY.pending(q.amount));
      const moved = await api<PledgeResult>("PATCH", `/api/pledges/${pledge.id}`, { body, headers: { "Idempotency-Key": newIdempotencyKey() } });
      confirm.disabled = false;
      if (moved.ok) {
        own = moved.data;
        mode = "held";
        campaign = { ...campaign, total: moved.data.campaign_total, percent: moved.data.campaign_percent };
        paintTotals();
        paintStage();
        open.close(changeButton);
        inkTo(moved.data.campaign_total, COPY.changed(moved.data.amount));
        return;
      }
      const code = moved.error.error;
      if (code === "tier_sold_out") {
        closeWith(open, COPY.soldOut, opener);
        void refresh();
      } else if (code === "would_unfund") closeWith(open, COPY.wouldUnfund, opener);
      else if (code === "campaign_closed") {
        closeWith(open, COPY.closed, opener);
        void refresh();
      } else if (code === "payment_unavailable") closeWith(open, COPY.paymentDownKept, opener);
      else if (code === "invalid" && moved.error.fields?.pledge) closeWith(open, "Your pledge already has that tier, country and add-on.", opener);
      else if (code === "invalid" && moved.error.fields?.add_on) {
        open.close(addOnField?.input ?? null);
        addOnField?.set(COPY.addOn);
      } else {
        closeWith(open, "Something went wrong. Your pledge is unchanged.", opener);
        void refresh();
      }
    });
  }

  function openCancel(): void {
    const pledge = own as OwnPledge;
    const opener = cancelButton;
    const yes = h("button", { type: "button", class: "btn" }, "Yes, release my card");
    const keep = h("button", { type: "button", class: "btn btn-quiet" }, "Keep pledge");
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "cancel-title" },
      h("h2", { id: "cancel-title" }, "Cancel pledge"),
      h("div", { class: "dialog-form" },
        h("p", {}, `The hold of ${money(pledge.amount)} on the card ending ${pledge.card_last4} is released${pledge.tier_id && campaign.tiers.find((t) => t.id === pledge.tier_id)?.quantity !== null ? " and your copy goes back to other backers" : ""}.`),
        h("div", { class: "actions" }, yes, keep)));
    const open = openDialog(dialog, opener, keep);
    keep.addEventListener("click", () => open.close());
    yes.addEventListener("click", async () => {
      if (yes.disabled) return;
      yes.disabled = true;
      const gone = await api<OwnPledge>("POST", `/api/pledges/${pledge.id}/cancel`);
      yes.disabled = false;
      if (gone.ok) {
        own = null;
        mode = "form";
        paintStage();
        open.close(stageHeading);
        const [fresh] = await load();
        if (fresh.ok) {
          campaign = fresh.data;
          paintTotals();
          paintTiers();
          paintRadios();
          inkTo(campaign.total, COPY.cancelled);
        } else announce(result, COPY.cancelled);
        return;
      }
      const code = gone.error.error;
      if (code === "would_unfund") closeWith(open, COPY.wouldUnfund, opener);
      else if (code === "campaign_closed") {
        closeWith(open, COPY.closed, opener);
        void refresh();
      } else if (code === "payment_unavailable") closeWith(open, COPY.paymentDownKept, opener);
      else {
        closeWith(open, "Something went wrong. Your pledge is unchanged.", opener);
        void refresh();
      }
    });
  }

  main.querySelector(".loading")?.remove();
  paintTotals();
  paintTiers();
  paintStage();
  pin();
  if (location.hash === "#manage" && changeButton) (changeButton as HTMLButtonElement).focus();
  const timer = setInterval(() => void refresh(), 30_000);
  onLeave(() => clearInterval(timer));
}
