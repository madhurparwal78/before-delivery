// The channel operator's field view: gate cards and the dwell control.
import { api, errorOf, isNotSignedIn } from "./api.ts";
import type { CardRecord, WindowRecord, OrderRecord } from "./types.ts";
import { WINDOW_STATUS_LABEL } from "./types.ts";
import { h, clear, text, dec, statusRegion, group, gateGlyph } from "./html.ts";
import { currentUser, goSignIn, startPolling, topBar, route } from "./app.ts";

const root = () => document.getElementById("root")!;

// one page-level Gate dwell status
let dwellStatusEl: HTMLElement | null = null;

function announce(copy: string): void {
  if (dwellStatusEl) {
    clear(dwellStatusEl);
    dwellStatusEl.append(text(copy));
  }
}

const DWELL_MS = 1000;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

route("/field", async () => {
  const me = currentUser()!;
  const rootEl = root();
  clear(rootEl);
  dwellStatusEl = statusRegion("Gate dwell status", "gate-dwell-status");
  const cardWrap = h("div", { role: "list", "aria-label": "Gate cards", class: "card-grid g3" });
  rootEl.append(topBar("/field"));
  rootEl.append(h("div", { class: "page" }, h("h1", null, "Field view"), cardWrap, dwellStatusEl));

  let latestCards: CardRecord[] = [];
  let latestWindows: WindowRecord[] = [];
  let previousCardIds: Set<number> | null = null;
  const ordersJustStroked = new Set<string>();

  async function refresh(): Promise<void> {
    try {
      const [cards, windows] = await Promise.all([
        api<{ cards: CardRecord[] }>("GET", "/api/gate-cards"),
        api<{ windows: WindowRecord[] }>("GET", "/api/windows"),
      ]);
      const before = latestCards;
      latestCards = cards.cards;
      latestWindows = windows.windows;
      if (previousCardIds !== null) {
        // announce a handover: a card that moved to me appears; a card that
        // was mine and open has moved away when it leaves my list entirely.
        // A card I stroked stays mine (waiting or spent), so it never counts
        // as moved away.
        const nowIds = new Set(latestCards.map((c) => c.id));
        for (const c of latestCards) {
          if (c.state === "open" && !previousCardIds.has(c.id) && !ordersJustStroked.has(c.order_number)) {
            announce(`Gate card for ${c.turnout} is now yours.`);
          }
        }
        for (const c of before) {
          if (c.state === "open" && !nowIds.has(c.id)) {
            announce(`This gate card has moved to another operator.`);
          }
        }
      }
      previousCardIds = new Set(latestCards.map((c) => c.id));
      renderCards();
    } catch (e) {
      if (isNotSignedIn(e)) {
        await goSignIn("/field");
      }
    }
  }

  function windowStatusOf(windowId: string): string {
    const w = latestWindows.find((x) => x.id === windowId);
    return w ? WINDOW_STATUS_LABEL[w.status] : "Closed";
  }

  function renderCards(): void {
    clear(cardWrap);
    for (const card of latestCards) {
      const isMine = card.holder_code === me.operator_code;
      if (!isMine && card.state !== "spent") continue;
      cardWrap.append(gateCard(card));
    }
  }

  function gateCard(card: CardRecord): HTMLElement {
    const article = h("article", {
      class: "gate-card",
      "aria-label": `Gate card ${card.turnout}`,
      role: "listitem",
    });
    const wStatus = group(`Window status ${card.turnout}`, text(windowStatusOf(card.window_id)));
    const figures = h("div", { class: "figures" },
      group("Channel flow", h("span", { class: "flow-value num", "data-flow": "1" }, dec(channelFlowOf(card)))),
      group("Delivered", h("span", { class: "delivered-value num", "data-delivered": "1" }, dec(deliveredOf(card)))),
    );
    article.append(
      h("div", { class: "headline" },
        h("span", { class: "turnout-code" }, card.turnout),
        h("span", { class: "tag" }, card.kind === "start" ? "Start" : "Finish"),
      ),
      h("div", { class: "hint" }, `${card.holder_code} · order ${card.order_number}`),
      wStatus,
    );
    if (card.state === "waiting-for-store") {
      article.append(h("p", { class: "banner" }, "Waiting for the store"));
    } else if (card.state === "spent") {
      const rec = h("div", { role: "region", "aria-label": `Stroke record ${card.turnout}` },
        h("div", { class: "num" }, `${card.from_ml_day} → ${card.to_ml_day} ML/day`),
        card.stroke ? h("div", { class: "hint" }, `Stored ${card.stroke.confirmed_at ?? card.stroke.committed_at} · ${card.stroke.operator_code}`) : null,
      );
      article.append(rec);
    } else {
      article.append(dwellControl(card));
    }
    article.append(figures);
    return article;
  }

  function channelFlowOf(card: CardRecord): string {
    const w = latestWindows.find((x) => x.id === card.window_id);
    return w ? w.channel_flow_ml_day : "0.000";
  }
  function deliveredOf(card: CardRecord): string {
    const w = latestWindows.find((x) => x.id === card.window_id);
    return w ? w.delivered_ml : "0.000";
  }

  function dwellControl(card: CardRecord): HTMLElement {
    const btn = h("button", {
      class: "dwell",
      "aria-label": `Hold to stroke ${card.turnout}`,
      type: "button",
    }) as HTMLButtonElement;
    // the cobalt copy of the glyph, clipped from the bed up as the hold grows
    const glyphWrap = h("span", { class: "glyph-wrap" }, gateGlyph(46));
    const filledGlyph = gateGlyph(46, true);
    const filledWrap = h("span", { class: "glyph-fill", hidden: true }, filledGlyph);
    const sweep = h("div", { class: "sweep" });
    const label = h("span", { class: "label" }, "Hold to stroke");
    const progress = h("div", { class: "progress-num" }, "0");
    const bar = h("div", {
      role: "progressbar",
      "aria-label": `Dwell progress ${card.turnout}`,
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
    }) as HTMLElement;
    bar.append(progress);
    glyphWrap.append(filledWrap);
    btn.append(sweep, glyphWrap, label, bar);

    let raf = 0;
    let startAt = 0;
    let holding = false;
    let cancelled = false;

    function paintProgress(pct: number): void {
      progress.textContent = String(pct);
      bar.setAttribute("aria-valuenow", String(pct));
      // the sweep fills the glyph from the bed up; under reduced motion it
      // steps in quarters
      const stepPct = reducedMotion() ? Math.floor(pct / 25) * 25 : pct;
      sweep.style.height = `${stepPct}%`;
      if (stepPct > 0) {
        filledWrap.hidden = false;
        filledWrap.style.clipPath = `inset(${100 - stepPct}% 0 0 0)`;
      } else {
        filledWrap.hidden = true;
      }
    }

    function cancel(reason: "released" | "focus" | "hidden" | "handover" | "pointerleft"): void {
      if (!holding) return;
      holding = false;
      cancelled = true;
      cancelAnimationFrame(raf);
      paintProgress(0);
      sweep.style.height = "0%";
      if (reason === "released") announce("Released early. Stroke not sent.");
      else if (reason === "handover") announce("This gate card has moved to another operator.");
      else announce("Released early. Stroke not sent.");
    }

    function step(now: number): void {
      const held = now - startAt;
      const pct = Math.min(100, Math.floor((held / DWELL_MS) * 100));
      paintProgress(pct);
      if (held >= DWELL_MS) {
        holding = false;
        void commit();
        return;
      }
      raf = requestAnimationFrame(step);
    }

    async function commit(): Promise<void> {
      paintProgress(100);
      btn.setAttribute("aria-disabled", "true");
      announce("Stroke sent. Waiting for the store.");
      label.textContent = "Waiting for the store";
      ordersJustStroked.add(card.order_number);
      try {
        const r = await api<{ card: CardRecord; order?: OrderRecord; window?: WindowRecord }>(
          "POST", `/api/gate-cards/${card.id}/stroke`, {},
        );
        if (r.order && r.window) {
          const flow = r.window.channel_flow_ml_day;
          announce(`Stroke stored for ${card.turnout}. Flow now ${flow} ML/day.`);
          await refresh();
        } else {
          announce("The evidence store is not answering. The stroke will count once it is stored.");
          await refresh();
        }
      } catch (e) {
        const shape = errorOf(e);
        if (shape.code === "not_holder") announce("This gate card has moved to another operator.");
        else if (shape.code === "window_not_open") announce("This window is not open yet.");
        else announce("Something went wrong.");
        btn.removeAttribute("aria-disabled");
        label.textContent = "Hold to stroke";
        paintProgress(0);
        await refresh();
      }
    }

    btn.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      btn.setPointerCapture?.((ev as PointerEvent).pointerId);
      startHold();
    });
    btn.addEventListener("pointerup", () => cancel("released"));
    btn.addEventListener("pointercancel", () => cancel("released"));
    btn.addEventListener("pointerleave", () => cancel("released"));
    btn.addEventListener("pointermove", () => {
      // another element taking the pointer cancels via pointerleave/cancel
    });
    btn.addEventListener("contextmenu", (ev) => ev.preventDefault());
    btn.addEventListener("keydown", (ev) => {
      if (ev.key === " " && !ev.repeat) {
        ev.preventDefault();
        startHold();
      } else if (ev.key === " " && ev.repeat) {
        ev.preventDefault();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
      }
    });
    btn.addEventListener("keyup", (ev) => {
      if (ev.key === " ") {
        ev.preventDefault();
        cancel("released");
      }
    });
    btn.addEventListener("blur", () => cancel("focus"));
    btn.addEventListener("focus", () => {
      // fresh focus does nothing
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancel("hidden");
    });

    function startHold(): void {
      if (holding || btn.getAttribute("aria-disabled") === "true") return;
      holding = true;
      cancelled = false;
      startAt = performance.now();
      raf = requestAnimationFrame(step);
    }

    return btn;
  }

  await refresh();
  startPolling(refresh, 3000);
});

// announce handover for the operator whose card moved
export function announceHandover(turnout: string, mine: boolean): void {
  announce(mine ? `Gate card for ${turnout} is now yours.` : "This gate card has moved to another operator.");
}
