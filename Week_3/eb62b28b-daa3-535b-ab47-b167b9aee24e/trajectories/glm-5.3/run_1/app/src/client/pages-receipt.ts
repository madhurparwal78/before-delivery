import { el, api } from "./dom.js";
import { announcementsRegion } from "./shell.js";
import { formatDate, formatMoney } from "./motion.js";
import { PRACTICE } from "../shared/constants.js";

type Receipt = {
  id: string;
  number: string;
  memberName: string | null;
  paidAt: string;
  paidDate: string;
  amountCents: number;
  currency: string;
  invoiceId: string;
  items: { description: string; periodStart: string; periodEnd: string; amountCents: number }[];
  practice: { name: string; address: string; taxNumber: string };
};

export async function receiptDetail(receiptId: string): Promise<HTMLElement> {
  const result = await api<{ receipt: Receipt }>(`/api/receipts/${receiptId}`);
  if (!result.ok) {
    const main = el("main", { class: "page narrow" });
    main.append(el("h1", { class: "page-title" }, "We can't find that page."));
    return el("div", { class: "screen" }, main);
  }
  const receipt = result.data.receipt;
  const main = el("main", { class: "page receipt-page narrow" });
  main.append(el("h1", { class: "page-title" }, `Receipt ${receipt.number}`));
  const card = el("section", { class: "card" });
  card.append(el("p", { class: "card-copy" }, receipt.practice.name));
  card.append(el("p", { class: "card-copy" }, receipt.practice.address));
  card.append(el("p", { class: "card-copy" }, `Tax number ${receipt.practice.taxNumber}`));
  card.append(el("p", { class: "card-copy" }, `Member ${receipt.memberName ?? "Erased member"}`));
  card.append(el("p", { class: "card-copy" }, `Paid ${formatDate(receipt.paidDate, "America/Phoenix")}`));
  const table = el("table", { class: "data-table" });
  table.append(el("caption", { class: "sr-only" }, "Line items"));
  const head = el("thead");
  const headRow = el("tr");
  for (const label of ["Description", "Period", "Amount"]) {
    headRow.append(el("th", { scope: "col" }, label));
  }
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  for (const item of receipt.items ?? []) {
    const row = el("tr");
    row.append(
      el("td", {}, item.description),
      el("td", {}, `${item.periodStart} – ${item.periodEnd}`),
      el("td", {}, formatMoney(item.amountCents))
    );
    body.append(row);
  }
  table.append(body);
  card.append(el("div", { class: "table-frame", role: "region", "aria-label": "Line items", tabindex: "0" }, table));
  card.append(el("p", { class: "card-value" }, formatMoney(receipt.amountCents)));
  card.append(el("p", { class: "card-copy" }, "Paid"));
  main.append(card);
  const print = el("button", { type: "button", class: "button primary" }, "Print receipt");
  print.addEventListener("click", () => {
    window.print();
  });
  return el(
    "div",
    { class: "screen" },
    announcementsRegion(),
    main,
    el("div", { class: "bottom-bar" }, print),
  );
}
