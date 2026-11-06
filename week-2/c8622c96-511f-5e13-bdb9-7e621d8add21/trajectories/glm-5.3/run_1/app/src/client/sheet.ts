// The contact sheet keeps its search, open essay and frame in its address, so
// a reload, a shared link, Back and Forward land on the same view.
import { el, clear, money, prefersReducedMotion } from "./dom.js";
import { api, errorOf } from "./api.js";
import { ClaimControl, HOLD_MS } from "./claim.js";
import type { User } from "./shell.js";
import { iconMarkup } from "./icon.js";

export interface WindowState {
  state: "open" | "claimed";
  held_by: "you" | "your_newsroom" | "another_newsroom" | null;
  held_until: string | null;
  held_until_display: string | null;
  standard_running_until: string | null;
  standard_running_until_display: string | null;
}

export interface Essay {
  id: string;
  title: string;
  credit_line: string;
  state: string;
  lift_at: string;
  lift_display: string;
  caption?: string;
  frames: { id: string; position: number; caption: string; grid_url: string; preview_url: string; story_url?: string }[];
  window: WindowState;
  exclusive_days?: number;
  exclusive_price_minor?: number;
  standard_days?: number;
  standard_price_minor?: number;
  credits?: { handle: string; name: string; position: number; split_bp?: number }[];
}

function sheetUrl(q: string, essay: string | null, frame: number | null): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (essay) params.set("essay", essay);
  if (essay && frame) params.set("frame", String(frame));
  const query = params.toString();
  return `/sheet${query ? `?${query}` : ""}`;
}

function parseAddress(): { q: string; essay: string | null; frame: number } {
  const url = new URL(window.location.href);
  const q = url.searchParams.get("q") ?? "";
  const essay = url.searchParams.get("essay");
  let frame = Number(url.searchParams.get("frame"));
  if (!Number.isFinite(frame)) frame = 1;
  frame = Math.max(1, Math.round(frame));
  return { q, essay, frame };
}

export class SheetScreen {
  private main: HTMLElement;
  private user: User;
  private q = "";
  private openEssay: string | null = null;
  private frame = 1;
  private essays: Essay[] = [];
  private essayCache = new Map<string, Essay>();
  private pollTimer: number | null = null;
  private ledgerTimer: number | null = null;
  readonly claimKeys = new Map<string, string>();
  private viewerOpen = false;
  private sheetStatus = "";

