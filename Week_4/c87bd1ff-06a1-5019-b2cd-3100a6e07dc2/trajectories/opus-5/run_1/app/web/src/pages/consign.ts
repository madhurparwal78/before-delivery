import { get, request } from "../api.js";
import { data, type Screen } from "../app.js";
import { copy, stateLabels } from "../copy.js";
import { clear, el, field, setFieldError } from "../dom.js";
import { euros } from "../format.js";
import type { ConsignorLot, Frame, HistoryRow, Statement } from "../types.js";
import { emptyState } from "./simple.js";

const resultOf = (lot: ConsignorLot): string => {
  if (lot.hammer !== null) return euros(lot.hammer);
  if (lot.price !== null) return euros(lot.price);
  return "—";
};

/** The consignor's desk: Your lots, then the Statements panel. */
export const consignScreen: Screen = (app) => {
  let lots = data<ConsignorLot[]>(app, "lots", []);
  let statements = data<Statement[]>(app, "statements", []);

  const heading = el("h1", { class: "desk-heading", text: "YOUR CONSIGNMENTS" });
  const action = el("a", { class: "action", href: "/consign/new", text: "Offer a lot" });
  const tableHolder = el("div", { class: "table-holder" });
  const statementsPanel = el("section", {
    class: "panel",
    role: "region",
    "aria-label": "Statements",
  });

  clear(app.root);
  app.root.className = "page page-consign";
  app.root.append(heading, action, tableHolder, statementsPanel);

  const paint = () => {
    clear(tableHolder);
    if (lots.length === 0) {
      tableHolder.append(emptyState(copy.emptyDeskLine, copy.emptyDeskSentence));
    } else {
      const body = el("tbody");
      for (const lot of lots) {
        body.append(
          el("tr", {}, [
            el("td", { text: lot.lot_number === null ? "—" : String(lot.lot_number) }),
            el("td", {}, [
              el("a", {
                class: "panel-link",
                href: `/consign/lots/${encodeURIComponent(lot.id)}`,
                text: lot.title,
              }),
            ]),
            el("td", { text: stateLabels[lot.state] ?? lot.state }),
            el("td", { class: "amounts", text: resultOf(lot) }),
          ]),
        );
      }
      tableHolder.append(
        el("table", { class: "desk-table", "aria-label": "Your lots" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { scope: "col", text: "Lot" }),
              el("th", { scope: "col", text: "Title" }),
              el("th", { scope: "col", text: "State" }),
              el("th", { scope: "col", text: "Result" }),
            ]),
          ]),
          body,
        ]),
      );
    }
    const focusedHref = (document.activeElement as HTMLAnchorElement | null)?.href ?? "";
    clear(statementsPanel);
    statementsPanel.append(el("h2", { text: "Statements" }));
    for (const statement of statements) {
      const link = el("a", {
        class: "panel-link",
        href: `/consign/statements/${encodeURIComponent(statement.id)}`,
        text: `Statement ${statement.number}`,
      });
      statementsPanel.append(
        el("div", { class: "statement-row" }, [
          link,
          statement.status === "superseded" ? el("span", { text: "Superseded" }) : null,
        ]),
      );
      if (focusedHref && link.href === focusedHref) link.focus();
    }
  };

  let refreshing = 0;
  const refresh = async () => {
    const [desk, docs] = await Promise.all([
      get<{ lots: ConsignorLot[] }>("/api/consign/lots"),
      get<{ statements: Statement[] }>("/api/consign/statements"),
    ]);
    if (desk.status === 200) lots = desk.body.lots ?? lots;
    if (docs.status === 200) statements = docs.body.statements ?? statements;
    paint();
  };

  paint();

  return (frame: Frame) => {
    if (frame.type === "notice") {
      app.say.notice(frame.notice.id, frame.notice.kind, frame.notice.text);
    }
    window.clearTimeout(refreshing);
    refreshing = window.setTimeout(() => void refresh(), 120);
  };
};

/** The consignment form. */
export const consignNewScreen: Screen = (app) => {
  const radioWatch = el("input", { type: "radio", name: "category", value: "wristwatch" });
  const radioCamera = el("input", { type: "radio", name: "category", value: "camera" });
  const categoryGroup = el(
    "div",
    { class: "radiogroup", role: "radiogroup", "aria-label": "Category" },
    [
      el("label", { class: "radio" }, [radioWatch, el("span", { text: "Wristwatch" })]),
      el("label", { class: "radio" }, [radioCamera, el("span", { text: "Film camera" })]),
    ],
  );
  const categoryError = el("p", { class: "field-error", id: "category-error" });
  const titleInput = el("input", { type: "text" });
  const descriptionInput = el("textarea", { rows: "6" });
  const submit = el("button", { type: "submit", class: "action", text: "Submit for estimate" });
  const note = el("p", { class: "form-note" });

  const form = el("form", { class: "form" }, [
    el("h1", { text: "Offer a lot" }),
    categoryGroup,
    categoryError,
    field("Title", titleInput, "consign-title-error"),
    field("Description", descriptionInput, "consign-description-error"),
    submit,
    note,
  ]);
  clear(app.root);
  app.root.className = "page page-consign-new";
  app.root.append(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    categoryError.textContent = "";
    setFieldError(titleInput, "consign-title-error", "");
    setFieldError(descriptionInput, "consign-description-error", "");
    submit.disabled = true;
    note.textContent = copy.consignPending;
    const result = await request<{ landing: string }>("POST", "/api/consign/lots", {
      category: radioWatch.checked ? "wristwatch" : radioCamera.checked ? "camera" : "",
      title: titleInput.value,
      description: descriptionInput.value,
    });
    submit.disabled = false;
    if (result.status === 201 && result.body.landing) {
      window.location.assign(result.body.landing);
      return;
    }
    note.textContent = "";
    const fields = result.body.fields ?? {};
    if (fields.category) categoryError.textContent = fields.category;
    if (fields.title) setFieldError(titleInput, "consign-title-error", fields.title);
    if (fields.description) {
      setFieldError(descriptionInput, "consign-description-error", fields.description);
    }
    if (Object.keys(fields).length === 0) {
      note.textContent = result.body.message ?? copy.serverFailure;
    }
    app.say.result(note.textContent || Object.values(fields).join(" "));
  });
};

