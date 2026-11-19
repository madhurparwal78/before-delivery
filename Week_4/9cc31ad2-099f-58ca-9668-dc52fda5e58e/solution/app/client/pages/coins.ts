import { get } from "../api";
import { h } from "../dom";
import { coinClass, fmtCoins, fmtSignedCoins } from "../format";
import type { PageContext } from "../router";
import { me } from "../session";
import { renderShell } from "../shell";

interface Ledger {
  balance: number;
  total: number;
  movements: { movementId: string; kind: string; createdAt: string; runId: string | null; entries: { account: string; amount: number }[] }[];
}

const KIND_LABEL: Record<string, string> = {
  opening: "Opening grant", finals: "Club finals reward", pickups: "Coin pickups", result: "Race result",
  upgrade: "Upgrade", car: "Car purchase", refit: "Refit refund",
};

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export async function coinsPage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Coin history";
  const ledger = (await get<Ledger>("/v1/ledger", ctx.signal)).data;
  if (ctx.signal.aborted) return;
  const main = renderShell(true, ["Totals", "Ledger"]);
  const wallet = `wallet:${me()!.playerId}`;
  const rows = ledger.movements.map((movement) => {
    const mine = movement.entries.find((entry) => entry.account === wallet)!;
    const counter = movement.entries.find((entry) => entry.account !== wallet)!;
    return h("tr", null,
      h("td", { class: "mono" }, WHEN.format(new Date(movement.createdAt))),
      h("td", null, KIND_LABEL[movement.kind] ?? movement.kind),
      h("td", { class: `fig ${coinClass(mine.amount)}` }, fmtSignedCoins(mine.amount)),
      h("td", null, h("span", { class: "mono account" }, ...counter.account.split(":").flatMap((part, i) => (i ? [":", h("wbr"), part] : [part]))),
        h("span", { class: `counter-amount ${coinClass(counter.amount)}` }, fmtSignedCoins(counter.amount))));
  });
  main.append(
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Garage · Ledger"), h("h1", null, "Coin history"))),
    h("section", { class: "totals", "aria-label": "Coin totals" },
      h("p", { class: "cell fig coins-figure" }, `Balance ${fmtCoins(ledger.balance)} coins`),
      h("p", { class: "cell fig" }, `Ledger total ${fmtCoins(ledger.total)} coins`)),
    h("table", { class: "coin-table", "aria-label": "Coin history" },
      h("thead", null, h("tr", null,
        h("th", { scope: "col" }, "When"), h("th", { scope: "col" }, "Movement"),
        h("th", { scope: "col", class: "fig" }, "Wallet"), h("th", { scope: "col" }, "Counter account"))),
      h("tbody", null, ...rows)),
    h("div", { class: "garage-links" }, h("a", { href: "/garage", class: "button" }, "Back to the garage")));
}
