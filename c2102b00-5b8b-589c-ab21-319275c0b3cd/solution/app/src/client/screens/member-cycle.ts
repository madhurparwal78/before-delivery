// Member cycle: credit, case blocks, the sealed rail (768 px and up) or Open/Sealed tabs (below),
// pledging, withdrawing and topping up, and a refresh every 10 seconds.
import { api, errorCode, errorFields, newKey, NoResponse } from "../api.js";
import { CaseBlock } from "../case-block.js";
import { type Line, onSealedSide } from "../line.js";
import { openDialog, type DialogHandle } from "../dialog.js";
import { h, isBusy, labelled, money, setBusy, setFieldError, uid } from "../dom.js";
import { announce, main, setNotice, useLive } from "../shell.js";

interface Credit {
  balance_cents: number;
  held_cents: number;
  spendable_cents: number;
}

interface Cycle {
  id: string;
  name: string;
  status: string;
  cutoff_display: string | null;
  pickup_display: string | null;
  accepting_pledges: boolean;
  credit: Credit;
  lines: Line[];
}

const REFRESH_MS = 10_000;
const WIDE = "(min-width: 768px)";
const PAUSED = "Payments are paused. We can't take top-ups right now; your credit and pledges are safe.";

export async function checkPayments(): Promise<void> {
  const r = await api("GET", "/api/payments/status").catch(() => null);
  if (r?.status === 200) setNotice("payments", r.body.payments === "paused" ? PAUSED : null);
}