  constructor(main: HTMLElement, user: User) {
    this.main = main;
    this.user = user;
    const state = parseAddress();
    this.q = state.q;
    this.openEssay = state.essay;
    this.frame = state.frame;
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.ledgerTimer) clearInterval(this.ledgerTimer);
  }

  async render(): Promise<void> {
    clear(this.main);
    this.main.append(el("h1", { class: "visually-hidden", text: "Contact sheet" }));
    const search = el("input", {
      class: "field search",
      type: "search",
      placeholder: "Search essays",
      value: this.q,
      "aria-label": "Search essays",
      role: "searchbox",
    }) as HTMLInputElement;
    search.addEventListener("input", () => {
      this.q = search.value;
      // Keystrokes replace the current history entry, never adding one.
      window.history.replaceState({}, "", sheetUrl(this.q, this.openEssay, this.openEssay ? this.frame : null));
      void this.loadList(true);
    });
    const status = el("div", { id: "sheet-status", class: "status", role: "status", "aria-label": "Sheet status" });
    const region = el("div", { class: "sheet-grid", role: "region", "aria-label": "Contact sheet" });
    this.main.append(search, status, region);
    await this.loadList(false);
    if (this.openEssay) {
      await this.openViewerFromAddress();
    }
    this.pollTimer = window.setInterval(() => {
      void this.loadList(true);
      if (this.viewerOpen) void this.refreshOpenEssay();
    }, 30000);
  }

  private async loadList(quiet: boolean): Promise<void> {
    const result = await api.get<{ essays: Essay[] }>(`/api/feed?q=${encodeURIComponent(this.q)}`);
    const err = errorOf(result);
    if (err && err.code === "database_unavailable") {
      this.sheetStatus = "Saltprint Desk can't reach its records right now. Nothing was saved; try again shortly.";
      this.paintStatus();
      return;
    }
    if (result.network) {
      this.sheetStatus = "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
      this.paintStatus();
      return;
    }
    this.essays = (result.body as { essays: Essay[] }).essays ?? [];
    for (const essay of this.essays) this.essayCache.set(essay.id, essay);
    this.sheetStatus = this.essays.length === 0 && this.q !== "" ? `No essays match “${this.q}”.` : "";
    this.paintGrid();
    this.paintStatus();
    void quiet;
  }

  private paintStatus(): void {
    const node = document.getElementById("sheet-status");
    if (node) node.textContent = this.sheetStatus;
  }

  private paintGrid(): void {
    const region = this.main.querySelector(".sheet-grid");
    if (!region) return;
    clear(region as HTMLElement);
    for (const essay of this.essays) {
      const stamp = essay.state === "embargoed" ? `EMBARGOED · lifts ${essay.lift_display}` : `LIVE · since ${essay.lift_display}`;
      const tile = el("button", {
        class: "tile",
        type: "button",
        "aria-label": `Open ${essay.title}`,
        "data-essay": essay.id,
      },
        el("img", { class: "tile-img", src: essay.frames[0]?.grid_url ?? "", alt: "" }),
        el("div", { class: "tile-title", text: essay.title }),
        el("div", { class: "tile-credit dim", text: essay.credit_line }),
        el("div", { class: "tile-stamp mono", text: stamp }),
      ) as HTMLButtonElement;
      tile.addEventListener("click", () => {
        void this.openTile(essay.id, tile);
      });
      (region as HTMLElement).append(tile);
    }
  }

  private async openTile(essayId: string, opener: HTMLElement): Promise<void> {
    this.openEssay = essayId;
    this.frame = 1;
    // Opening a tile adds exactly one history entry, keeping q.
    window.history.pushState({}, "", sheetUrl(this.q, essayId, 1));
    await this.openViewerFromAddress(opener);
  }

  private async openViewerFromAddress(opener?: HTMLElement): Promise<void> {
    const essay = await this.fetchEssay(this.openEssay!);
    if (!essay) {
      // Unknown, invisible or taken down: no dialog, and the address is
      // corrected.
      this.sheetStatus = "That essay isn't available.";
      this.paintStatus();
      this.openEssay = null;
      window.history.replaceState({}, "", sheetUrl(this.q, null, null));
      return;
    }
    const clamped = Math.min(Math.max(1, this.frame), essay.frames.length);
    if (clamped !== this.frame) {
      this.frame = clamped;
      window.history.replaceState({}, "", sheetUrl(this.q, this.openEssay, clamped));
    }
    this.renderViewer(essay, opener);
  }

  private async fetchEssay(id: string): Promise<Essay | null> {
    const cached = this.essayCache.get(id);
    if (cached && this.essayFresh(id)) {
      const result = await api.get<Essay>(`/api/essays/${id}`);
      if (result.status === 200) {
        const essay = result.body as Essay;
        this.essayCache.set(id, essay);
        return essay;
      }
      return null;
    }
    const result = await api.get<Essay>(`/api/essays/${id}`);
    if (result.status === 200) {
      const essay = result.body as Essay;
      this.essayCache.set(id, essay);
      return essay;
    }
    return null;
  }

  private essayFresh(id: string): boolean {
    void id;
    return true;
  }

  private async refreshOpenEssay(): Promise<void> {
    if (!this.openEssay) return;
    const essay = await this.fetchEssay(this.openEssay);
    if (!essay) {
      this.closeViewer(true);
      return;
    }
    this.updateViewerStamps(essay);
  }

  private closeViewer(fromHistory = false): void {
    if (this.ledgerTimer) clearInterval(this.ledgerTimer);
    this.ledgerTimer = null;
    this.viewerOpen = false;
    const dialog = document.querySelector("dialog.viewer");
    if (dialog) {
      dialog.classList.add("closing");
      const remove = (): void => dialog.remove();
      if (prefersReducedMotion()) remove();
      else window.setTimeout(remove, 250);
    }
    this.openEssay = null;
    this.frame = 1;
    if (!fromHistory) {
      // Back while the viewer is open closes it; Escape and Close story do the
      // same when the viewer was opened in this page session.
      window.history.back();
    }
    const tile = document.querySelector(`.tile[data-essay="${this.lastOpenedId ?? ""}"]`);
    const focusTarget = tile ?? this.main.querySelector(".field.search");
    (focusTarget as HTMLElement | null)?.focus();
  }

  private lastOpenedId: string | null = null;

  private renderViewer(essay: Essay, opener?: HTMLElement): void {
    document.querySelectorAll("dialog.viewer").forEach((d) => d.remove());
    this.viewerOpen = true;
    this.lastOpenedId = essay.id;
    const reduced = prefersReducedMotion();

    const progress = el("div", { class: "progress-rule", role: "group", "aria-label": "Story progress" });
    for (let i = 0; i < essay.frames.length; i++) {
      progress.append(el("span", { class: `progress-seg${i < this.frame ? " filled" : ""}` }));
    }

    const prev = el("button", { class: "btn viewer-nav prev", type: "button", text: "Previous frame", "aria-label": "Previous frame", disabled: this.frame <= 1 ? true : null }) as HTMLButtonElement;
    const next = el("button", { class: "btn viewer-nav next", type: "button", text: "Next frame", "aria-label": "Next frame", disabled: this.frame >= essay.frames.length ? true : null }) as HTMLButtonElement;
    const closeBtn = el("button", { class: "btn ghost viewer-close", type: "button", text: "Close story", "aria-label": "Close story" }) as HTMLButtonElement;
    const frameInfo = el("div", { class: "frame-info mono", text: `Frame ${this.frame} of ${essay.frames.length}` });
    const captionNode = el("div", { class: "frame-caption", text: essay.frames[this.frame - 1]?.caption ?? "" });

    const imageWrap = el("div", { class: "story-frame" },
      el("img", { class: "story-img", src: essay.frames[this.frame - 1]?.preview_url ?? "", alt: essay.frames[this.frame - 1]?.caption ?? essay.title }),
    );
    const dialog = el("dialog", { class: "viewer" + (reduced ? " reduced" : ""), "aria-label": essay.title, role: "dialog" },
      progress,
      el("div", { class: "viewer-stage" }, prev, imageWrap, next),
      el("div", { class: "viewer-under" }, captionNode, frameInfo),
    );
    dialog.setAttribute("aria-modal", "true");

    const ledger = new Ledger(this.user, essay, this.claimKeys, {
      onFrameStep: (n) => this.stepFrame(n),
      onFollowChange: () => void this.refreshOpenEssay(),
    });
    dialog.append(ledger.node);

    const step = (delta: number): void => {
      const target = Math.min(Math.max(1, this.frame + delta), essay.frames.length);
      if (target !== this.frame) this.stepFrame(target);
    };
    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    imageWrap.addEventListener("click", (e) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      step(x < rect.width / 2 ? -1 : 1);
    });
    imageWrap.addEventListener("touchstart", (e) => {
      const start = e.touches[0].clientX;
      const width = (e.currentTarget as HTMLElement).getBoundingClientRect().width;
      const end = (ev: TouchEvent): void => {
        const dx = ev.changedTouches[0].clientX - start;
        if (Math.abs(dx) > width / 4) step(dx < 0 ? 1 : -1);
        imageWrap.removeEventListener("touchend", end);
      };
      imageWrap.addEventListener("touchend", end);
    }, { passive: true });

    closeBtn.addEventListener("click", () => this.closeViewer());

    const keyHandler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (ledger.escape()) return;
        this.closeViewer();
        return;
      }
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", keyHandler);
    dialog.dataset.keyHandler = "1";
    (dialog as unknown as { cleanupKeys?: () => void }).cleanupKeys = () => document.removeEventListener("keydown", keyHandler);

    // Tab and Shift+Tab cycle only through controls inside the viewer.
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea")).filter((n) => !n.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    document.body.append(dialog);
    if (!reduced) dialog.classList.add("fade-in");
    ledger.startPolling();

    // Focus: to Next frame, else Previous frame, else Close story.
    (next.disabled ? (prev.disabled ? closeBtn : prev) : next).focus();
    void opener;
  }

  private stepFrame(n: number): void {
    this.frame = n;
    // Stepping frames replaces the current entry and never adds one.
    window.history.replaceState({}, "", sheetUrl(this.q, this.openEssay, n));
    // Re-render the open viewer's frame region.
    const dialog = document.querySelector("dialog.viewer");
    if (!dialog || !this.openEssay) return;
    const essay = this.essayCache.get(this.openEssay);
    if (!essay) return;
    const segs = dialog.querySelectorAll(".progress-seg");
    segs.forEach((seg, i) => seg.classList.toggle("filled", i < n));
    const img = dialog.querySelector(".story-img") as HTMLImageElement | null;
    if (img) img.src = essay.frames[n - 1]?.preview_url ?? "";
    const info = dialog.querySelector(".frame-info");
    if (info) info.textContent = `Frame ${n} of ${essay.frames.length}`;
    const captionNode = dialog.querySelector(".frame-caption");
    if (captionNode) captionNode.textContent = essay.frames[n - 1]?.caption ?? "";
    const prev = dialog.querySelector(".viewer-nav.prev") as HTMLButtonElement | null;
    const next = dialog.querySelector(".viewer-nav.next") as HTMLButtonElement | null;
    if (prev) prev.disabled = n <= 1;
    if (next) next.disabled = n >= essay.frames.length;
    const ledgerShortlist = dialog.querySelector(".ledger-shortlist-add");
    if (ledgerShortlist) {
      ledgerShortlist.setAttribute("aria-label", `Add frame ${n} to shortlist`);
      (ledgerShortlist.querySelector(".ledger-btn-text") as HTMLElement).textContent = "Add frame to shortlist";
    }
  }

  private updateViewerStamps(essay: Essay): void {
    const dialog = document.querySelector("dialog.viewer");
    if (!dialog) return;
    const stamp = dialog.querySelector(".ledger-stamp");
    if (stamp) {
      const text = essay.state === "embargoed" ? `EMBARGOED · lifts ${essay.lift_display}` : `LIVE · since ${essay.lift_display}`;
      stamp.textContent = text;
    }
    (dialog as unknown as { essay?: Essay }).essay = essay;
    const event = new CustomEvent("essay-refresh", { detail: essay });
    dialog.dispatchEvent(event);
  }

  // The history-driven close: called from the popstate handler.
  onPopState(): void {
    const state = parseAddress();
    const hadViewer = this.viewerOpen;
    this.q = state.q;
    this.openEssay = state.essay;
    this.frame = state.frame;
    const search = this.main.querySelector(".field.search") as HTMLInputElement | null;
    if (search && search.value !== state.q) search.value = state.q;
    if (state.essay) {
      void this.openViewerFromAddress();
    } else if (hadViewer) {
      if (this.ledgerTimer) clearInterval(this.ledgerTimer);
      this.ledgerTimer = null;
      this.viewerOpen = false;
      const dialog = document.querySelector("dialog.viewer");
      const cleanup = (dialog as unknown as { cleanupKeys?: () => void } | null)?.cleanupKeys;
      cleanup?.();
      dialog?.remove();
      const tile = document.querySelector(`.tile[data-essay="${this.lastOpenedId ?? ""}"]`);
      const focusTarget = tile ?? this.main.querySelector(".field.search");
      (focusTarget as HTMLElement | null)?.focus();
      void this.loadList(true);
    } else {
      void this.loadList(true);
    }
  }
}

