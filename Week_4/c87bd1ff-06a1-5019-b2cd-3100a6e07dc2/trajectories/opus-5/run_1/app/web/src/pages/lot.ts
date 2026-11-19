import { bid as sendBid, request } from "../api.js";
import { data, type Screen } from "../app.js";
import { copy } from "../copy.js";
import { clear, el, field, reducedMotion, setFieldError, trapFocus } from "../dom.js";
import { euros } from "../format.js";
import { fadeIn, HammerNumeral } from "../hammer.js";
import { groundOf, portrait } from "../portrait.js";
import { Countdown } from "../countdown.js";
import type { Frame, HistoryRow, Lot } from "../types.js";

interface Draft {
  type: "single" | "maximum";
  amount: string;
}

const draftKey = (lotID: string): string => `gavelhouse.draft.${lotID}`;

const readDraft = (lotID: string): Draft => {
  try {
    const raw = window.localStorage.getItem(draftKey(lotID));
    if (raw) {
      const parsed = JSON.parse(raw) as Draft;
      if (parsed.type === "single" || parsed.type === "maximum") return parsed;
    }
  } catch {
    /* a browser without storage simply keeps no draft */
  }
  return { type: "maximum", amount: "" };
};

const writeDraft = (lotID: string, draft: Draft): void => {
  try {
    window.localStorage.setItem(draftKey(lotID), JSON.stringify(draft));
  } catch {
    /* a browser without storage simply keeps no draft */
  }
};

const clearDraft = (lotID: string): void => {
  try {
    window.localStorage.removeItem(draftKey(lotID));
  } catch {
    /* a browser without storage simply keeps no draft */
  }
};

