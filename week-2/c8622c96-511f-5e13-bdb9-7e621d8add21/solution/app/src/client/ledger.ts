// The story viewer's ledger: stamps, window bands, the grease-pencil claim, standard licence, follows and the
// shortlist. A right rail at 1280 wide, a bottom sheet below that.
import { coopTime } from "../shared/coop-time.js";
import { dollars } from "../shared/money.js";
import { attempt, call, failureText, get, type Answer } from "./api.js";
import { ClaimHold } from "./claim.js";
import { h, icon, reducedMotion, say, svg, type IconName } from "./dom.js";
import type { AppContext } from "./main.js";
import { sheetStamp } from "./sheet.js";
import type { Essay, Follow, Licence, ShortlistItem } from "./types.js";

const NO_ANSWER_CLAIM = "Couldn't reach Saltprint Desk. Hold Claim again to check whether your claim went through.";
const NO_ANSWER_BUY = "Couldn't reach Saltprint Desk. Buy again to check whether your licence went through.";
const NOT_LICENSABLE = "This essay can't be licensed right now.";
const ALREADY = "Your newsroom already licenses this essay.";
const PENDING_TAIL = "Billing is unreachable; the invoice is raised automatically when it returns.";
const RING_RADIUS = 58;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Idempotency keys of requests that got no answer, kept for the life of the page per essay and kind. */
const unanswered = new Map<string, string>();

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `claim-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

type Tone = "won" | "pending" | "lost" | "neutral";

interface Stamp {
  text: string;
  tone: Tone;
}

const wide = window.matchMedia("(min-width: 1280px)");

export class Ledger {
  readonly element: HTMLElement;
  private essay: Essay;
  private licence: Licence | null = null;
  private follows: Follow[] = [];
  private shortlist: ShortlistItem[] = [];
  private readonly editor: boolean;
  private readonly stamp: HTMLElement;
  private readonly exclusiveBand: HTMLElement;
  private readonly standardBand: HTMLElement;
  private readonly claimStatus: HTMLElement;
  private readonly licenceStatus: HTMLElement;
  private readonly followStatus: HTMLElement;
  private readonly shortlistStatus: HTMLElement;
  private readonly claimButton: HTMLButtonElement;
  private readonly pair: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private readonly buy: HTMLButtonElement;
  private readonly bar: HTMLElement;
  private readonly ring: SVGElement;
  private readonly followRow: HTMLElement;
  private readonly addFrame: HTMLButtonElement;
  private readonly toggle: HTMLButtonElement;
  private readonly hold: ClaimHold | null;
  private claimSource: "action" | "derived" = "derived";
  private licenceSource: "action" | "derived" = "derived";
  private inFlight = false;
  private readonly timer: number;
  private readonly onWidth: () => void;
  private readonly sizing: ResizeObserver;

  constructor(essay: Essay, app: AppContext, private readonly frame: () => number) {
    this.essay = essay;
    this.editor = app.user.role === "picture_editor";
    this.stamp = h("p", { class: "stamp ledger-stamp" });
    this.exclusiveBand = h("div", { class: "band" });
    this.standardBand = h("div", { class: "band" });
    this.claimStatus = h("p", { role: "status", "aria-label": "Claim status", class: "claim-status" });
    this.licenceStatus = h("p", { role: "status", "aria-label": "Licence status", class: "licence-status" });
    this.followStatus = h("p", { role: "status", "aria-label": "Follow status", class: "quiet-status" });
    this.shortlistStatus = h("p", { role: "status", "aria-label": "Shortlist status", class: "quiet-status" });
    this.ring = svg("circle", { cx: 70, cy: 70, r: RING_RADIUS, class: "ring", "stroke-dasharray": RING_LENGTH.toFixed(2),
      "stroke-dashoffset": RING_LENGTH.toFixed(2), transform: "rotate(-90 70 70)" });
    const ringSvg = svg("svg", { viewBox: "0 0 140 140", class: "ring-svg", "aria-hidden": "true" });
    ringSvg.append(svg("circle", { cx: 70, cy: 70, r: RING_RADIUS, class: "ring-track" }), this.ring);
    this.bar = h("div", { class: "claim-progress", role: "progressbar", "aria-label": "Claim progress",
      "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 0 }, ringSvg);
    const prints = h("div", { class: "prints" }, ...essay.frames.slice(0, 3).map((f, i) =>
      h("span", { class: `print print-${i + 1}` }, f.grid_url ? h("img", { src: f.grid_url, alt: "", width: 600, height: 600 }) : null)));
    this.claimButton = h("button", { type: "button", class: "button button-claim" }, "Claim exclusive window");
    this.confirm = h("button", { type: "button", class: "button button-claim" }, "Confirm claim");
    const cancel = h("button", { type: "button", class: "button button-ghost" }, "Cancel claim");
    this.pair = h("div", { class: "claim-pair", hidden: true },
      h("p", { class: "step mono" }, "Step 2 of 2"), h("div", { class: "pair-buttons" }, this.confirm, cancel));
    this.buy = h("button", { type: "button", class: "button button-primary" }, "Buy standard licence");
    this.followRow = h("div", { class: "follow-row" });
    this.addFrame = h("button", { type: "button", class: "button button-ghost" });
    this.toggle = h("button", { type: "button", class: "button button-ghost sheet-toggle", "aria-expanded": "false" },
      icon("chevron-up"), "Expand ledger");

    const claimArea = h("div", { class: "claim-area" },
      h("div", { class: "claim-figure" }, prints, this.bar),
      this.editor ? h("div", { class: "claim-controls" }, this.claimButton, this.pair, this.claimStatus) : null);
    this.element = h("section", { class: "ledger", "aria-label": "Ledger" },
      h("div", { class: "sheet-handle" }, this.toggle),
      h("div", { class: "ledger-body" },
        h("header", { class: "ledger-head ledger-more" },
          h("h2", { id: "viewer-title", class: "viewer-title" }, essay.title),
          h("p", { class: "credit-line" }, essay.credit_line)),
        this.stamp,
        h("div", { class: "bands ledger-more" }, this.exclusiveBand, this.standardBand),
        claimArea,
        this.editor ? h("div", { class: "buy-area" }, this.buy, this.licenceStatus) : null,
        this.editor ? h("div", { class: "ledger-extras ledger-more" },
          h("h3", { class: "ledger-subhead" }, "Follow"), this.followRow, this.followStatus,
          h("h3", { class: "ledger-subhead" }, "Shortlist"), this.addFrame, this.shortlistStatus) : null));

    this.toggle.addEventListener("click", () => this.setExpanded(!this.expanded));
    this.dragToToggle();
    claimArea.addEventListener("contextmenu", (event) => event.preventDefault());
    if (this.editor) {
      this.hold = new ClaimHold(this.claimButton, {
        draw: (p) => this.drawRing(p, "neutral"),
        commit: () => void this.sendClaim(),
      }, () => !reducedMotion() && !this.inFlight);
      this.claimButton.addEventListener("click", () => {
        if (!reducedMotion() || this.inFlight) return;
        this.claimButton.hidden = true;
        this.pair.hidden = false;
        this.confirm.focus();
      });
      this.confirm.addEventListener("click", () => {
        this.closePair(false);
        void this.sendClaim();
      });
      cancel.addEventListener("click", () => this.closePair(true));
      this.buy.addEventListener("click", () => void this.sendBuy());
      this.addFrame.addEventListener("click", () => void this.addToShortlist());
    } else this.hold = null;
    // The stage keeps the collapsed sheet's height free so the frame controls are never covered.
    this.sizing = new ResizeObserver(() => {
      if (!this.expanded) this.element.parentElement?.style.setProperty("--sheet-collapsed", `${this.element.offsetHeight}px`);
    });
    this.sizing.observe(this.element);
    this.onWidth = () => this.applyWidth();
    wide.addEventListener("change", this.onWidth);
    this.applyWidth();
    this.renderEssay();
    this.timer = window.setInterval(() => void this.refresh(), 10_000);
    void this.refresh();
  }

  private get expanded(): boolean {
    return this.element.classList.contains("is-expanded");
  }

  private applyWidth(): void {
    this.element.setAttribute("role", wide.matches ? "complementary" : "region");
    this.toggle.hidden = wide.matches;
    if (wide.matches) this.setExpanded(false, true);
  }

  private setExpanded(expanded: boolean, quiet = false): void {
    if (expanded === this.expanded) return;
    const before = this.element.getBoundingClientRect().height;
    this.element.classList.toggle("is-expanded", expanded);
    this.toggle.replaceChildren(icon(expanded ? "chevron-down" : "chevron-up"), expanded ? "Collapse ledger" : "Expand ledger");
    this.toggle.setAttribute("aria-expanded", String(expanded));
    if (quiet || reducedMotion()) return;
    const after = this.element.getBoundingClientRect().height;
    this.element.animate([{ transform: `translateY(${after - before}px)` }, { transform: "translateY(0)" }],
      { duration: 250, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }

  private dragToToggle(): void {
    let startY: number | null = null;
    this.toggle.addEventListener("pointerdown", (event) => {
      startY = event.clientY;
    });
    this.toggle.addEventListener("pointerup", (event) => {
      if (startY === null) return;
      const dy = event.clientY - startY;
      startY = null;
      if (Math.abs(dy) > 24) {
        event.preventDefault();
        this.setExpanded(dy < 0);
        this.toggle.addEventListener("click", (e) => e.stopImmediatePropagation(), { once: true, capture: true });
      }
    });
  }

  /** Escape closes the two-step pair, then collapses an expanded sheet; returns false when there was nothing to close. */
  escape(): boolean {
    if (!this.pair.hidden) {
      this.closePair(true);
      return true;
    }
    if (this.expanded && !wide.matches) {
      this.setExpanded(false);
      return true;
    }
    return false;
  }

  private closePair(refocus: boolean): void {
    this.pair.hidden = true;
    this.claimButton.hidden = false;
    if (refocus) this.claimButton.focus();
  }

  frameChanged(): void {
    if (this.editor) this.renderShortlistButton();
  }

  private drawRing(progress: number, tone: Tone): void {
    this.ring.setAttribute("stroke-dashoffset", (RING_LENGTH * (1 - progress)).toFixed(2));
    this.ring.setAttribute("class", `ring ring-${tone}`);
    this.bar.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  }

  private showRing(tone: Tone): void {
    if (tone === "won" || tone === "pending") this.drawRing(1, tone);
    else if (tone === "lost") {
      this.drawRing(0.94, "lost");
      this.bar.setAttribute("aria-valuenow", "0");
    } else this.drawRing(0, "neutral");
    this.exclusiveBand.classList.toggle("is-greyed", tone === "lost");
  }

  private setStamp(region: HTMLElement, stamp: Stamp, source: "action" | "derived"): void {
    const iconName: IconName | null = stamp.tone === "won" ? "check" : stamp.tone === "lost" ? "lock"
      : stamp.tone === "pending" ? "clock" : null;
    const textNow = region.textContent ?? "";
    if (textNow === stamp.text && source === "derived") return;
    region.replaceChildren();
    if (reducedMotion() && iconName && region === this.claimStatus) region.append(icon(iconName, 16));
    region.append(stamp.text);
    region.dataset.tone = stamp.tone;
    if (!reducedMotion() && stamp.text) {
      region.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 320, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
    }
    if (region === this.claimStatus) this.claimSource = source;
    else this.licenceSource = source;
  }

  private renderEssay(): void {
    const e = this.essay;
    const text = sheetStamp(e);
    if (this.stamp.textContent !== text) {
      this.stamp.textContent = text;
      this.stamp.classList.toggle("stamp-embargo", e.state === "embargoed");
      if (!reducedMotion()) this.stamp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320 });
    }
    const w = e.window;
    const held = w.state === "claimed";
    this.exclusiveBand.replaceChildren(
      h("p", { class: "band-label" }, "Exclusive window"),
      h("p", { class: "band-figures mono" }, `${e.exclusive_days} ${e.exclusive_days === 1 ? "day" : "days"} · ${dollars(e.exclusive_price_minor)}`),
      h("p", { class: "band-state" }, held ? `Held until ${w.held_until_display ?? ""}` : w.standard_running_until_display
        ? `Opens ${w.standard_running_until_display}` : "Open"));
    this.exclusiveBand.classList.toggle("is-greyed", held && w.held_by !== "you");
    this.standardBand.replaceChildren(
      h("p", { class: "band-label" }, "Standard licence"),
      h("p", { class: "band-figures mono" }, `${e.standard_days} ${e.standard_days === 1 ? "day" : "days"} · ${dollars(e.standard_price_minor)}`),
      h("p", { class: "band-state" }, "Non-exclusive"));
    if (this.editor) {
      this.renderFollows();
      this.renderShortlistButton();
    }
  }

  /** The claim stamp the server's current state implies, or null when it implies none. */
  private derivedClaim(): Stamp | null {
    const w = this.essay.window;
    if (w.held_by === "you" && this.licence?.kind === "exclusive") return this.licenceStamp(this.licence);
    if (w.held_by === "you" || w.held_by === "your_newsroom") {
      return { text: `Held by your newsroom until ${w.held_until_display ?? ""}`, tone: "lost" };
    }
    if (w.held_by === "another_newsroom") {
      return { text: `Held by another newsroom until ${w.held_until_display ?? ""}`, tone: "lost" };
    }
    if (w.standard_running_until_display) {
      return { text: `Standard licences run until ${w.standard_running_until_display}; the exclusive opens then.`, tone: "lost" };
    }
    return null;
  }

  private licenceStamp(licence: Licence): Stamp {
    if (licence.kind === "exclusive") {
      return licence.state === "pending_invoice"
        ? { text: `PENDING INVOICE · window held for your newsroom until ${licence.hold_until_display ?? ""}. ${PENDING_TAIL}`, tone: "pending" }
        : { text: `EXCLUSIVE · yours until ${licence.window_end_display}`, tone: "won" };
    }
    return licence.state === "pending_invoice"
      ? { text: `PENDING INVOICE · licence held until ${licence.hold_until_display ?? ""}. ${PENDING_TAIL}`, tone: "pending" }
      : { text: `STANDARD · licensed until ${licence.window_end_display}`, tone: "won" };
  }

  async refresh(): Promise<void> {
    const essayAnswer = await attempt(() => get<Essay>(`/api/essays/${encodeURIComponent(this.essay.id)}`));
    if (essayAnswer?.ok && essayAnswer.data) this.essay = essayAnswer.data;
    if (this.editor) {
      const [licences, follows, shortlist] = await Promise.all([
        attempt(() => get<{ licences: Licence[] }>("/api/licences")),
        attempt(() => get<{ follows: Follow[] }>("/api/follows")),
        attempt(() => get<{ items: ShortlistItem[] }>("/api/shortlist")),
      ]);
      if (licences?.ok && licences.data) {
        this.licence = licences.data.licences.find((l) => l.essay_id === this.essay.id
          && (l.state === "active" || l.state === "pending_invoice")) ?? null;
      }
      if (follows?.ok && follows.data) this.follows = follows.data.follows;
      if (shortlist?.ok && shortlist.data) this.shortlist = shortlist.data.items;
    }
    this.renderEssay();
    if (!this.editor || this.inFlight) return;
    // An unanswered request keeps its no-answer stamp until the next commit re-sends its key and settles it.
    if (unanswered.has(`${this.essay.id}:exclusive`)) {
      if (!this.claimStatus.textContent) this.setStamp(this.claimStatus, { text: NO_ANSWER_CLAIM, tone: "neutral" }, "action");
    } else {
      const claim = this.derivedClaim();
      if (claim) {
        this.setStamp(this.claimStatus, claim, "derived");
        if (!this.hold?.holding) this.showRing(claim.tone);
      } else if (this.claimSource === "derived") {
        this.setStamp(this.claimStatus, { text: "", tone: "neutral" }, "derived");
        if (!this.hold?.holding) this.showRing("neutral");
      }
    }
    if (unanswered.has(`${this.essay.id}:standard`)) {
      if (!this.licenceStatus.textContent) this.setStamp(this.licenceStatus, { text: NO_ANSWER_BUY, tone: "neutral" }, "action");
    } else {
      const standard = this.licence?.kind === "standard" ? this.licenceStamp(this.licence) : null;
      if (standard) this.setStamp(this.licenceStatus, standard, "derived");
      else if (this.licenceSource === "derived") this.setStamp(this.licenceStatus, { text: "", tone: "neutral" }, "derived");
    }
  }

  /** Sends one licence request, re-sending the key of an earlier unanswered request for this essay and kind. */
  private async request(kind: "exclusive" | "standard"): Promise<Answer<Licence> | null> {
    const slot = `${this.essay.id}:${kind}`;
    const key = unanswered.get(slot) ?? newKey();
    unanswered.set(slot, key);
    const answer = await attempt(() => call<Licence>("POST", `/api/essays/${encodeURIComponent(this.essay.id)}/licences`,
      { kind }, { "Idempotency-Key": key }));
    if (answer !== null) unanswered.delete(slot);
    return answer;
  }

  /** The stamp for a refused request that both claim and buy share. */
  private refusal(answer: Answer<Licence>): Stamp {
    const e = answer.error;
    const until = typeof e?.held_until === "string" ? coopTime(e.held_until)
      : typeof e?.blocked_until === "string" ? coopTime(e.blocked_until) : "";
    switch (e?.code) {
      case "window_held":
        if (e.held_by === "you" && this.licence) return this.licenceStamp(this.licence);
        return { text: `Held by ${e.held_by === "another_newsroom" ? "another newsroom" : "your newsroom"} until ${until}`, tone: "lost" };
      case "exclusive_held":
        return { text: `Exclusive held by another newsroom until ${until}`, tone: "lost" };
      case "standard_licences_active":
        return { text: `Standard licences run until ${until}; the exclusive opens then.`, tone: "lost" };
      case "already_licensed":
        return { text: ALREADY, tone: "lost" };
      case "not_licensable":
      case "taken_down":
        return { text: NOT_LICENSABLE, tone: "lost" };
      default:
        return { text: failureText(answer), tone: "lost" };
    }
  }

  private async sendClaim(): Promise<void> {
    this.inFlight = true;
    this.claimButton.disabled = true;
    this.drawRing(1, "neutral");
    this.setStamp(this.claimStatus, { text: "Claiming…", tone: "neutral" }, "action");
    const answer = await this.request("exclusive");
    if (answer === null) {
      this.setStamp(this.claimStatus, { text: NO_ANSWER_CLAIM, tone: "neutral" }, "action");
      this.drawRing(0, "neutral");
    } else {
      if (answer.ok && answer.data) this.licence = answer.data;
      if (answer.status === 409 && answer.error?.held_by === "you") await this.refresh();
      const stamp = answer.ok && answer.data ? this.licenceStamp(answer.data) : this.refusal(answer);
      this.setStamp(this.claimStatus, stamp, "action");
      this.showRing(stamp.tone);
    }
    this.inFlight = false;
    this.claimButton.disabled = false;
    void this.refresh();
  }

  private async sendBuy(): Promise<void> {
    if (this.buy.disabled) return;
    this.buy.disabled = true;
    this.setStamp(this.licenceStatus, { text: "Licensing…", tone: "neutral" }, "action");
    const answer = await this.request("standard");
    if (answer === null) this.setStamp(this.licenceStatus, { text: NO_ANSWER_BUY, tone: "neutral" }, "action");
    else {
      if (answer.ok && answer.data) this.licence = answer.data;
      this.setStamp(this.licenceStatus, answer.ok && answer.data ? this.licenceStamp(answer.data) : this.refusal(answer), "action");
    }
    this.buy.disabled = false;
    void this.refresh();
  }

  private renderFollows(): void {
    const targets: { label: string; body: Record<string, string>; match: (f: Follow) => boolean; name: string }[] = [
      { label: "essay", name: this.essay.title, body: { essay_id: this.essay.id }, match: (f) => f.essay_id === this.essay.id },
      ...this.essay.credits.map((c) => ({ label: c.name, name: c.name, body: { contributor: c.handle },
        match: (f: Follow) => f.contributor === c.handle })),
    ];
    this.followRow.replaceChildren(...targets.map((target) => {
      const existing = this.follows.find(target.match);
      const button = h("button", { type: "button", class: "button button-toggle", "aria-pressed": existing ? "true" : "false" },
        icon(existing ? "user-check" : "user-plus"), `${existing ? "Following" : "Follow"} ${target.label}`);
      button.addEventListener("click", () => void (async () => {
        button.disabled = true;
        const answer = existing
          ? await attempt(() => call("DELETE", `/api/follows/${encodeURIComponent(existing.id)}`))
          : await attempt(() => call<Follow>("POST", "/api/follows", target.body));
        if (answer?.ok) {
          say(this.followStatus, existing ? `Unfollowed ${target.name}.` : `Following ${target.name}.`);
          const follows = await attempt(() => get<{ follows: Follow[] }>("/api/follows"));
          if (follows?.ok && follows.data) this.follows = follows.data.follows;
          this.renderFollows();
          this.followRow.querySelectorAll<HTMLButtonElement>("button")[targets.indexOf(target)]?.focus();
        } else {
          button.disabled = false;
          say(this.followStatus, failureText(answer));
        }
      })());
      return button;
    }));
  }

  private renderShortlistButton(): void {
    const frame = this.essay.frames[this.frame() - 1];
    if (!frame) return;
    const listed = this.shortlist.some((item) => item.frame_id === frame.id);
    this.addFrame.replaceChildren(icon(listed ? "bookmark-check" : "bookmark"),
      listed ? "On shortlist" : `Add frame ${frame.position} to shortlist`);
    this.addFrame.disabled = listed;
  }

  private async addToShortlist(): Promise<void> {
    const frame = this.essay.frames[this.frame() - 1];
    if (!frame) return;
    this.addFrame.disabled = true;
    const answer = await attempt(() => call<ShortlistItem>("POST", "/api/shortlist", { frame_id: frame.id }));
    if (answer?.ok && answer.data) {
      this.shortlist = [...this.shortlist, answer.data];
      say(this.shortlistStatus, `Frame ${frame.position} added to shortlist.`);
    } else say(this.shortlistStatus, failureText(answer));
    this.renderShortlistButton();
  }

  dispose(): void {
    window.clearInterval(this.timer);
    wide.removeEventListener("change", this.onWidth);
    this.sizing.disconnect();
    this.hold?.dispose();
  }
}