// The ledger: the essay's terms, the claim area with its stack of loose
// prints, the buy-standard and follow buttons, and the shortlist button.
class Ledger {
  readonly node: HTMLElement;
  private user: User;
  private essay: Essay;
  private claim: ClaimControl | null = null;
  private timer: number | null = null;
  private expanded = false;

  private claimKeys: Map<string, string>;

  constructor(user: User, essay: Essay, claimKeys: Map<string, string>, private hooks: { onFrameStep: (n: number) => void; onFollowChange: () => void }) {
    this.claimKeys = claimKeys;
    this.user = user;
    this.essay = essay;
    this.node = this.build();
    this.node.addEventListener("essay-refresh", (e) => {
      this.essay = (e as CustomEvent<Essay>).detail;
      this.updateStamps();
    });
  }

  startPolling(): void {
    this.timer = window.setInterval(() => {
      void api.get<Essay>(`/api/essays/${this.essay.id}`).then((result) => {
        if (result.status === 200) {
          this.essay = result.body as Essay;
          this.updateStamps();
        }
      });
    }, 10000);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.claim?.dispose();
  }

  escape(): boolean {
    if (this.expanded) {
      this.setExpanded(false);
      return true;
    }
    return false;
  }

  private setExpanded(value: boolean): void {
    this.expanded = value;
    const body = this.node.querySelector(".ledger-body");
    const toggle = this.node.querySelector(".ledger-toggle");
    if (body) (body as HTMLElement).classList.toggle("collapsed", !value);
    if (toggle) (toggle as HTMLButtonElement).textContent = value ? "Collapse ledger" : "Expand ledger";
  }