const newKey = (): string =>
  `bid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const clockTime = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));

/** The lot page: the pinned board over the portrait, details and history. */
export const lotScreen: Screen = (app) => {
  const first = data<Lot | null>(app, "lot", null);
  if (!first) return;
  let current: Lot = first;
  let history = data<HistoryRow[]>(app, "history", []);

  const isBidder = app.boot.viewer.roles.includes("bidder");
  const approved = isBidder && app.boot.viewer.status === "active";
  let draft = readDraft(current.id);
  let formMessage = "";
  let fieldMessage = "";
  let pendingKey = "";
  let sending = false;
  let reserveWasMet = current.reserve_met;
  const lotNumber = current.lot_number ?? 0;

  const priceHost = el("span", { class: "hn" });
  const numeral = new HammerNumeral(priceHost);
  const priceLabel = el("p", { class: "board-label" });
  const nextBidLine = el("p", { class: "board-next amounts" });
  const reserveLine = el("p", { class: "board-reserve" });
  const leaderLine = el("p", { class: "board-leader" });
  const timerLine = el("p", {
    class: "board-timer amounts",
    role: "timer",
    "aria-label": "Time left",
  });
  const countdown = new Countdown(timerLine, (seconds, status) => {
    if (status === "closed_sold") return copy.soldFor(current.price ?? 0);
    if (status === "closed_unsold") return copy.closedUnsold;
    return seconds <= 0 ? copy.closing : copy.closesIn(seconds);
  });

  const watchButton = el("button", {
    type: "button",
    class: "watch",
    "aria-label": "Watch lot",
    "aria-pressed": "false",
  });

  const radioNow = el("input", { type: "radio", name: "bid-type", value: "single" });
  const radioMax = el("input", { type: "radio", name: "bid-type", value: "maximum" });
  const radiogroup = el(
    "div",
    { class: "radiogroup", role: "radiogroup", "aria-label": "Bid type" },
    [
      el("label", { class: "radio" }, [radioNow, el("span", { text: "Bid now" })]),
      el("label", { class: "radio" }, [radioMax, el("span", { text: "Maximum bid" })]),
    ],
  );
  const maxInput = el("input", {
    type: "text",
    class: "amounts",
    inputmode: "numeric",
    autocomplete: "off",
  });
  const placeButton = el("button", { type: "button", class: "action", text: "Place bid" });
  const formNote = el("p", { class: "form-note" });
  const bidForm = el("div", { class: "bid-form" }, [
    radiogroup,
    field("Your maximum", maxInput, "your-maximum-error"),
    placeButton,
    formNote,
  ]);

  // The price is laid over the lot's portrait, with a darkened band behind it
  // that keeps it readable on every one of the six grounds.
  const headline = el("div", { class: "board-headline" }, [
    el("div", { class: "board-art", style: `background:${groundOf(current.portrait)}` }, [
      portrait(current.portrait, null, "portrait"),
    ]),
    priceLabel,
    el("p", { class: "board-price" }, [priceHost]),
  ]);

  const board = el(
    "section",
    { class: "lot-board", role: "region", "aria-label": "Lot board" },
    [
      headline,
      nextBidLine,
      reserveLine,
      leaderLine,
      timerLine,
      watchButton,
      bidForm,
    ],
  );

  const historyBody = el("tbody");
  const historyTable = el("table", { class: "history" }, [
    el("caption", { text: "Bid history" }),
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col", text: "Paddle" }),
        el("th", { scope: "col", text: "Price" }),
        el("th", { scope: "col", text: "Time" }),
      ]),
    ]),
    historyBody,
  ]);

  const portraitHolder = el("div", { class: "lot-portrait" });
  const estimateLine = el("p", { class: "amounts" });
  const conditionLine = el("p", {});
  const descriptionLine = el("p", {});

  clear(app.root);
  app.root.className = "page page-lot";
  app.root.append(
    el("div", { class: "lot-poster" }, [
      el("h1", { class: "lot-title", text: current.title }),
      board,
    ]),
    el("div", { class: "lot-detail" }, [
      portraitHolder,
      el("h2", { text: "Estimate" }),
      estimateLine,
      el("h2", { text: "Condition" }),
      conditionLine,
      el("h2", { text: "Description" }),
      descriptionLine,
      historyTable,
    ]),
  );

  clear(portraitHolder);
  portraitHolder.append(
    portrait(current.portrait, `Lot ${lotNumber}, ${current.title}`, "portrait"),
  );

  const paintHistory = () => {
    clear(historyBody);
    for (const row of history) {
      historyBody.append(
        el("tr", {}, [
          el("td", { text: row.paddle === undefined ? "—" : String(row.paddle) }),
          el("td", { class: "amounts", text: euros(row.price_after) }),
          el("td", { class: "amounts", text: clockTime(row.accepted_at) }),
        ]),
      );
    }
  };

  const syncForm = () => {
    const open = current.status === "open" || current.status === "extended";
    radioNow.checked = draft.type === "single";
    radioMax.checked = draft.type === "maximum";
    if (draft.type === "single") {
      maxInput.readOnly = true;
      maxInput.value = String(current.asking);
    } else {
      maxInput.readOnly = false;
      maxInput.value = draft.amount;
    }
    const waiting = !app.live.isOpen();
    placeButton.disabled = sending || waiting || !open || !approved;
    watchButton.disabled = !isBidder;
    if (formMessage) formNote.textContent = formMessage;
    else if (!open) formNote.textContent = copy.bidClosed(lotNumber);
    else if (isBidder && !approved) formNote.textContent = copy.limitPending;
    else if (waiting) formNote.textContent = copy.connecting;
    else formNote.textContent = "";
    setFieldError(maxInput, "your-maximum-error", fieldMessage);
  };

  const paintBoard = () => {
    const open = current.status === "open" || current.status === "extended";
    priceLabel.textContent = current.bid_count === 0 ? copy.openingBidLabel : "Current bid";
    numeral.set(current.price ?? current.opening_bid ?? 0);
    nextBidLine.textContent = open ? copy.nextBid(current.asking) : "";
    if (current.reserve_met) {
      if (reserveLine.textContent !== copy.reserveMet) {
        reserveLine.textContent = copy.reserveMet;
        if (!reserveWasMet) fadeIn(reserveLine);
      }
    } else {
      reserveLine.textContent = "";
    }
    reserveWasMet = current.reserve_met;
    if (current.bid_count === 0) leaderLine.textContent = copy.noBids;
    else if (current.i_lead) leaderLine.textContent = copy.youLead;
    else leaderLine.textContent = copy.paddleLeads(current.leader_paddle ?? 0);
    countdown.set(current.remaining_seconds, current.status);
    watchButton.setAttribute("aria-pressed", current.watching ? "true" : "false");
    watchButton.textContent = current.watching ? "Watching" : "Watch lot";
    estimateLine.textContent =
      current.estimate_low === null || current.estimate_high === null
        ? ""
        : `${euros(current.estimate_low)}–${euros(current.estimate_high)}`;
    conditionLine.textContent = current.condition;
    descriptionLine.textContent = current.description;
    syncForm();
  };

  for (const radio of [radioNow, radioMax]) {
    radio.addEventListener("change", () => {
      draft = { type: radio.value as Draft["type"], amount: draft.amount };
      writeDraft(current.id, draft);
      syncForm();
    });
  }
  maxInput.addEventListener("input", () => {
    if (maxInput.readOnly) return;
    draft = { type: "maximum", amount: maxInput.value };
    writeDraft(current.id, draft);
  });
  maxInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openConfirm();
    }
  });
  placeButton.addEventListener("click", () => openConfirm());

  watchButton.addEventListener("click", async () => {
    const wanted = !current.watching;
    current = { ...current, watching: wanted };
    paintBoard();
    const result = await request<{ watching: boolean }>(
      wanted ? "PUT" : "DELETE",
      `/api/lots/${encodeURIComponent(current.id)}/watch`,
    );
    if (result.status === 200) {
      app.say.result(wanted ? copy.watchingOn(lotNumber) : copy.watchingOff(lotNumber));
    }
  });

  const openConfirm = () => {
    if (placeButton.disabled) return;
    const typed = draft.type === "single" ? current.asking : Number(maxInput.value.trim());
    const sentence =
      draft.type === "single"
        ? copy.confirmSingle(current.asking, lotNumber)
        : copy.confirmMaximum(Number.isFinite(typed) ? typed : 0, lotNumber);
    const confirmButton = el("button", { type: "button", class: "action", text: "Confirm bid" });
    const cancelButton = el("button", { type: "button", text: "Cancel" });
    const dialog = el(
      "div",
      { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Confirm your bid" },
      [
        el("p", { class: "dialog-text", text: sentence }),
        el("div", { class: "dialog-actions" }, [confirmButton, cancelButton]),
      ],
    );
    const shade = el("div", { class: "shade" }, [dialog]);
    const close = () => {
      shade.remove();
      placeButton.focus();
    };
    trapFocus(dialog, [confirmButton, cancelButton], close);
    cancelButton.addEventListener("click", close);
    confirmButton.addEventListener("click", () => {
      close();
      void place();
    });
    document.body.append(shade);
    if (!reducedMotion()) {
      const fade = shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      fade.finished.then(() => fade.cancel()).catch(() => undefined);
    }
    confirmButton.focus();
  };

  const place = async () => {
    const amountText = draft.type === "single" ? String(current.asking) : maxInput.value.trim();
    if (draft.type === "maximum" && !/^\d+$/.test(amountText)) {
      fieldMessage = "Enter a whole number of euros.";
      formMessage = "";
      syncForm();
      app.say.result(fieldMessage);
      return;
    }
    sending = true;
    fieldMessage = "";
    formMessage = copy.bidPending;
    syncForm();
    if (!pendingKey) pendingKey = newKey();
    let result;
    try {
      result = await sendBid<{ lot: Lot }>(current.id, pendingKey, {
        type: draft.type,
        max_amount: Number(amountText),
      });
    } catch {
      sending = false;
      formMessage = copy.noResponse;
      syncForm();
      app.say.result(formMessage);
      return;
    }
    sending = false;
    const body = result.body;
    if (result.status === 201 && body.lot) {
      pendingKey = "";
      clearDraft(current.id);
      draft = { type: draft.type, amount: "" };
      current = body.lot;
      formMessage = current.i_lead
        ? copy.bidAcceptedLead(current.price ?? 0)
        : copy.bidAcceptedOutbid(lotNumber, current.price ?? 0);
      paintBoard();
      app.say.result(formMessage);
      void refreshHistory();
      return;
    }
    pendingKey = "";
    if (result.status === 422 && body.fields?.max_amount) {
      fieldMessage = body.fields.max_amount;
      formMessage = "";
      syncForm();
      app.say.result(fieldMessage);
      return;
    }
    if (body.error === "lot_closed") {
      if (body.lot) current = body.lot as Lot;
      formMessage = copy.bidClosed(lotNumber);
      paintBoard();
    } else if (body.error === "asking_changed") {
      if (body.lot) current = body.lot as Lot;
      formMessage = copy.askingMoved(current.asking);
      paintBoard();
    } else if (body.error === "registration_pending") {
      formMessage = copy.limitPending;
      syncForm();
    } else {
      formMessage = copy.serverFailure;
      syncForm();
    }
    fieldMessage = "";
    app.say.result(formMessage);
  };

  const refreshHistory = async () => {
    const result = await request<{ history: HistoryRow[] }>(
      "GET",
      `/api/lots/${encodeURIComponent(current.id)}`,
    );
    if (result.status === 200 && result.body.history) {
      history = result.body.history;
      paintHistory();
    }
  };

  app.live.onReadyChange(() => syncForm());
  paintHistory();
  paintBoard();

  return (frame: Frame) => {
    if (frame.type === "notice") {
      app.say.notice(frame.notice.id, frame.notice.kind, frame.notice.text);
      return;
    }
    if (frame.lot.id !== current.id) return;
    const previousPrice = current.price;
    const previousStatus = current.status;
    const wasMet = current.reserve_met;
    const next = frame.lot as unknown as Lot;
    current = { ...next, watching: next.watching ?? current.watching };
    history = frame.history;
    paintHistory();
    paintBoard();
    if (current.price !== null && current.price !== previousPrice) {
      app.say.priceChanged(
        current.i_lead
          ? copy.announcePriceLead(lotNumber, current.price)
          : copy.announcePrice(lotNumber, current.price),
      );
    }
    if (current.reserve_met && !wasMet) app.say.reserveMet(copy.announceReserve(lotNumber));
    const closedNow = current.status === "closed_sold" || current.status === "closed_unsold";
    const wasOpen = previousStatus === "open" || previousStatus === "extended";
    if (closedNow && wasOpen) {
      app.say.lotClosed(
        current.status === "closed_sold"
          ? copy.announceSold(lotNumber, current.price ?? 0)
          : copy.announceUnsold(lotNumber),
      );
    }
    if (frame.cause === "extension") countdown.countUpTo(current.remaining_seconds);
  };
};