export async function memberCycleScreen([cycleId]: string[]): Promise<() => void> {
  useLive("Pledge updates", "Credit updates");
  main.replaceChildren(h("p", { class: "loading" }, "Loading the case list"));
  void checkPayments();
  const first = await api<Cycle>("GET", `/api/cycles/${encodeURIComponent(cycleId!)}`);
  if (first.status !== 200) {
    main.replaceChildren(h("section", { class: "panel" }, h("h1", {}, "Page not found"), h("p", {}, h("a", { href: "/" }, "Back to your cycles"))));
    return () => undefined;
  }
  let cycle = first.body;
  document.title = `${cycle.name} · Tally Split`;

  // ---- Header and credit --------------------------------------------------------------------
  const statusEl = h("span", { class: "state-word" });
  const cutoffEl = h("span", { class: "value" });
  const pickupEl = h("span", { class: "value" });
  const header = h("header", { class: "cycle-head panel" },
    h("p", { class: "kicker" }, "Cycle ", statusEl),
    h("h1", {}, cycle.name),
    h("div", { class: "when" }, labelled("CUTOFF", cutoffEl), labelled("PICKUP", pickupEl)));
  const balanceEl = h("span", { class: "value" });
  const heldEl = h("span", { class: "value" });
  const spendableEl = h("span", { class: "value" });
  const topUpButton = h("button", { type: "button", class: "button primary", onclick: () => openTopUp() }, "Top up");
  const creditRegion = h("section", { class: "credit panel", "aria-label": "Credit" },
    h("h2", { class: "panel-title" }, "Your credit"),
    h("div", { class: "figures" }, labelled("BALANCE", balanceEl), labelled("HELD", heldEl), labelled("SPENDABLE", spendableEl, "figure strong")),
    h("div", { class: "credit-actions" }, topUpButton, h("a", { href: "/credit", class: "button quiet" }, "Credit history")));

  function drawCredit(credit: Credit): void {
    balanceEl.textContent = money(credit.balance_cents);
    heldEl.textContent = money(credit.held_cents);
    spendableEl.textContent = money(credit.spendable_cents);
  }

  function drawHeader(c: Cycle): void {
    statusEl.textContent = c.status;
    cutoffEl.textContent = c.cutoff_display ?? "";
    pickupEl.textContent = c.pickup_display ?? "";
    setNotice("cutoff", c.accepting_pledges ? null : `Cutoff has passed. Pledges for ${c.name} are closed.`);
  }

  // ---- Case blocks, rail and tabs ------------------------------------------------------------
  const blocks = new Map<string, CaseBlock>();
  const order = cycle.lines.map((l) => l.product_id);
  const openPanel = h("div", { class: "open-cases", id: uid("open") });
  const sealedPanel = h("section", { class: "sealed-cases", id: uid("sealed") });
  const openTab = h("button", { type: "button", role: "tab", id: uid("tab"), class: "tab" }, "Open");
  const sealedTab = h("button", { type: "button", role: "tab", id: uid("tab"), class: "tab" }, "Sealed");
  const tablist = h("div", { role: "tablist", "aria-label": "Cases", class: "tabs" }, openTab, sealedTab);
  const cases = h("div", { class: "cases" }, openPanel, sealedPanel);
  let selected: "open" | "sealed" = "open";
  let wide = matchMedia(WIDE).matches;

  const container = (line: Line) => (onSealedSide(line) ? sealedPanel : openPanel);
  const selectedTab = () => (selected === "open" ? openTab : sealedTab);
  const blockOf = (el: Element | null) => (el ? [...blocks.values()].find((b) => b.el.contains(el)) : undefined);

  /** Puts a block in its container in cycle order; returns whether it moved. */
  function place(block: CaseBlock): boolean {
    const target = container(block.line);
    const position = order.indexOf(block.line.product_id);
    const before = [...target.children].find((c) => order.indexOf((c as HTMLElement).dataset.product ?? "") > position) ?? null;
    if (block.el.parentElement === target && block.el.nextElementSibling === before) return false;
    const focused = block.el.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const moved = block.el.parentElement !== target;
    target.insertBefore(block.el, before);
    if (focused) {
      if (!wide && target.hidden) selectedTab().focus();
      else focused.focus();
    }
    return moved;
  }

  function select(which: "open" | "sealed", focusTab = false): void {
    selected = which;
    for (const [tab, panel, name] of [[openTab, openPanel, "open"], [sealedTab, sealedPanel, "sealed"]] as const) {
      const on = name === which;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (!wide) panel.hidden = !on;
    }
    if (focusTab) selectedTab().focus();
  }

  /** Exactly one of the sealed rail and the tab bar exists; nothing moves, so focus stays put. */
  function applyLayout(): void {
    const nowWide = matchMedia(WIDE).matches;
    if (nowWide === wide && cases.dataset.layout) return;
    const active = document.activeElement;
    wide = nowWide;
    cases.dataset.layout = wide ? "wide" : "narrow";
    if (wide) {
      tablist.remove();
      for (const panel of [openPanel, sealedPanel]) {
        panel.hidden = false;
        panel.removeAttribute("role");
        panel.removeAttribute("aria-labelledby");
      }
      openPanel.setAttribute("aria-label", "Open cases");
      openPanel.setAttribute("role", "group");
      sealedPanel.setAttribute("role", "complementary");
      sealedPanel.setAttribute("aria-label", "Sealed cases");
      sealedPanel.tabIndex = -1;
      if (active === sealedTab) sealedPanel.focus();
      else if (active === openTab) {
        const firstOpen = [...openPanel.children][0];
        (firstOpen ? blockOf(firstOpen)!.spin : sealedPanel).focus();
      }
    } else {
      cases.prepend(tablist);
      sealedPanel.removeAttribute("tabindex");
      for (const [panel, tab] of [[openPanel, openTab], [sealedPanel, sealedTab]] as const) {
        panel.removeAttribute("aria-label");
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
        tab.setAttribute("aria-controls", panel.id);
      }
      const holder = active === sealedPanel || sealedPanel.contains(active) ? "sealed" : "open";
      select(holder, active === sealedPanel);
    }
  }

  tablist.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      (document.activeElement === openTab ? sealedTab : openTab).focus();
    }
  });
  openTab.addEventListener("click", () => select("open"));
  sealedTab.addEventListener("click", () => select("sealed"));

  // The width is checked every frame, so after a resize the page has settled by the next frame.
  let frame = 0;
  const watchLayout = () => {
    applyLayout();
    frame = requestAnimationFrame(watchLayout);
  };

  // ---- Refresh -------------------------------------------------------------------------------
  let responses = 0;
  // Cycle-level values (status, acceptance, times) apply only from a request sent after the one
  // behind the values on screen; a cutoff refusal counts as sent after every refresh in flight.
  let sent = 0;
  let shownFrom = 0;

  /** Draws a refreshed cycle: newer lines straight to their final state, nothing announced. */
  function applyRefresh(next: Cycle, creditCurrent: boolean, request: number): void {
    const current = request > shownFrom;
    if (current) {
      shownFrom = request;
      cycle = next;
      drawHeader(next);
    }
    if (creditCurrent) drawCredit(next.credit);
    for (const line of next.lines) {
      const block = blocks.get(line.product_id);
      if (!block || block.inFlight || !block.isNewer(line)) continue;
      block.draw(line);
      place(block);
    }
    if (current) for (const block of blocks.values()) block.setControls(next.accepting_pledges);
  }

  async function refresh(): Promise<void> {
    const request = ++sent;
    const sentAfter = responses;
    const r = await api<Cycle>("GET", `/api/cycles/${encodeURIComponent(cycle.id)}`).catch(() => null);
    if (r?.status === 200) applyRefresh(r.body, sentAfter === responses, request);
  }

  /** The server refused a change because cutoff has passed: no earlier refresh can undo that. */
  function cutoffPassed(): void {
    shownFrom = ++sent;
    cycle = { ...cycle, accepting_pledges: false, status: cycle.status === "open" ? "sealing" : cycle.status };
    drawHeader(cycle);
    for (const block of blocks.values()) block.setControls(false);
  }

  // ---- Pledging ------------------------------------------------------------------------------
  /**
   * Draws the household's own confirmed change with the fill sequence. Returns where focus goes:
   * the other tab when a case moves below 768 px, the block's units when it moves at 768 px and up
   * or when a reduction leaves it in place, nowhere otherwise.
   */
  function applyOwn(block: CaseBlock, line: Line, credit: Credit, reduction: boolean): HTMLElement | null {
    responses += 1;
    drawCredit(credit);
    if (!block.isNewer(line)) return null;
    const moves = block.el.parentElement !== container(line);
    block.fill(line, moves ? () => place(block) : null);
    block.settleSpin();
    const target = moves ? (wide ? block.spin : selected === "open" ? sealedTab : openTab) : reduction ? block.spin : null;
    target?.focus();
    return target;
  }

  const retries = new Map<string, { kind: "put" | "delete"; units: number; key: string }>();

  /** One attempt per key; a retry of the same attempt after no response reuses its key. */
  function attemptKey(block: CaseBlock, kind: "put" | "delete", units: number): string {
    const last = retries.get(block.line.product_id);
    if (last && last.kind === kind && last.units === units) return last.key;
    const key = newKey();
    retries.set(block.line.product_id, { kind, units, key });
    return key;
  }

  async function refusal(block: CaseBlock, code: string): Promise<void> {
    const name = block.name;
    if (code === "cutoff_passed") {
      cutoffPassed();
      announce("Pledge updates", `Cutoff has passed. ${name} was not changed.`);
      await refresh();
      return;
    }
    if (code === "not_enough_units") {
      await refresh();
      const left = cycle.lines.find((l) => l.product_id === block.line.product_id)?.units_to_go ?? block.line.units_to_go;
      announce("Pledge updates", `Only ${left} left on ${name}. Your pledge was not changed.`);
      return;
    }
    if (code === "insufficient_credit") {
      announce("Pledge updates", `Not enough credit for ${name}. Top up to pledge more.`);
    } else {
      announce("Pledge updates", `Couldn't confirm your pledge on ${name}. Check your connection and try again.`);
    }
    await refresh();
  }

  /** Sends one pledge or withdrawal; resolves to where focus belongs after success, or false. */
  async function sendPledge(
    block: CaseBlock, kind: "put" | "delete", units: number, button: HTMLButtonElement, idle: string,
  ): Promise<HTMLElement | null | false> {
    const key = attemptKey(block, kind, units);
    const path = `/api/cycles/${encodeURIComponent(cycle.id)}/lines/${encodeURIComponent(block.line.product_id)}/pledge`;
    const before = block.line.my_units ?? 0;
    block.inFlight = true;
    setBusy(button, true, "Saving...", idle);
    try {
      const r = await api(kind === "put" ? "PUT" : "DELETE", path, kind === "put" ? { body: { units }, key } : { key });
      block.inFlight = false;
      setBusy(button, false, "Saving...", idle);
      if (r.status >= 500) {
        announce("Pledge updates", `Couldn't confirm your pledge on ${block.name}. Check your connection and try again.`);
        return false;
      }
      retries.delete(block.line.product_id);
      if (r.status !== 200) {
        await refusal(block, errorCode(r));
        return false;
      }
      const line: Line = r.body.line;
      const mine = line.my_units ?? 0;
      announce(
        "Pledge updates",
        kind === "delete"
          ? `Withdrew from ${block.name}. ${line.units_to_go} to go.`
          : line.units_to_go === 0
            ? `Pledged ${mine} of ${block.name}. Case sealed.`
            : `Pledged ${mine} of ${block.name}. ${line.units_to_go} to go.`,
      );
      const target = applyOwn(block, line, r.body.credit, mine < before);
      void refresh();
      return target;
    } catch (error) {
      block.inFlight = false;
      setBusy(button, false, "Saving...", idle);
      if (!(error instanceof NoResponse)) throw error;
      announce("Pledge updates", `Couldn't confirm your pledge on ${block.name}. Check your connection and try again.`);
      return false;
    }
  }

  const actions = {
    pledge(block: CaseBlock) {
      if (block.inFlight || isBusy(block.pledgeButton) || !block.live) return;
      const units = block.value;
      if (units === 0) {
        if ((block.line.my_units ?? 0) > 0) openWithdraw(block);
        return;
      }
      void sendPledge(block, "put", units, block.pledgeButton, "Pledge");
    },
    withdraw(block: CaseBlock) {
      if (!block.inFlight && block.live) openWithdraw(block);
    },
  };

  function openWithdraw(block: CaseBlock): void {
    const opener = block.withdrawButton.hidden ? block.spin : block.withdrawButton;
    let returnFocus: HTMLElement | null = opener;
    const confirm = h("button", { type: "button", class: "button primary" }, "Withdraw");
    const keep = h("button", { type: "button", class: "button quiet" }, "Keep pledge");
    const dialog: DialogHandle = openDialog({
      title: "Withdraw pledge",
      body: [h("p", {}, `Withdraw your ${block.line.my_units ?? 0} from ${block.name}?`),
        h("p", { class: "muted" }, "Your hold is released. You can pledge again until cutoff.")],
      actions: [confirm, keep],
      initialFocus: () => keep,
      onClosed: () => returnFocus?.focus(),
    });
    keep.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", async () => {
      if (isBusy(confirm)) return;
      const done = await sendPledge(block, "delete", 0, confirm, "Withdraw");
      returnFocus = done !== false ? done ?? block.spin : block.withdrawButton.hidden ? block.spin : block.withdrawButton;
      if (done !== false || !cycle.accepting_pledges) dialog.close();
    });
  }

  // ---- Top-up --------------------------------------------------------------------------------
  function openTopUp(): void {
    const errorEl = h("p", { class: "field-error", id: uid("err"), hidden: true });
    const messageEl = h("p", { class: "dialog-message", hidden: true });
    const amount = h("input", { class: "input", type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": "Amount in dollars", id: uid("amount") });
    const confirm = h("button", { type: "button", class: "button primary" }, "Confirm top-up");
    const cancel = h("button", { type: "button", class: "button quiet" }, "Cancel");
    let attempt: { key: string; text: string } | null = null;
    const dialog = openDialog({
      title: "Top up credit",
      body: [
        h("p", { class: "muted" }, "Type dollars as you'd write them, from $5.00 to $500.00. Your card on file with the club pays it."),
        h("div", { class: "field" }, h("label", { class: "label", for: amount.id }, "AMOUNT IN DOLLARS"), amount, errorEl),
        messageEl,
      ],
      actions: [confirm, cancel],
      initialFocus: () => amount,
      onClosed: () => topUpButton.focus(),
    });
    cancel.addEventListener("click", () => dialog.close());
    const submit = async () => {
      if (isBusy(confirm)) return;
      if (!attempt || attempt.text !== amount.value) attempt = { key: newKey(), text: amount.value };
      setBusy(confirm, true, "Confirming...", "Confirm top-up");
      messageEl.hidden = true;
      try {
        const r = await api("POST", "/api/topups", { body: { amount: attempt.text }, key: attempt.key });
        setBusy(confirm, false, "Confirming...", "Confirm top-up");
        if (r.status === 201) {
          responses += 1;
          drawCredit(r.body.credit);
          dialog.close();
          announce("Credit updates", `Top-up of ${money(r.body.topup.amount_cents)} confirmed. Spendable credit is now ${money(r.body.credit.spendable_cents)}.`);
          void refresh();
          return;
        }
        if (r.status === 503) {
          setFieldError(amount, errorEl, null);
          messageEl.textContent = PAUSED;
          messageEl.hidden = false;
          setNotice("payments", PAUSED);
          announce("Credit updates", "Top-up not taken. Your credit has not changed.");
          void checkPayments();
          return;
        }
        const text = errorCode(r) === "idempotency_key_reused"
          ? "This top-up was already sent with a different amount. Close and start again."
          : errorFields(r).amount ?? "Enter an amount from $5.00 to $500.00.";
        setFieldError(amount, errorEl, text);
        announce("Credit updates", text);
      } catch (error) {
        setBusy(confirm, false, "Confirming...", "Confirm top-up");
        if (!(error instanceof NoResponse)) throw error;
        const text = "Couldn't confirm your top-up. Check your connection and try again.";
        setFieldError(amount, errorEl, text);
        announce("Credit updates", text);
      }
    };
    confirm.addEventListener("click", () => void submit());
    amount.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    });
  }

  // ---- First draw ----------------------------------------------------------------------------
  for (const line of cycle.lines) {
    const block = new CaseBlock(line, actions);
    blocks.set(line.product_id, block);
    block.setControls(cycle.accepting_pledges);
    container(line).append(block.el);
  }
  drawHeader(cycle);
  drawCredit(cycle.credit);
  main.replaceChildren(h("div", { class: "member-cycle" }, header, creditRegion, cases));
  applyLayout();
  select(selected);
  watchLayout();

  const timer = window.setInterval(() => {
    void refresh();
    void checkPayments();
  }, REFRESH_MS);
  return () => {
    clearInterval(timer);
    cancelAnimationFrame(frame);
    for (const block of blocks.values()) block.destroy();
    setNotice("cutoff", null);
  };
}
