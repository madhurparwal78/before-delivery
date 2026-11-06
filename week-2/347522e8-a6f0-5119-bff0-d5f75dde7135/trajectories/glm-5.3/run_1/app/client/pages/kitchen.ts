// My kitchen: hour packs, ledger, documents and statements. Purchase
// availability is re-checked every 15 seconds and on focus (DP-52).

import { ApiFailure, apiJson, postJson, postJsonWithKey } from "../lib/api.js";
import { announce, clear, el } from "../lib/dom.js";
import { hours } from "../lib/clock.js";
import { screenFrame, type AppCtx } from "../lib/shell.js";

type Pack = { id: string; name: string; hours: number; amount_usd: string };
type PacksData = { packs: Pack[]; purchases_available: boolean };

type LedgerEntry = {
  id: string;
  movement_id: string;
  kind: string;
  direction: "debit" | "credit";
  minutes: number;
  note: string | null;
  created_at: string;
};
type LedgerData = { balance_minutes: number; held_minutes: number; entries: LedgerEntry[] };
type Document = {
  id: string;
  kind: string;
  expires_on: string | null;
  status: string;
  created_at: string;
};
type Statement = { id: string; month: string; created_at: string };

const KIND_LABELS: Record<string, string> = {
  coi: "certificate of insurance",
  food_handler_card: "food-handler card",
  business_licence: "business licence",
};

const documentWord = (document: Document, today: string): string => {
  if (document.status === "pending_review") return "Waiting for review";
  if (document.status === "rejected") return "Rejected";
  if (document.status === "approved" && document.expires_on !== null && document.expires_on < today) {
    return "Expired";
  }
  return "Approved";
};

