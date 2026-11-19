import { get, request } from "../api.js";
import { data, type Screen } from "../app.js";
import { copy } from "../copy.js";
import { clear, el, field, setFieldError, trapFocus } from "../dom.js";
import { euros } from "../format.js";
import type { ConsignorLot, Frame, HistoryRow, Registration, Statement } from "../types.js";

const clockTime = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));

/** The admin's desk: registrations, bid removal and statements. */
export const adminScreen: Screen = (app) => {
  let registrations = data<Registration[]>(app, "registrations", []);
  let lots = data<ConsignorLot[]>(app, "lots", []);
  let statements = data<Statement[]>(app, "statements", []);
  let chosenLot = lots.length > 0 ? lots[0].id : "";
  let bids: HistoryRow[] = [];

  const registrationsHolder = el("div", { class: "table-holder" });
  const removalPanel = el("section", {
    class: "panel",
    role: "region",
    "aria-label": "Bid removal",
  });
  const statementsPanel = el("section", {
    class: "panel",
    role: "region",
    "aria-label": "Statements",
  });
  const note = el("p", { class: "form-note" });

  clear(app.root);
  app.root.className = "page page-admin";
  app.root.append(
    el("h1", { class: "desk-heading", text: "ADMIN DESK" }),
    el("div", { class: "admin-grid" }, [
      el("div", { class: "admin-left" }, [registrationsHolder, statementsPanel, note]),
      removalPanel,
    ]),
  );

  const paintRegistrations = () => {
    clear(registrationsHolder);
    const body = el("tbody");
    for (const registration of registrations) {
      const limitInput = el("input", {
        type: "text",
        class: "amounts",
        inputmode: "numeric",
        "aria-label": `Spending limit for ${registration.full_name}`,
      });
      const approve = el("button", {
        type: "button",
        class: "desk-action",
        "aria-label": `Approve ${registration.full_name}`,
        text: "Approve",
      });
      const error = el("p", { class: "field-error" });
      approve.addEventListener("click", async () => {
        error.textContent = "";
        approve.disabled = true;
        const typed = limitInput.value.trim();
        const result = await request<{
          registration: { paddle: number; spending_limit: number };
        }>("POST", `/api/admin/registrations/${encodeURIComponent(registration.id)}/approve`, {
          spending_limit: /^\d+$/.test(typed) ? Number(typed) : typed,
        });
        approve.disabled = false;
        if (result.status === 200 && result.body.registration) {
          note.textContent = copy.approved(
            result.body.registration.paddle,
            result.body.registration.spending_limit,
          );
          app.say.result(note.textContent);
          await refresh();
          return;
        }
        const message =
          result.body.fields?.spending_limit ?? result.body.message ?? copy.serverFailure;
        error.textContent = message;
        setFieldError(limitInput, "", "");
        limitInput.setAttribute("aria-invalid", "true");
        app.say.result(message);
      });
      body.append(
        el("tr", {}, [
          el("td", { text: registration.full_name }),
          el("td", { text: registration.phone }),
          el("td", { text: registration.address }),
          el("td", {}, [limitInput, error]),
          el("td", {}, [approve]),
        ]),
      );
    }
    registrationsHolder.append(
      el("table", { class: "desk-table", "aria-label": "Pending registrations" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "Name" }),
            el("th", { scope: "col", text: "Phone" }),
            el("th", { scope: "col", text: "Address" }),
            el("th", { scope: "col", text: "Spending limit" }),
            el("th", { scope: "col", text: "Approve" }),
          ]),
        ]),
        body,
      ]),
    );
  };

  const openRemovalDialog = (bid: HistoryRow, trigger: HTMLElement) => {
    const reasonInput = el("input", { type: "text" });
    const removeButton = el("button", { type: "button", class: "action", text: "Remove bid" });
    const cancelButton = el("button", { type: "button", text: "Cancel" });
    const dialog = el(
      "div",
      { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Remove this bid?" },
      [
        field("Reason", reasonInput, "removal-reason-error"),
        el("div", { class: "dialog-actions" }, [removeButton, cancelButton]),
      ],
    );
    const shade = el("div", { class: "shade" }, [dialog]);
    const close = () => {
      shade.remove();
      trigger.focus();
    };
    trapFocus(dialog, [reasonInput, removeButton, cancelButton], close);
    cancelButton.addEventListener("click", close);
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      const result = await request<{ lot: ConsignorLot; bids: HistoryRow[] }>(
        "POST",
        `/api/admin/bids/${encodeURIComponent(bid.bid_id ?? "")}/remove`,
        { reason: reasonInput.value },
      );
      removeButton.disabled = false;
      if (result.status === 200 && result.body.lot) {
        const lot = result.body.lot;
        note.textContent =
          lot.price === null
            ? copy.bidRemovedEmpty(lot.lot_number ?? 0)
            : copy.bidRemoved(lot.lot_number ?? 0, lot.price);
        app.say.result(note.textContent);
        bids = result.body.bids ?? [];
        close();
        paintRemoval();
        return;
      }
      const message = result.body.fields?.reason ?? result.body.message ?? copy.serverFailure;
      setFieldError(reasonInput, "removal-reason-error", message);
      app.say.result(message);
    });
    document.body.append(shade);
    reasonInput.focus();
  };

  const paintRemoval = () => {
    clear(removalPanel);
    const select = el("select", { "aria-label": "Lot" });
    for (const lot of lots) {
      select.append(
        el("option", { value: lot.id, text: `Lot ${lot.lot_number ?? 0}, ${lot.title}` }),
      );
    }
    select.value = chosenLot;
    select.addEventListener("change", () => {
      chosenLot = select.value;
      void loadBids();
    });
    const body = el("tbody");
    for (const bid of bids) {
      const remove = el("button", { type: "button", text: "Remove bid" });
      remove.addEventListener("click", () => openRemovalDialog(bid, remove));
      body.append(
        el("tr", {}, [
          el("td", { text: String(bid.paddle ?? "") }),
          el("td", { text: bid.bidder_name ?? "" }),
          el("td", { class: "amounts", text: euros(bid.max_amount ?? 0) }),
          el("td", { class: "amounts", text: euros(bid.price_after) }),
          el("td", { class: "amounts", text: clockTime(bid.accepted_at) }),
          el("td", {}, [remove]),
        ]),
      );
    }
    removalPanel.append(
      el("h2", { text: "Bid removal" }),
      el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Lot" }),
        select,
      ]),
      el("table", { class: "desk-table", "aria-label": "Bids" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "Paddle" }),
            el("th", { scope: "col", text: "Bidder" }),
            el("th", { scope: "col", text: "Maximum" }),
            el("th", { scope: "col", text: "Price after" }),
            el("th", { scope: "col", text: "Time" }),
            el("th", { scope: "col", text: "Remove" }),
          ]),
        ]),
        body,
      ]),
    );
  };

  const paintStatements = () => {
    clear(statementsPanel);
    statementsPanel.append(el("h2", { text: "Statements" }));
    for (const statement of statements) {
      const row = el("div", { class: "statement-row" }, [
        el("span", { text: `Statement ${statement.number} · ${statement.status}` }),
      ]);
      if (statement.status === "draft") {
        const issue = el("button", {
          type: "button",
          "aria-label": `Issue ${statement.number}`,
          text: "Issue",
        });
        issue.addEventListener("click", async () => {
          issue.disabled = true;
          const result = await request("POST",
            `/api/admin/statements/${encodeURIComponent(statement.id)}/issue`);
          issue.disabled = false;
          note.textContent =
            result.status === 200
              ? copy.statementIssued(statement.number)
              : (result.body.message ?? copy.serverFailure);
          app.say.result(note.textContent);
          await refresh();
        });
        row.append(issue);
      }
      if (statement.status === "issued") {
        const correct = el("button", {
          type: "button",
          "aria-label": `Correct ${statement.number}`,
          text: "Correct",
        });
        correct.addEventListener("click", async () => {
          correct.disabled = true;
          const result = await request<{ statement: Statement }>(
            "POST",
            `/api/admin/statements/${encodeURIComponent(statement.id)}/correct`,
            { reason: "Corrected after the sale", note: "Corrected after the sale" },
          );
          correct.disabled = false;
          note.textContent =
            result.status === 201 && result.body.statement
              ? copy.statementCorrected(result.body.statement.number, statement.number)
              : (result.body.message ?? copy.serverFailure);
          app.say.result(note.textContent);
          await refresh();
        });
        row.append(correct);
      }
      statementsPanel.append(row);
    }
  };

  const loadBids = async () => {
    if (!chosenLot) {
      bids = [];
      paintRemoval();
      return;
    }
    const result = await get<{ bids: HistoryRow[] }>(
      `/api/admin/lots/${encodeURIComponent(chosenLot)}/bids`,
    );
    bids = result.status === 200 ? (result.body.bids ?? []) : [];
    paintRemoval();
  };

  const refresh = async () => {
    const [pending, openLots, docs] = await Promise.all([
      get<{ registrations: Registration[] }>("/api/admin/registrations?status=pending"),
      get<{ lots: ConsignorLot[] }>("/api/admin/lots"),
      get<{ statements: Statement[] }>("/api/admin/statements"),
    ]);
    if (pending.status === 200) registrations = pending.body.registrations ?? [];
    if (openLots.status === 200) lots = openLots.body.lots ?? [];
    if (docs.status === 200) statements = docs.body.statements ?? [];
    if (!lots.some((lot) => lot.id === chosenLot)) chosenLot = lots.length > 0 ? lots[0].id : "";
    paintRegistrations();
    paintStatements();
    await loadBids();
  };

  paintRegistrations();
  paintRemoval();
  paintStatements();
  void loadBids();

  let refreshing = 0;
  return (_frame: Frame) => {
    window.clearTimeout(refreshing);
    refreshing = window.setTimeout(() => void refresh(), 150);
  };
};
