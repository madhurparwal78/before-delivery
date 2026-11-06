import { api, ApiCallError, errorFields, type LedgerEntry, type Person } from "../api";
import { h, clear, dollars, shortDateTime, liveRegion, announce, screen as appScreen, registerRefresh, showModal, closeModal } from "../helpers";
import { me } from "../main";

type CreditBody = { balance_cents: number; card_status: string; entries: LedgerEntry[] };

export function renderCredit(root: HTMLElement): void {
  const status = liveRegion("Credit status");
  const balanceEl = h("div", { class: "fig huge", text: "—" });
  const cardEl = h("div", { class: "muted", text: "" });
  const packsRow = h("div", { class: "pack-row" });
  const ledgerBody = h("tbody");
  const ledgerTable = h("table", { class: "table", "aria-label": "Ledger" },
    h("thead", null, h("tr", null, h("th", { class: "cell", text: "Label" }), h("th", { class: "cell", text: "Amount" }), h("th", { class: "cell", text: "Account" }))),
    ledgerBody);
  const balanceRegion = h("section", { class: "panel credit-balance", "aria-label": "Credit balance" }, h("div", { class: "caption", text: "BALANCE" }), balanceEl, cardEl);
  const content = h("div", { class: "stack" }, balanceRegion, h("section", { class: "panel" }, h("div", { class: "caption", text: "CREDIT PACKS" }), packsRow), h("section", { class: "panel ledger-panel" }, h("div", { class: "caption", text: "LEDGER" }), ledgerTable), status);
  root.appendChild(appScreen(content));
  const timeZone = me()?.timeZone ?? "UTC";
  void load();

  async function load(): Promise<void> {
    try {
      const credit = await api<CreditBody>("/api/me/credit");
      clear(packsRow);
      balanceEl.textContent = credit.balance_cents < 0 ? `OWING ${dollars(-credit.balance_cents)}` : `BALANCE ${dollars(credit.balance_cents)}`;
      cardEl.textContent = credit.card_status === "on_file" ? "Card on file" : "No card on file";
      try {
        const packs = await api<{ id: string; name: string; amount_cents: number }[]>("/api/credit-packs");
        for (const pack of packs) {
          const button = h("button", { class: "btn", text: `Buy ${pack.name}` });
          button.addEventListener("click", () => openBuyDialog(button, pack));
          packsRow.appendChild(button);
        }
      } catch {
        /* packs refill on next change */
      }
      renderLedger(credit.entries);
    } catch {
      /* the next live update will refill */
    }
  }

  function renderLedger(entries: LedgerEntry[]): void {
    clear(ledgerBody);
    for (const entry of entries) {
      ledgerBody.appendChild(
        h("tr", null,
          h("td", { class: "cell", text: entryLabel(entry) }),
          h("td", { class: "cell mono", text: dollars(entry.amount_cents) }),
          h("td", { class: "cell muted", text: entry.account }),
        ),
      );
    }
  }

  function entryLabel(entry: LedgerEntry): string {
    const kind = entry.kind === "opening" ? "Opening balance" : entry.kind === "pack" ? "Credit pack" : entry.kind === "firing_fee" ? "Firing fee" : entry.kind === "storage_fee" ? "Storage fee" : entry.kind === "refund" ? "Refund" : "Adjustment";
    return `${kind} · ${shortDateTime(entry.created_at, timeZone)}`;
  }

  function openBuyDialog(opener: HTMLElement, pack: { id: string; name: string; amount_cents: number }): void {
    const idempotencyKey = `pack-${crypto.randomUUID()}`;
    const confirm = h("button", { class: "btn primary", text: "Confirm purchase" });
    const cancel = h("button", { class: "btn", text: "Cancel" });
    const dialog = h("div", { class: "dialog panel", "aria-label": "Buy credit" },
      h("div", { class: "caption", text: "BUY CREDIT" }),
      h("p", { text: `${pack.name} · ${dollars(pack.amount_cents)}` }),
      confirm,
      cancel);
    const close = () => {
      cancel.removeEventListener("click", close);
      confirm.removeEventListener("click", onSubmit);
    };
    const onSubmit = () => {
      close();
      void buy(pack, idempotencyKey, confirm);
    };
    cancel.addEventListener("click", () => {
      close();
      closeModal();
    });
    confirm.addEventListener("click", onSubmit);
    showModal(dialog, opener);
  }

  async function buy(pack: { id: string; name: string; amount_cents: number }, key: string, confirm: HTMLElement): Promise<void> {
    confirm.setAttribute("disabled", "true");
    announce(status, "Processing payment…");
    try {
      const res = await api<{ purchase: { status: string }; balance_cents: number }>(`/api/credit-packs/${encodeURIComponent(pack.id)}/purchase`, { method: "POST", body: {}, idempotencyKey: key });
      if (res.purchase.status === "completed") {
        announce(status, `Credit added. Balance ${dollars(res.balance_cents)}.`);
      } else {
        announce(status, "Payment sent to billing. Your balance updates as soon as billing confirms it.");
      }
    } catch (err) {
      if (err instanceof ApiCallError && err.kind === "api") {
        announce(status, err.body.message);
      } else {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
    } finally {
      confirm.removeAttribute("disabled");
      closeModal();
    }
  }

  registerRefresh(() => void load());
}
