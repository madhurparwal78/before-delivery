import { get } from "../api";
import { h } from "../dom";
import { carDrawing } from "../drawing";
import { fmtCoins, fmtSpeed } from "../format";
import { BalanceView } from "../garage/balance";
import { PurchaseDialog } from "../garage/purchase";
import { live } from "../live";
import type { PageContext } from "../router";
import { me } from "../session";
import { renderShell } from "../shell";
import type { CatalogueCar, Garage } from "../types";

const REFRESHED = "Garage refreshed from the server.";

export async function dealerPage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Dealer";
  const [catalogue, garageResult] = await Promise.all([
    get<{ cars: CatalogueCar[] }>("/v1/cars", ctx.signal), get<Garage>("/v1/garage", ctx.signal),
  ]);
  if (ctx.signal.aborted) return;
  let garage = garageResult.data;
  const main = renderShell(true, ["Cars", "Buy", "Garage"]);
  const balanceRegion = h("p", { role: "status", "aria-label": "Coin balance", class: "coins-figure balance-figure" });
  const balance = new BalanceView(balanceRegion, garage.balance);
  const updates = h("p", { role: "status", "aria-label": "Garage updates", class: "status-line" });
  const grid = h("div", { class: "dealer-grid" });
  let dialog: PurchaseDialog<{ carId: string; balance: number }> | null = null;

  const owned = (carId: string) => garage.cars.some((car) => car.carId === carId);
  const cellOf = (carId: string) => grid.querySelector<HTMLElement>(`[data-car="${carId}"]`);
  const buyButtonOf = (carId: string) => cellOf(carId)?.querySelector<HTMLButtonElement>("button") ?? null;

  async function reread(): Promise<Garage> {
    garage = (await get<Garage>("/v1/garage")).data;
    balance.read(garage.balance);
    render();
    return garage;
  }

  function openPurchase(car: CatalogueCar): void {
    const price = car.price!;
    dialog = new PurchaseDialog({
      title: "Confirm car purchase",
      price,
      path: "/v1/garage/cars",
      payload: { carId: car.carId },
      details: () => [h("p", null, h("strong", null, car.name), ` · class ${car.class} · PI ${car.pi}`),
        h("p", { class: "mono" }, `Price ${fmtCoins(price)} coins`)],
      knownBalance: () => balance.latest,
      opener: () => buyButtonOf(car.carId),
      onPending: (pending) => balance.setPending(pending),
      onConfirmed: (data) => {
        balance.setPending(false);
        balance.read(data.balance);
        void reread().then(() => {
          cellOf(car.carId)?.focus();
          updates.textContent = `${car.name} added to your garage. Balance: ${fmtCoins(data.balance)} coins.`;
        });
      },
      onInsufficient: async () => (await reread()).balance,
      onRefresh: () => void reread().then(() => {
        (owned(car.carId) ? cellOf(car.carId) : buyButtonOf(car.carId))?.focus();
        updates.textContent = REFRESHED;
      }),
      onClose: () => {
        unwatch();
        dialog = null;
      },
    });
    const opened = dialog;
    const unwatch = balance.watch((value) => opened.balanceChanged(value));
  }

  function render(): void {
    grid.replaceChildren(...catalogue.data.cars.map((car) => {
      const isOwned = owned(car.carId);
      const action = isOwned ? h("span", { class: "badge" }, "Owned")
        : car.price === null ? h("span", { class: "badge" }, "Starter only")
          : h("button", { type: "button", class: "primary", onclick: () => openPurchase(car) }, `Buy ${car.name} for ${fmtCoins(car.price)} coins`);
      return h("article", { class: "cell dealer-car", "data-car": car.carId, tabindex: "-1", "aria-label": car.name },
        h("div", { class: "cell-head" }, h("h2", null, car.name), h("span", { class: "mono" }, `Class ${car.class}`)),
        carDrawing(car.carId, null),
        h("dl", { class: "stat-list" },
          h("dt", null, "PI"), h("dd", null, String(car.pi)),
          h("dt", null, "Acceleration"), h("dd", null, `${car.stats.accelMps2.toFixed(1)} m/s²`),
          h("dt", null, "Braking"), h("dd", null, `${car.stats.brakeMps2.toFixed(1)} m/s²`),
          h("dt", null, "Top speed"), h("dd", null, fmtSpeed(car.stats.topMps, me()!.units)),
          h("dt", null, "Grip"), h("dd", null, `${car.stats.gripPct}%`),
          h("dt", null, "Lane change"), h("dd", null, `${car.stats.laneChangeSteps} steps`),
          h("dt", null, "Price"), h("dd", null, car.price === null ? "Starter" : `${fmtCoins(car.price)} coins`)),
        action);
    }));
  }

  main.append(
    h("div", { class: "page-head" },
      h("div", null, h("p", { class: "kicker" }, "Garage · Dealer"), h("h1", null, "Dealer")),
      h("div", { class: "balance" }, h("span", { class: "label" }, "Coin balance"), balanceRegion)),
    grid, updates,
    h("div", { class: "garage-links" }, h("a", { href: "/garage", class: "button" }, "Back to the garage")));
  render();
  const stop = live.listen((push) => { if (push.type === "balance") balance.push(push.balance, push.purchaseId); });
  ctx.signal.addEventListener("abort", () => {
    dialog?.close();
    stop();
  });
}