export const renderKitchen = async (mount: HTMLElement, ctx: AppCtx): Promise<void> => {
  const renterId = ctx.user.renter_id!;
  const body = el("div", { class: "kitchen-body" });
  const frame = screenFrame(ctx.user, ctx.navigate, body, "My kitchen");

  const purchaseStatus = el("div", {
    role: "status",
    id: "purchase-status",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Purchase status",
  });
  const uploadStatus = el("div", {
    role: "status",
    id: "upload-status",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Upload status",
  });
  const statementStatus = el("div", {
    role: "status",
    id: "statement-status",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Statement status",
  });
  const balanceLine = el("div", {
    role: "status",
    id: "hour-balance",
    class: "status-live balance mono",
    "aria-label": "Hour balance",
  });

  const outage = el("p", { class: "outage" });

  // ---- hour packs ----
  const packButtons: Record<string, HTMLButtonElement> = {};
  const packsRegion = el("section", { class: "panel packs", "aria-label": "Hour packs" });
  const balanceWrap = el("div", { class: "balance-wrap" }, balanceLine);
  packsRegion.append(el("h2", {}, "Hour packs"), outage, balanceWrap);
  let purchasesAvailable = true;

  const setAvailability = (available: boolean): void => {
    const changed = available !== purchasesAvailable;
    purchasesAvailable = available;
    for (const button of Object.values(packButtons)) button.disabled = !available;
    outage.textContent = available ? "" : "Pack purchases are unavailable right now. You can still book with the hours you already own.";
    if (changed && available) announce(purchaseStatus, "Pack purchases are available again.");
    if (!available) {
      announce(purchaseStatus, "Pack purchases are unavailable right now. You can still book with the hours you already own.");
    }
  };

  const loadPacks = async (): Promise<void> => {
    const data = await apiJson<PacksData>("/api/packs");
    clear(packsRegion);
    packsRegion.append(el("h2", {}, "Hour packs"), outage, balanceWrap);
    for (const pack of data.packs) {
      const button = el("button", { type: "button" }, `Buy ${pack.name}`);
      packButtons[pack.id] = button;
      button.addEventListener("click", async () => {
        button.disabled = true;
        announce(purchaseStatus, "Processing purchase…");
        // A random key per click: repeating a purchase with the same key must
        // return the original response, so a new click always buys again.
        const key = `buy-${pack.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        try {
          const result = await postJsonWithKey<{ balance_minutes: number }>(
            "/api/purchases",
            { pack_id: pack.id },
            key,
          );
          announce(
            purchaseStatus,
            `Paid. ${hours(pack.hours * 60)} hours added to your balance. Your receipt is on its way.`,
          );
          await Promise.all([loadLedger(), loadBalance()]);
          announce(balanceLine, `${hours(result.balance_minutes)} h`);
          button.disabled = false;
        } catch (err) {
          if (err instanceof ApiFailure && err.code === "billing_unavailable") {
            announce(
              purchaseStatus,
              "Pack purchases are unavailable right now. You can still book with the hours you already own.",
            );

            setAvailability(false);
          } else if (err instanceof ApiFailure && err.code === "payment_failed") {
            announce(purchaseStatus, "The payment didn't go through. No hours were added.");
            button.disabled = false;
          } else {
            announce(purchaseStatus, "Something went wrong. Try again.");
            button.disabled = false;
          }
        }
      });
      const packLine = el("div", { class: "pack-line" }, el("span", {}, `${pack.name} · ${hours(pack.hours * 60)} hours`), el("span", { class: "mono" }, `$${pack.amount_usd}`), button);
      packsRegion.append(packLine);
    }
    setAvailability(data.purchases_available);
    packsRegion.append(purchaseStatus);
  };

  const loadBalance = async (): Promise<void> => {
    const ledger = await apiJson<LedgerData>(`/api/renters/${renterId}/ledger`);
    balanceLine.textContent = `${hours(ledger.balance_minutes)} h`;
  };

  // ---- ledger ----
  const ledgerTable = el("table", { class: "ledger", "aria-label": "Hour ledger" });
  const ledgerRegion = el("section", { class: "panel ledger-panel" }, el("h2", {}, "Hour ledger"), ledgerTable);

  const loadLedger = async (): Promise<void> => {
    const ledger = await apiJson<LedgerData>(`/api/renters/${renterId}/ledger`);
    clear(ledgerTable);
    const head = el("thead", {}, el("tr", {}, el("th", {}, "When"), el("th", {}, "Movement"), el("th", {}, "Hours"), el("th", {}, "Balance")));
    ledgerTable.append(head);
    const tbody = el("tbody");
    if (ledger.entries.length === 0) {
      tbody.append(el("tr", { class: "empty-row" }, el("td", { colspan: "4" }, "No hour movements yet.")));
    }
    let running = 0;
    for (const entry of ledger.entries) {
      const signed = entry.direction === "credit" ? entry.minutes : -entry.minutes;
      running += signed;
      const when = `${entry.created_at.slice(0, 10)} ${entry.created_at.slice(11, 16)} UTC`;
      tbody.append(
        el(
          "tr",
          {},
          el("td", { class: "mono" }, when),
          el("td", {}, entry.kind === "opening_balance" ? "Opening balance" : entry.kind === "pack_purchase" ? "Pack purchase" : entry.kind === "booking_hold" ? "Booking hold" : entry.kind === "hold_release" ? "Hold released" : entry.kind === "cancellation_credit" ? "Cancellation credit" : entry.kind === "displacement_credit" ? "Displacement credit" : entry.kind === "adjustment" ? "Adjustment" : entry.kind),
          el("td", { class: "mono" }, `${signed < 0 ? "−" : "+"}${hours(Math.abs(signed))}`),
          el("td", { class: "mono" }, hours(running)),
        ),
      );
    }
    ledgerTable.append(tbody);
  };

  // ---- documents ----
  const kindSelect = el("select", { id: "document-type", "aria-label": "Document type" },
    el("option", { value: "coi" }, "certificate of insurance"),
    el("option", { value: "food_handler_card" }, "food-handler card"),
    el("option", { value: "business_licence" }, "business licence"),
  );
  const expiryInput = el("input", { type: "text", id: "document-expiry", "aria-label": "Expiry date", placeholder: "YYYY-MM-DD" });
  const fileInput = el("input", { type: "file", id: "document-file" });
  fileInput.setAttribute("aria-label", "Scan file");
  const uploadButton = el("button", { type: "button" }, "Upload document");
  const documentRows = el("div", { class: "document-rows" });
  const documentsRegion = el(
    "section",
    { class: "panel documents", "aria-label": "Documents" },
    el("h2", {}, "Documents"),
    documentRows,
    el("div", { class: "upload-form" }, kindSelect, expiryInput, fileInput, uploadButton),
    uploadStatus,
  );

  const latestByKind = (documents: Document[]): Document[] => {
    const map = new Map<string, Document>();
    for (const document of documents) {
      const existing = map.get(document.kind);
      if (!existing || existing.created_at <= document.created_at) map.set(document.kind, document);
    }
    return Array.from(map.values());
  };

  const loadDocuments = async (): Promise<void> => {
    const data = await apiJson<{ documents: Document[] }>(`/api/renters/${renterId}/documents`);
    clear(documentRows);
    for (const document of latestByKind(data.documents)) {
      const label = KIND_LABELS[document.kind] ?? document.kind;
      documentRows.append(
        el(
          "div",
          { class: "document-row" },
          el("span", {}, `${label} · ${document.expires_on ?? ""} · ${documentWord(document, ctx.today)}`),
          el("a", { href: `/api/documents/${document.id}/file` }, `View ${label}`),
        ),
      );
    }
  };

  uploadButton.addEventListener("click", async () => {
    uploadButton.disabled = true;
    announce(uploadStatus, "Uploading…");
    const form = new FormData();
    form.set("kind", (kindSelect as HTMLSelectElement).value);
    form.set("expires_on", (expiryInput as HTMLInputElement).value.trim());
    const file = (fileInput as HTMLInputElement).files?.[0];
    if (file) form.set("file", file);
    try {
      const response = await fetch(`/api/renters/${renterId}/documents`, { method: "POST", body: form });
      if (response.ok) {
        const label = KIND_LABELS[(kindSelect as HTMLSelectElement).value] ?? "";
        announce(uploadStatus, `${label} uploaded. It's waiting for review.`);
        await loadDocuments();
      } else {
        const bodyText = (await response.json()) as { error: string };
        if (bodyText.error === "file_too_large") announce(uploadStatus, "That file is larger than 5,000,000 bytes.");
        else if (bodyText.error === "unsupported_type") announce(uploadStatus, "Upload a PDF, PNG or JPEG scan.");
        else if (bodyText.error === "storage_unavailable") announce(uploadStatus, "File storage is unreachable. Try the upload again in a minute.");
        else announce(uploadStatus, "Something went wrong. Try again.");
      }
    } catch {
      announce(uploadStatus, "Something went wrong. Try again.");
    } finally {
      uploadButton.disabled = false;
    }
  });

  // ---- statements ----
  const monthInput = el("input", { type: "text", id: "statement-month", "aria-label": "Statement month", placeholder: "YYYY-MM" });
  const createStatement = el("button", { type: "button" }, "Create statement");
  const statementLinks = el("div", { class: "statement-links" });
  const statementsRegion = el(
    "section",
    { class: "panel statements", "aria-label": "Statements" },
    el("h2", {}, "Statements"),
    statementLinks,
    el("div", { class: "statement-form" }, monthInput, createStatement),
    statementStatus,
  );

  const loadStatements = async (): Promise<void> => {
    const data = await apiJson<{ statements: Statement[] }>(`/api/renters/${renterId}/statements`);
    clear(statementLinks);
    if (data.statements.length === 0) {
      statementLinks.append(el("p", { class: "empty-copy" }, "No statements yet."));
      return;
    }
    for (const statement of data.statements) {
      statementLinks.append(
        el("div", { class: "statement-row" }, el("a", { href: `/api/statements/${statement.id}/file` }, `Download ${statement.month} statement`)),
      );
    }
  };

  createStatement.addEventListener("click", async () => {
    createStatement.disabled = true;
    announce(statementStatus, "Creating statement…");
    try {
      const month = (monthInput as HTMLInputElement).value.trim();
      const result = await postJson<{ statement: { month: string } }>(`/api/renters/${renterId}/statements`, { month });
      announce(statementStatus, `Statement for ${result.statement.month} is ready.`);
      await loadStatements();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "storage_unavailable") {
        announce(statementStatus, "File storage is unreachable. Try the upload again in a minute.");
      } else {
        announce(statementStatus, "Something went wrong. Try again.");
      }
    } finally {
      createStatement.disabled = false;
    }
  });

  body.append(packsRegion, ledgerRegion, documentsRegion, statementsRegion);
  mount.append(frame);

  const applied = window.sessionStorage.getItem("railside-applied");
  if (applied === "1") {
    const applicationStatus = el("div", { role: "status", id: "application-status", class: "status-live", "aria-live": "polite" }, "Application received. Upload your three documents to move to review.");
    body.prepend(applicationStatus);
    window.sessionStorage.removeItem("railside-applied");
    applicationStatus.focus?.();
  }

  await Promise.all([loadPacks(), loadLedger(), loadBalance(), loadDocuments(), loadStatements()]);

  const poll = window.setInterval(() => {
    void loadPacks().catch(() => undefined);
  }, 15000);
  window.addEventListener("focus", () => {
    void loadPacks().catch(() => undefined);
  });
  mount.addEventListener("railside-unmount", () => window.clearInterval(poll));
};