/** The consignor's view of one lot, with the second-chance choice. */
export const consignLotScreen: Screen = (app) => {
  const first = data<ConsignorLot | null>(app, "lot", null);
  if (!first) return;
  let current: ConsignorLot = first;
  let history = data<HistoryRow[]>(app, "history", []);

  const heading = el("h1", { class: "lot-title" });
  const priceLine = el("p", { class: "amounts" });
  const stateLine = el("p", {});
  const chancePanel = el("section", {
    class: "panel",
    role: "region",
    "aria-label": "Second chance",
  });
  const historyHolder = el("div", { class: "table-holder" });
  const note = el("p", { class: "form-note" });

  clear(app.root);
  app.root.className = "page page-consign-lot";
  app.root.append(heading, priceLine, stateLine, chancePanel, historyHolder, note);

  const paintHistory = () => {
    clear(historyHolder);
    const body = el("tbody");
    for (const row of history) {
      body.append(
        el("tr", {}, [
          el("td", { class: "amounts", text: euros(row.price_after) }),
          el("td", {
            class: "amounts",
            text: new Intl.DateTimeFormat("en-GB", {
              timeZone: "Europe/Amsterdam",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }).format(new Date(row.accepted_at)),
          }),
        ]),
      );
    }
    historyHolder.append(
      el("table", { class: "desk-table", "aria-label": "Bid history" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "Price" }),
            el("th", { scope: "col", text: "Time" }),
          ]),
        ]),
        body,
      ]),
    );
  };

  const paint = () => {
    heading.textContent = current.title;
    priceLine.textContent =
      current.price === null
        ? `${copy.openingBidLabel} ${euros(current.opening_bid ?? 0)} · ${current.bid_count} bids`
        : `${euros(current.price)} · ${current.bid_count} bids`;
    stateLine.textContent = stateLabels[current.state] ?? current.state;
    clear(chancePanel);
    if (!current.second_chance_open) {
      chancePanel.hidden = true;
      paintHistory();
      return;
    }
    chancePanel.hidden = false;
    const amountInput = el("input", { type: "text", class: "amounts", inputmode: "numeric" });
    const offerButton = el("button", {
      type: "button",
      class: "action",
      text: "Offer to the top bidder",
    });
    const leaveButton = el("button", { type: "button", text: "Leave unsold" });
    chancePanel.append(
      el("h2", { text: "Second chance" }),
      field("Offer amount", amountInput, "offer-amount-error"),
      el("div", { class: "panel-actions" }, [offerButton, leaveButton]),
    );
    offerButton.addEventListener("click", async () => {
      setFieldError(amountInput, "offer-amount-error", "");
      offerButton.disabled = true;
      const text = amountInput.value.trim();
      const result = await request<{ offer: { expires_at: string } }>(
        "POST",
        `/api/consign/lots/${encodeURIComponent(current.id)}/second-chance`,
        { amount: /^\d+$/.test(text) ? Number(text) : text },
      );
      offerButton.disabled = false;
      if (result.status === 201 && result.body.offer) {
        note.textContent = copy.secondChanceSent(result.body.offer.expires_at);
        app.say.result(note.textContent);
        await refresh();
        return;
      }
      const message = result.body.fields?.amount ?? result.body.message ?? copy.serverFailure;
      if (result.body.fields?.amount) {
        setFieldError(amountInput, "offer-amount-error", message);
      } else {
        note.textContent = message;
      }
      app.say.result(message);
    });
    leaveButton.addEventListener("click", async () => {
      leaveButton.disabled = true;
      const result = await request(
        "POST",
        `/api/consign/lots/${encodeURIComponent(current.id)}/leave-unsold`,
      );
      leaveButton.disabled = false;
      note.textContent =
        result.status === 200
          ? copy.leaveUnsold(current.lot_number ?? 0)
          : (result.body.message ?? copy.serverFailure);
      app.say.result(note.textContent);
      await refresh();
    });
    paintHistory();
  };

  const refresh = async () => {
    const result = await get<{ lot: ConsignorLot; history: HistoryRow[] }>(
      `/api/consign/lots/${encodeURIComponent(current.id)}`,
    );
    if (result.status !== 200) return;
    current = result.body.lot;
    history = result.body.history;
    paint();
  };

  paint();

  return (frame: Frame) => {
    if (frame.type === "notice") {
      app.say.notice(frame.notice.id, frame.notice.kind, frame.notice.text);
      return;
    }
    if (frame.lot.id !== current.id) return;
    current = frame.lot as unknown as ConsignorLot;
    history = frame.history;
    paint();
  };
};
