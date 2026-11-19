import { get, request } from "../api.js";
import { data, type Screen } from "../app.js";
import { copy } from "../copy.js";
import { clear, el } from "../dom.js";
import { euros, rotterdamTime } from "../format.js";
import type { Frame, Invoice, Lot, Notice, Offer } from "../types.js";

interface Dashboard {
  paddle: number | null;
  status: string;
  spending_limit: number | null;
  committed: number;
  leading: Lot[];
  watching: Lot[];
  won: Lot[];
  offers: Offer[];
  invoices: Invoice[];
  notices: Notice[];
}

const lotLink = (lot: Lot): HTMLElement =>
  el("a", {
    class: "panel-link",
    href: `/lots/${encodeURIComponent(lot.id)}`,
    text: `Lot ${lot.lot_number ?? 0}, ${lot.title}`,
  });

/** The bidder's saleroom: the limit panel and the six live panels. */
export const bidderScreen: Screen = (app) => {
  let board: Dashboard = {
    paddle: data<number | null>(app, "paddle", null),
    status: data<string>(app, "status", ""),
    spending_limit: data<number | null>(app, "spending_limit", null),
    committed: data<number>(app, "committed", 0),
    leading: data<Lot[]>(app, "leading", []),
    watching: data<Lot[]>(app, "watching", []),
    won: data<Lot[]>(app, "won", []),
    offers: data<Offer[]>(app, "offers", []),
    invoices: data<Invoice[]>(app, "invoices", []),
    notices: data<Notice[]>(app, "notices", []),
  };

  const heading = el("h1", { class: "desk-heading" });
  const limitPanel = el("section", { class: "panel", role: "region", "aria-label": "Spending limit" });
  const panels: Record<string, HTMLElement> = {};
  for (const name of ["Leading", "Watching", "Won", "Offers", "Invoices", "Notices"]) {
    panels[name] = el("section", { class: "panel", role: "region", "aria-label": name });
  }
  const offerNote = el("p", { class: "form-note" });

  clear(app.root);
  app.root.className = "page page-bidder";
  app.root.append(
    heading,
    limitPanel,
    el("div", { class: "panel-columns" }, [
      panels.Leading,
      panels.Watching,
      panels.Won,
      panels.Offers,
      panels.Invoices,
      panels.Notices,
    ]),
    offerNote,
  );

  const answer = async (offer: Offer, accept: boolean) => {
    const result = await request<{ invoice?: Invoice }>(
      "POST",
      `/api/bidder/offers/${encodeURIComponent(offer.id)}/${accept ? "accept" : "decline"}`,
    );
    if (result.status === 200) {
      offerNote.textContent = accept
        ? copy.offerAccepted(offer.lot_number, offer.amount, result.body.invoice?.number ?? "")
        : copy.offerDeclined(offer.lot_number);
    } else if (result.body.error === "offer_expired") {
      offerNote.textContent = copy.offerExpired;
    } else if (result.body.error === "offer_closed") {
      offerNote.textContent = copy.offerAnswered;
    } else {
      offerNote.textContent = result.body.message ?? copy.serverFailure;
    }
    app.say.result(offerNote.textContent);
    await refresh();
  };

  const paintPanel = (name: string, build: (panel: HTMLElement) => void) => {
    const panel = panels[name];
    clear(panel);
    panel.append(el("h2", { text: name }));
    build(panel);
  };

  const paint = () => {
    heading.textContent = board.paddle === null ? "YOUR SALEROOM" : `PADDLE ${board.paddle}`;
    clear(limitPanel);
    limitPanel.append(
      el("h2", { text: "Spending limit" }),
      el("p", {
        class: "amounts",
        text:
          board.status === "active" && board.spending_limit !== null
            ? copy.limitApproved(board.spending_limit, board.committed)
            : copy.limitPendingApproval,
      }),
    );
    for (const [name, lots] of [
      ["Leading", board.leading],
      ["Watching", board.watching],
      ["Won", board.won],
    ] as [string, Lot[]][]) {
      paintPanel(name, (panel) => {
        for (const lot of lots) panel.append(lotLink(lot));
      });
    }
    paintPanel("Offers", (panel) => {
      for (const offer of board.offers) {
        const accept = el("button", {
          type: "button",
          class: "action",
          text: "Accept",
          "aria-label": `Accept offer on lot ${offer.lot_number}`,
        });
        const decline = el("button", {
          type: "button",
          text: "Decline",
          "aria-label": `Decline offer on lot ${offer.lot_number}`,
        });
        accept.addEventListener("click", () => void answer(offer, true));
        decline.addEventListener("click", () => void answer(offer, false));
        panel.append(
          el("div", { class: "offer-row" }, [
            el("p", {
              class: "amounts",
              text: `Lot ${offer.lot_number} · ${euros(offer.amount)} · until ${rotterdamTime(offer.expires_at)}`,
            }),
            el("div", { class: "offer-actions" }, [accept, decline]),
          ]),
        );
      }
    });
    paintPanel("Invoices", (panel) => {
      for (const invoice of board.invoices) {
        panel.append(
          el("a", {
            class: "panel-link",
            href: `/bidder/invoices/${encodeURIComponent(invoice.id)}`,
            text: `Invoice ${invoice.number}`,
          }),
        );
      }
    });
    paintPanel("Notices", (panel) => {
      for (const notice of board.notices) {
        panel.append(el("p", { class: "notice-line", text: notice.text }));
      }
    });
  };

  let refreshing = 0;
  const refresh = async () => {
    const [dash, notices] = await Promise.all([
      get<Dashboard>("/api/bidder/dashboard"),
      get<{ notices: Notice[] }>("/api/notices"),
    ]);
    if (dash.status !== 200) return;
    board = { ...dash.body, notices: notices.body.notices ?? board.notices };
    paint();
  };

  const scheduleRefresh = () => {
    window.clearTimeout(refreshing);
    refreshing = window.setTimeout(() => void refresh(), 120);
  };

  paint();

  return (frame: Frame) => {
    if (frame.type === "notice") {
      app.say.notice(frame.notice.id, frame.notice.kind, frame.notice.text);
    }
    scheduleRefresh();
  };
};
