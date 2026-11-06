import { api, centsToMoney, Credit, Cycle, Line, Me, newIdempotencyKey, NetworkError } from "../api.js";
import { clear, el, isWide, onEvent, reducedMotion, Unsubscribe } from "../util.js";
import { announce } from "../live.js";
import { openDialog } from "../dialog.js";
import { CaseBlock, BlockHooks } from "../blocks/caseblock.js";
import { crateManager } from "../crate/manager.js";
import { onPaymentsChange, refreshPaymentsStatus, startPaymentsPolling } from "../session.js";

/**
 * The member cycle screen: case blocks in the open grid and the sealed rail
 * (or the Open and Sealed tabs on a narrow screen), with the credit panel,
 * banners and the ten-second refresh that never disturbs anything.
 */
export async function renderMemberCycle(page: HTMLElement, me: Me, cycleId: string): Promise<void> {
  let cycle: Cycle | null = null;
  let reqSeq = 0;
  let appliedCycleSeq = 0;
  let cycleSentAt = 0;
  let lastOwnResponseAt = 0;
  let creditSentAt = 0;
  let creditAppliedAt = 0;
  let accepting = true;
  let cutoffBanned = false;
  const blocks = new Map<string, CaseBlock>();
  let unsubs: Unsubscribe[] = [];
  let selectedTab: "open" | "sealed" = "open";
  let lastLineVersions = new Map<string, number>();
  let topUpAttempt: { key: string; amount: string; failed: boolean } | null = null;

  const notices = el("div", { class: "notices", role: "region", "aria-label": "Notices" });
  const headerWrap = el("div", { class: "cycle-header" });
  const creditPanel = el("div", { class: "credit-panel", role: "region", "aria-label": "Credit" });
  const casesLayout = el("div", { class: "cases-layout" });
  const openPanelWrap = el("div", { class: "open-cases" });
  const sealedPanelWrap = el("aside", { class: "sealed-rail", role: "complementary", "aria-label": "Sealed cases", tabindex: "-1" });
  const tabsWrap = el("div", { class: "cases-tabs", role: "tablist", "aria-label": "Cases" });
  const openGrid = el("div", { class: "cases-grid" });
  const sealedGrid = el("div", { class: "cases-grid" });
  openPanelWrap.append(openGrid);
  sealedPanelWrap.append(sealedGrid);
  casesLayout.append(openPanelWrap, sealedPanelWrap);
  page.append(headerWrap, notices, creditPanel, casesLayout, tabsWrap);

  // ---------- hooks the blocks use ----------

  const hooks: BlockHooks = {
    getCycleId: () => cycleId,
    isAccepting: () => accepting,
    setCredit: (credit) => {
      lastOwnResponseAt = Date.now();
      drawCredit(credit as Credit);
    },
    cutoffRefusal: () => {
      // A past-cutoff refusal outranks any refresh still in flight.
      accepting = false;
      cutoffBanned = true;
      appliedCycleSeq = reqSeq + 1000;
      drawAcceptance();
      for (const block of blocks.values()) block.redrawStatic();
    },
    panelShown: (block) => isPanelVisible(block),
    sealChange: (block, nowSealed, animated) => moveBlock(block, nowSealed, animated),
  };

  // ---------- layout: rail at 768+, tabs below ----------

  function isNarrow(): boolean {
    return window.innerWidth < 768;
  }

  function isPanelVisible(block: CaseBlock): boolean {
    if (isWide()) return true;
    return blockPanel(block) === selectedTab;
  }

  function blockPanel(block: CaseBlock): "open" | "sealed" {
    return block.line.status === "sealed" || block.line.status === "taken_up" ? "sealed" : "open";
  }

  function syncLayoutMode(previousWidth: number): void {
    const narrow = isNarrow();
    if (narrow) {
      sealedPanelWrap.removeAttribute("role");
      sealedPanelWrap.removeAttribute("aria-label");
      sealedPanelWrap.removeAttribute("tabindex");
      sealedPanelWrap.classList.add("tabpanel");
      openPanelWrap.classList.add("tabpanel");
      buildTabs();
      applyTabSelection();
    } else {
      sealedPanelWrap.setAttribute("role", "complementary");
      sealedPanelWrap.setAttribute("aria-label", "Sealed cases");
      sealedPanelWrap.setAttribute("tabindex", "-1");
      sealedPanelWrap.classList.remove("tabpanel");
      openPanelWrap.classList.remove("tabpanel");
      tabsWrap.replaceChildren();
      openPanelWrap.removeAttribute("aria-labelledby");
      sealedPanelWrap.removeAttribute("aria-labelledby");
      openPanelWrap.style.display = "";
      sealedPanelWrap.style.display = "";
    }
    void previousWidth;
  }

  let tabOpen: HTMLElement | null = null;
  let tabSealed: HTMLElement | null = null;

  function buildTabs(): void {
    if (tabOpen && tabsWrap.contains(tabOpen)) return;
    tabsWrap.replaceChildren();
    tabOpen = el("button", { class: "tab", role: "tab", id: "tab-open", "aria-selected": "true", text: "Open" });
    tabSealed = el("button", { class: "tab", role: "tab", id: "tab-sealed", "aria-selected": "false", text: "Sealed" });
    openPanelWrap.setAttribute("role", "tabpanel");
    openPanelWrap.setAttribute("aria-labelledby", "tab-open");
    sealedPanelWrap.setAttribute("role", "tabpanel");
    sealedPanelWrap.setAttribute("aria-labelledby", "tab-sealed");
    tabOpen.addEventListener("click", () => selectTab("open", tabOpen!));
    tabSealed.addEventListener("click", () => selectTab("sealed", tabSealed!));
    tabsWrap.append(tabOpen, tabSealed);
  }

  function selectTab(tab: "open" | "sealed", focusTarget?: HTMLElement): void {
    selectedTab = tab;
    applyTabSelection();
    if (focusTarget) focusTarget.focus();
  }

  function applyTabSelection(): void {
    if (!tabOpen || !tabSealed) return;
    tabOpen.setAttribute("aria-selected", String(selectedTab === "open"));
    tabSealed.setAttribute("aria-selected", String(selectedTab === "sealed"));
    openPanelWrap.style.display = selectedTab === "open" ? "" : "none";
    sealedPanelWrap.style.display = selectedTab === "sealed" ? "" : "none";
    for (const block of blocks.values()) {
      if (isPanelVisible(block)) block.panelDraw("shown");
    }
  }

  tabsWrap.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const next = selectedTab === "open" ? tabSealed : tabOpen;
      if (next) selectTab(selectedTab === "open" ? "sealed" : "open", next);
      e.preventDefault();
    }
  });

  // ---------- block placement ----------

  function moveBlock(block: CaseBlock, nowSealed: boolean, animated: boolean): void {
    const target = nowSealed ? sealedGrid : openGrid;
    const wasInSealed = block.article.parentElement === sealedGrid;
    if (block.article.parentElement !== target) {
      const focused = block.article.contains(document.activeElement);
      const rect = animated && !reducedMotion() ? block.article.getBoundingClientRect() : null;
      target.append(block.article);
      if (rect) {
        const newRect = block.article.getBoundingClientRect();
        const dx = rect.left - newRect.left;
        const dy = rect.top - newRect.top;
        block.article.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 300, easing: "ease-out" }
        );
      }
      if (focused && animated) {
        // Focus when a case moves, by width and by tab.
        if (isWide()) {
          block.spinbutton.focus();
        } else if (selectedTab === "open" && nowSealed) {
          tabSealed?.focus();
        } else if (selectedTab === "sealed" && !nowSealed) {
          tabOpen?.focus();
        } else {
          block.spinbutton.focus();
        }
      }
      if (isNarrow()) applyTabSelection();
      void crateManager.afterResize();
    }
    void wasInSealed;
  }

  function placeAllBlocks(): void {
    for (const block of blocks.values()) {
      const target = blockPanel(block) === "sealed" ? sealedGrid : openGrid;
      if (block.article.parentElement !== target) {
        target.append(block.article);
      }
    }
  }

  // ---------- credit panel ----------

  function drawCredit(credit: Credit): void {
    clear(creditPanel);
    const topUp = el("button", { text: "Top up" });
    topUp.addEventListener("click", () => topUpDialog(topUp));
    creditPanel.append(
      el(
        "div",
        { class: "figures" },
        figure("BALANCE", centsToMoney(credit.balance_cents)),
        figure("HELD", centsToMoney(credit.held_cents)),
        figure("SPENDABLE", centsToMoney(credit.spendable_cents))
      ),
      topUp,
      el("a", { href: "/credit", "data-nav": true, text: "Credit history" })
    );
  }

  const figure = (label: string, value: string) =>
    el("div", { class: "figure" }, el("span", { class: "label", text: label }), el("span", { class: "value", text: value }));

  function topUpDialog(opener: HTMLElement): void {
    const existingKey = () => {
      // One idempotency key per open dialog, reused until the amount is edited.
      if (!topUpAttempt || topUpAttempt.amount !== amountText()) {
        topUpAttempt = { key: newIdempotencyKey(), amount: amountText(), failed: false };
      }
      return topUpAttempt.key;
    };
    let input: HTMLInputElement;
    const amountText = () => input?.value ?? "";

    openDialog({
      label: "Top up credit",
      returnFocusTo: opener,
      onClose: () => {},
      build: (body, close) => {
        input = el("input", { type: "text", value: "", autocomplete: "off" }) as HTMLInputElement;
        input.setAttribute("aria-label", "Amount in dollars");
        const error = el("div", { class: "field-error", hidden: true, role: "alert" });
        const confirm = el("button", { text: "Confirm top-up" });
        const cancel = el("button", { text: "Cancel" });
        body.append(
          el("h2", { text: "Top up credit" }),
          el("div", { class: "field" }, el("label", { class: "label", text: "AMOUNT IN DOLLARS" }), input, error),
          el("div", { class: "actions" }, cancel, confirm)
        );
        cancel.addEventListener("click", close);
        confirm.addEventListener("click", async () => {
          if (confirm.hasAttribute("disabled")) return;
          confirm.setAttribute("disabled", "");
          confirm.textContent = "Confirming...";
          error.hidden = true;
          const key = existingKey();
          const amount = input.value;
          try {
            const { data } = await api<{ topup: { amount_cents: number }; credit: Credit }>("/api/topups", {
              method: "POST",
              body: JSON.stringify({ amount }),
              idempotencyKey: key,
            });
            topUpAttempt = null;
            lastOwnResponseAt = Date.now();
            drawCredit(data.credit);
            announce("credit", `Top-up of ${centsToMoney(data.topup.amount_cents)} confirmed. Spendable credit is now ${centsToMoney(data.credit.spendable_cents)}.`);
            close();
          } catch (e) {
            confirm.removeAttribute("disabled");
            confirm.textContent = "Confirm top-up";
            if (e instanceof NetworkError) {
              error.hidden = false;
              error.textContent = "Couldn't confirm your top-up. Check your connection and try again.";
            } else if (e instanceof Error && "status" in e && (e as { status: number }).status === 503) {
              void refreshPaymentsStatus();
              error.hidden = false;
              error.textContent = "Couldn't confirm your top-up. Check your connection and try again.";
              announce("credit", "Top-up not taken. Your credit has not changed.");
            } else {
              error.hidden = false;
              error.textContent = "Enter an amount from $5.00 to $500.00.";
            }
          }
        });
        input.addEventListener("input", () => {
          if (topUpAttempt && topUpAttempt.amount !== input.value) {
            topUpAttempt = { key: newIdempotencyKey(), amount: input.value, failed: false };
          }
        });
        input.focus();
      },
    });
  }

  // ---------- header, banners, refresh ----------

  function drawHeader(c: Cycle): void {
    clear(headerWrap);
    headerWrap.append(
      el("h1", { text: c.name }),
      el("p", { class: "label", text: c.status.toUpperCase() }),
      el("div", { class: "times" },
        el("span", {}, el("span", { class: "label", text: "CUTOFF" }), el("span", { class: "value", text: c.cutoff_display ?? "" })),
        el("span", {}, el("span", { class: "label", text: "PICKUP" }), el("span", { class: "value", text: c.pickup_display ?? "" }))
      )
    );
  }

  function drawNotices(): void {
    clear(notices);
    if (cutoffBanned || (cycle && !cycle.accepting_pledges)) {
      notices.append(el("div", { class: "banner", text: `Cutoff has passed. Pledges for ${cycle?.name ?? "this cycle"} are closed.` }));
    }
  }

  function drawAcceptance(): void {
    drawNotices();
    for (const block of blocks.values()) block.redrawStatic();
  }

  async function refresh(): Promise<void> {
    const sentAt = Date.now();
    const seq = ++reqSeq;
    cycleSentAt = sentAt;
    creditSentAt = sentAt;
    try {
      const { data } = await api<Cycle>(`/api/cycles/${cycleId}`);
      if (seq <= appliedCycleSeq - 999) return; // a past-cutoff refusal won
      cycle = data;
      // Cycle-level fields apply only from a newer request.
      if (seq > appliedCycleSeq) {
        appliedCycleSeq = seq;
        accepting = data.accepting_pledges;
        cutoffBanned = cutoffBanned || !data.accepting_pledges;
        drawHeader(data);
        drawNotices();
      }
      // Credit panel from a refresh only when this request was sent after the
      // latest own response.
      if (data.credit && creditSentAt > lastOwnResponseAt && creditSentAt > creditAppliedAt) {
        creditAppliedAt = creditSentAt;
        drawCredit(data.credit);
      }
      // Lines apply by version.
      for (const line of data.lines) {
        const block = blocks.get(line.product_id);
        if (!block) continue;
        const prior = lastLineVersions.get(line.product_id);
        lastLineVersions.set(line.product_id, line.version);
        if (prior === undefined || line.version > prior) {
          block.applyLine(line, { sequence: false });
          block.updateMax();
        } else {
          block.updateMax();
        }
      }
      placeAllBlocks();
      for (const block of blocks.values()) {
        if (isPanelVisible(block)) block.panelDraw("line");
      }
      if (isNarrow()) applyTabSelection();
    } catch {
      /* keep the page as it is */
    }
  }

  // ---------- build ----------

  const initial = await api<Cycle>(`/api/cycles/${cycleId}`);
  cycle = initial.data;
  accepting = cycle.accepting_pledges;
  lastLineVersions = new Map(cycle.lines.map((l) => [l.product_id, l.version]));
  drawHeader(cycle);
  drawNotices();
  if (cycle.credit) drawCredit(cycle.credit);

  for (const line of cycle.lines) {
    const block = new CaseBlock(line, hooks);
    blocks.set(line.product_id, block);
    (blockPanel(block) === "sealed" ? sealedGrid : openGrid).append(block.build());
  }
  syncLayoutMode(window.innerWidth);
  if (isNarrow()) applyTabSelection();

  for (const block of blocks.values()) {
    crateManager.fitCanvas(block.canvas);
    block.panelDraw("first");
  }

  const paymentListener = (paused: boolean) => {
    if (!paused) return;
    if (!notices.querySelector(".banner-payments")) {
      notices.append(
        el("div", { class: "banner banner-payments", text: "Payments are paused. We can't take top-ups right now; your credit and pledges are safe." })
      );
    }
  };
  onPaymentsChange(paymentListener);
  void refreshPaymentsStatus();

  const resizeHandler = () => {
    const previousWidth = window.innerWidth;
    requestAnimationFrame(() => {
      const focusedBlock = [...blocks.values()].find((b) => b.article.contains(document.activeElement));
      const focusWasTabOpen = tabOpen?.contains(document.activeElement) ?? false;
      const focusWasTabSealed = tabSealed?.contains(document.activeElement) ?? false;
      syncLayoutMode(previousWidth);
      if (isNarrow()) {
        // Select the tab that holds the focused case block.
        if (focusedBlock) {
          const holding = blockPanel(focusedBlock);
          if (selectedTab !== holding && !focusWasTabOpen && !focusWasTabSealed) {
            selectedTab = holding;
          }
        } else if (focusWasTabSealed) {
          selectedTab = "sealed";
        } else if (!focusWasTabOpen) {
          selectedTab = "open";
        }
        applyTabSelection();
        if (focusWasTabOpen && !document.body.contains(document.activeElement)) tabOpen?.focus();
        if (focusWasTabSealed && !document.body.contains(document.activeElement)) tabSealed?.focus();
      } else {
        // Moving wide: focus fallbacks from the removed tab bar.
        if (focusWasTabSealed) {
          selectedTab = "open";
          sealedPanelWrap.focus();
        } else if (focusWasTabOpen) {
          const first = [...blocks.values()].find((b) => blockPanel(b) === "open");
          if (first) first.spinbutton.focus();
          else sealedPanelWrap.focus();
        }
      }
      for (const block of blocks.values()) {
        crateManager.fitCanvas(block.canvas);
      }
      void crateManager.redrawAll("size");
    });
  };
  unsubs.push(onEvent(window, "tally-resize", resizeHandler));

  const contextSub = crateManager.subscribe(() => {
    for (const block of blocks.values()) {
      block.slider.setAttribute("aria-disabled", crateManager.hasWebgl() ? "false" : "true");
    }
    if (!crateManager.hasWebgl()) {
      for (const block of blocks.values()) {
        if (isPanelVisible(block)) block.panelDraw("shown");
      }
    }
  });

  document.fonts.ready.then(() => {
    void crateManager.redrawAll("font");
  });

  startPaymentsPolling();

  const timer = setInterval(() => {
    if (!document.body.contains(page)) {
      cleanup();
      return;
    }
    void refresh();
    void refreshPaymentsStatus();
  }, 10000);

  function cleanup(): void {
    clearInterval(timer);
    for (const u of unsubs) u();
    contextSub();
    for (const block of blocks.values()) block.destroy();
  }
  void me;
}