  private build(): HTMLElement {
    const essay = this.essay;
    const isEditor = this.user.role === "picture_editor";
    const stamp = el("div", { class: "ledger-stamp mono stamp", text: essay.state === "embargoed" ? `EMBARGOED · lifts ${essay.lift_display}` : `LIVE · since ${essay.lift_display}` });

    const prints = el("div", { class: "claim-prints" },
      el("img", { class: "print p1", src: essay.frames[0]?.grid_url ?? "", alt: "" }),
      el("img", { class: "print p2", src: essay.frames[1]?.grid_url ?? essay.frames[0]?.grid_url ?? "", alt: "" }),
      el("img", { class: "print p3", src: essay.frames[2]?.grid_url ?? essay.frames[0]?.grid_url ?? "", alt: "" }),
    );

    const band = el("div", { class: "ledger-band" });
    const refreshBand = (): void => {
      const w = this.essay.window;
      clear(band);
      if (w.state === "claimed") {
        band.append(el("div", { class: "band-line dim", text: w.held_by === "another_newsroom" ? "Exclusive window held by another newsroom" : "Exclusive window held" }));
        band.append(el("div", { class: "band-line mono", text: `held until ${w.held_until_display ?? ""}` }));
      } else {
        band.append(el("div", { class: "band-line", text: `Exclusive window · ${essay.exclusive_days ?? ""} days` }));
        band.append(el("div", { class: "band-line mono", text: `${money(essay.exclusive_price_minor ?? 0)}` }));
      }
      band.append(el("div", { class: "band-line dim", text: `Standard licence · ${essay.standard_days ?? ""} days` }));
      band.append(el("div", { class: "band-line mono", text: `${money(essay.standard_price_minor ?? 0)}` }));
    };
    refreshBand();

    const claimStatus = el("div", { id: "claim-status", class: "status", role: "status", "aria-label": "Claim status" });
    const licenceStatus = el("div", { id: "licence-status", class: "status", role: "status", "aria-label": "Licence status" });
    const followStatus = el("div", { id: "follow-status", class: "status", role: "status", "aria-label": "Follow status" });
    const shortlistStatus = el("div", { id: "shortlist-status", class: "status", role: "status", "aria-label": "Shortlist status" });
    const claimProgress = el("div", { class: "claim-progress mono", id: "claim-progress", role: "progressbar", "aria-label": "Claim progress", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", text: "" });

    const claimArea = el("div", { class: "claim-area" }, prints);
    const buttons = el("div", { class: "ledger-actions" });

    if (isEditor) {
      const claim = new ClaimControl(claimArea, {
        onStart: () => {
          claimStatus.textContent = "Claiming…";
        },
        onProgress: (value) => {
          claimProgress.setAttribute("aria-valuenow", String(value));
          claimProgress.style.setProperty("--claim-progress", `${value}%`);
        },
        onCancel: () => {
          claimProgress.setAttribute("aria-valuenow", "0");
          claimProgress.style.setProperty("--claim-progress", "0%");
        },
        onCommit: () => this.commitClaim("exclusive", claimStatus, claimProgress),
      });
      this.claim = claim;
      buttons.append(claimStatus, claimProgress);

      const buy = el("button", { class: "btn", type: "button", text: "Buy standard licence", "aria-label": "Buy standard licence" }) as HTMLButtonElement;
      buy.addEventListener("click", async () => {
        buy.disabled = true;
        licenceStatus.textContent = "Licensing…";
        await this.commitClaim("standard", licenceStatus);
        buy.disabled = false;
      });
      buttons.append(buy, licenceStatus);
    }

    if (isEditor || this.user.role === "licensing_manager") {
      // picture editors get follow and shortlist controls
    }

    if (isEditor) {
      const followEssay = el("button", { class: "btn ghost", type: "button", text: "Follow essay", "aria-label": "Follow essay", "aria-pressed": "false" }) as HTMLButtonElement;
      const followContrib = el("button", { class: "btn ghost", type: "button", text: `Follow ${essay.credits?.[0]?.name ?? "contributor"}`, "aria-label": `Follow ${essay.credits?.[0]?.name ?? "contributor"}`, "aria-pressed": "false" }) as HTMLButtonElement;
      void this.syncFollows(followEssay, followContrib);
      followEssay.addEventListener("click", () => void this.toggleFollowEssay(followEssay, followStatus));
      followContrib.addEventListener("click", () => void this.toggleFollowContrib(followContrib, followStatus));
      buttons.append(followEssay, followContrib, followStatus);

      const shortlistBtn = el("button", { class: "btn ghost ledger-shortlist-add", type: "button", "aria-label": "Add frame 1 to shortlist" },
        el("span", { class: "ledger-btn-text", text: "Add frame to shortlist" }),
      ) as HTMLButtonElement;
      shortlistBtn.addEventListener("click", () => void this.addShortlist(shortlistBtn, shortlistStatus));
      buttons.append(shortlistBtn, shortlistStatus);
    }

    const header = el("div", { class: "ledger-head" },
      el("div", { class: "ledger-title display", text: essay.title }),
      el("div", { class: "dim", text: essay.credit_line }),
      stamp,
    );

    const body = el("div", { class: "ledger-body" }, claimArea, band, buttons);
    const toggle = el("button", { class: "btn ghost ledger-toggle", type: "button", text: "Expand ledger", "aria-label": "Expand ledger" }) as HTMLButtonElement;
    toggle.addEventListener("click", () => this.setExpanded(!this.expanded));
    this.setExpanded(window.innerWidth >= 1280);

    const node = el("aside", { class: "ledger", "aria-label": "Ledger" }, header, body, toggle);
    node.setAttribute("role", window.innerWidth >= 1280 ? "complementary" : "region");
    if (window.innerWidth < 1280) node.setAttribute("aria-label", "Ledger");
    return node;
  }

  private keyFor(essayId: string, kind: string): string {
    return `${essayId}:${kind}`;
  }

  private async commitClaim(kind: "exclusive" | "standard", status: HTMLElement, progress?: HTMLElement): Promise<void> {
    const mapKey = this.keyFor(this.essay.id, kind);
    let key = this.claimKeys.get(mapKey);
    if (!key) {
      key = `web-${Math.random().toString(36).slice(2, 14)}-${Date.now().toString(36)}`;
      this.claimKeys.set(mapKey, key);
    }
    const result = await api.post<Record<string, unknown>>(`/api/essays/${this.essay.id}/licences`, { kind }, { "Idempotency-Key": key });
    const err = errorOf(result);
    if (result.network || result.status === 0) {
      // No answer: keep the key so the next commit re-sends it.
      status.textContent = kind === "exclusive"
        ? "Couldn't reach Saltprint Desk. Hold Claim again to check whether your claim went through."
        : "Couldn't reach Saltprint Desk. Buy again to check whether your licence went through.";
      return;
    }
    // An HTTP answer arrived: the key's replay has settled the outcome.
    this.claimKeys.delete(mapKey);
    if (result.status === 201 || result.status === 202) {
      const licence = result.body as Record<string, unknown>;
      const state = licence.state as string;
      const end = licence.window_end_display as string;
      if (state === "active") {
        status.textContent = kind === "exclusive" ? `EXCLUSIVE · yours until ${end}` : `STANDARD · licensed until ${end}`;
        status.dataset.tone = "ok";
      } else {
        const hold = (licence.hold_until_display as string) ?? "";
        status.textContent = kind === "exclusive"
          ? `PENDING INVOICE · window held for your newsroom until ${hold}. Billing is unreachable; the invoice is raised automatically when it returns.`
          : `PENDING INVOICE · licence held until ${hold}. Billing is unreachable; the invoice is raised automatically when it returns.`;
      }
      void this.refreshEssay();
      return;
    }
    if (err) {
      status.textContent = this.conflictCopy(err, kind);
      status.dataset.tone = "warn";
      if (progress) {
        progress.setAttribute("aria-valuenow", "0");
        progress.style.setProperty("--claim-progress", "0%");
      }
      void this.refreshEssay();
    }
  }

  private conflictCopy(err: { code: string; message?: string; held_by?: string; held_until_display?: string; blocked_until_display?: string }, kind: string): string {
    switch (err.code) {
      case "window_held": {
        const heldBy = err.held_by as string;
        const until = (err.held_until_display as string) ?? "";
        if (heldBy === "your_newsroom") return `Held by your newsroom until ${until}`;
        return `Held by another newsroom until ${until}`;
      }
      case "already_licensed":
        return "Your newsroom already licenses this essay.";
      case "not_licensable":
        return "This essay can't be licensed right now.";
      case "exclusive_held":
        return `Exclusive held by another newsroom until ${(err.held_until_display as string) ?? ""}`;
      case "standard_licences_active":
        return `Standard licences run until ${(err.blocked_until_display as string) ?? ""}; the exclusive opens then.`;
      case "billing_rejected":
        return "This essay can't be licensed right now.";
      case "taken_down":
        return "This essay can't be licensed right now.";
      default:
        return err.message ?? "This essay can't be licensed right now.";
    }
  }

  private async refreshEssay(): Promise<void> {
    const result = await api.get<Essay>(`/api/essays/${this.essay.id}`);
    if (result.status === 200) {
      this.essay = result.body as Essay;
      this.updateStamps();
    }
  }

  private updateStamps(): void {
    const stamp = this.node.querySelector(".ledger-stamp");
    if (stamp) {
      stamp.textContent = this.essay.state === "embargoed" ? `EMBARGOED · lifts ${this.essay.lift_display}` : `LIVE · since ${this.essay.lift_display}`;
    }
    const band = this.node.querySelector(".ledger-band");
    if (band) {
      const w = this.essay.window;
      clear(band as HTMLElement);
      if (w.state === "claimed") {
        (band as HTMLElement).append(el("div", { class: "band-line dim", text: "Exclusive window claimed" }));
        (band as HTMLElement).append(el("div", { class: "band-line mono", text: `held until ${w.held_until_display ?? ""}` }));
      } else {
        (band as HTMLElement).append(el("div", { class: "band-line", text: `Exclusive window · ${this.essay.exclusive_days ?? ""} days` }));
        (band as HTMLElement).append(el("div", { class: "band-line mono", text: `${money(this.essay.exclusive_price_minor ?? 0)}` }));
      }
      (band as HTMLElement).append(el("div", { class: "band-line dim", text: `Standard licence · ${this.essay.standard_days ?? ""} days` }));
      (band as HTMLElement).append(el("div", { class: "band-line mono", text: `${money(this.essay.standard_price_minor ?? 0)}` }));
    }
    void HOLD_MS;
    void iconMarkup;
  }

  private async syncFollows(followEssay: HTMLButtonElement, followContrib: HTMLButtonElement): Promise<void> {
    const result = await api.get<{ follows: { id: number; essay_id: string | null; contributor: string | null }[] }>("/api/follows");
    if (result.status !== 200) return;
    const follows = (result.body as { follows: { id: number; essay_id: string | null; contributor: string | null }[] }).follows;
    const essayFollow = follows.find((f) => f.essay_id === this.essay.id);
    if (essayFollow) {
      followEssay.textContent = "Following essay";
      followEssay.setAttribute("aria-pressed", "true");
      followEssay.dataset.id = String(essayFollow.id);
    }
    const handle = this.essay.credits?.[0]?.handle;
    const contribFollow = follows.find((f) => f.contributor === handle);
    if (contribFollow) {
      const name = this.essay.credits?.[0]?.name ?? "contributor";
      followContrib.textContent = `Following ${name}`;
      followContrib.setAttribute("aria-pressed", "true");
      followContrib.dataset.id = String(contribFollow.id);
    }
  }

  private async toggleFollowEssay(btn: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (btn.dataset.id) {
      const result = await api.delete(`/api/follows/${btn.dataset.id}`);
      if (result.status === 204) {
        delete btn.dataset.id;
        btn.textContent = "Follow essay";
        btn.setAttribute("aria-pressed", "false");
        status.textContent = `Unfollowed ${this.essay.title}.`;
      }
      return;
    }
    const result = await api.post<{ id: number }>("/api/follows", { essay_id: this.essay.id });
    if (result.status === 201 || result.status === 200) {
      const follow = result.body as { id: number };
      btn.dataset.id = String(follow.id);
      btn.textContent = "Following essay";
      btn.setAttribute("aria-pressed", "true");
      status.textContent = `Following ${this.essay.title}.`;
    } else {
      const err = errorOf(result);
      status.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  }

  private async toggleFollowContrib(btn: HTMLButtonElement, status: HTMLElement): Promise<void> {
    const handle = this.essay.credits?.[0]?.handle;
    const name = this.essay.credits?.[0]?.name ?? "contributor";
    if (!handle) return;
    if (btn.dataset.id) {
      const result = await api.delete(`/api/follows/${btn.dataset.id}`);
      if (result.status === 204) {
        delete btn.dataset.id;
        btn.textContent = `Follow ${name}`;
        btn.setAttribute("aria-pressed", "false");
        status.textContent = `Unfollowed ${name}.`;
      }
      return;
    }
    const result = await api.post<{ id: number }>("/api/follows", { contributor: handle });
    if (result.status === 201 || result.status === 200) {
      const follow = result.body as { id: number };
      btn.dataset.id = String(follow.id);
      btn.textContent = `Following ${name}`;
      btn.setAttribute("aria-pressed", "true");
      status.textContent = `Following ${name}.`;
    } else {
      const err = errorOf(result);
      status.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  }

  private async addShortlist(btn: HTMLButtonElement, status: HTMLElement): Promise<void> {
    const frame = this.essay.frames[this.frameIndex() - 1];
    if (!frame) return;
    btn.disabled = true;
    const result = await api.post("/api/shortlist", { frame_id: frame.id });
    btn.disabled = false;
    if (result.status === 201 || result.status === 200) {
      btn.textContent = "On shortlist";
      btn.disabled = true;
      status.textContent = `Frame ${frame.position} added to shortlist.`;
    } else {
      const err = errorOf(result);
      status.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  }

  private frameIndex(): number {
    const url = new URL(window.location.href);
    let frame = Number(url.searchParams.get("frame"));
    if (!Number.isFinite(frame) || frame < 1) frame = 1;
    return Math.min(frame, this.essay.frames.length);
  }
}
