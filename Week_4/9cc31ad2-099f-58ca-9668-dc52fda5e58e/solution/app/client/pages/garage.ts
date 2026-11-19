import {
  CLASS_PI, LAYOUTS, MAX_STAGE, SYSTEMS, carModel, overClassLimit, referenceLap, stagePrice, tunedPi, tunedStats,
  type LayoutId, type Stages, type System,
} from "../../shared/model";
import { refitRefund } from "../../shared/rules";
import { get, send } from "../api";
import { h, prefersReducedMotion } from "../dom";
import { UNIT_LABEL, fmtCoins, speedValue, type Units } from "../format";
import { BalanceView } from "../garage/balance";
import { CarView } from "../garage/carView";
import { PurchaseAttempt, PurchaseDialog } from "../garage/purchase";
import { METERS, Meter, ReferenceFigure, Sweep, summary } from "../garage/sheet";
import { live } from "../live";
import type { PageContext } from "../router";
import { me, setMe } from "../session";
import { renderShell } from "../shell";
import { openDialog } from "../ui/dialog";
import type { Championship, Garage, GarageCar, Me, UpgradeResponse } from "../types";

const REFRESHED = "Garage refreshed from the server.";
const SYSTEM_NAMES: Record<System, string> = { engine: "Engine", tires: "Tires", brakes: "Brakes", suspension: "Suspension" };

interface Slot {
  readonly pips: HTMLElement;
  readonly upgrade: HTMLButtonElement;
  readonly refit: HTMLButtonElement;
  focused: boolean;
  hovered: boolean;
  // Focus the page moves itself (after a purchase or refit) does not start a preview.
  quiet: boolean;
}

function radioGroup(label: string, name: string, options: { value: string; label: string }[], chosen: string,
  onChange: (value: string) => void): HTMLElement {
  return h("div", { class: "field" },
    h("span", { class: "label", id: `${name}-label` }, label),
    h("div", { class: "radio-row", role: "radiogroup", "aria-labelledby": `${name}-label` },
      ...options.map((option) => h("label", { class: "radio-chip" },
        h("input", { type: "radio", name, value: option.value, checked: option.value === chosen, "aria-label": option.label,
          onchange: () => onChange(option.value) }),
        h("span", { "aria-hidden": "true" }, option.label)))));
}

export async function garagePage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Garage";
  const player = me() as Me;
  const [garageResult, champResult] = await Promise.all([
    get<Garage>("/v1/garage", ctx.signal), get<Championship>("/v1/championship", ctx.signal),
  ]);
  if (ctx.signal.aborted) return;
  let garage = garageResult.data;
  let units: Units = player.units;
  let referenceMap: LayoutId = "saltflat-ring";
  let quarryOpen = champResult.data.leagues.some((league) => league.leagueId === "rookie" && league.status === "complete");
  const shownPips = new Map<System, number>();
  let sweep: Sweep | null = null;
  let dialog: PurchaseDialog<UpgradeResponse> | null = null;
  const reduced = prefersReducedMotion();

  const main = renderShell(true, ["Car", "Slots", "Setup"]);
  const balanceRegion = h("p", { role: "status", "aria-label": "Coin balance", class: "coins-figure balance-figure" });
  const balance = new BalanceView(balanceRegion, garage.balance);
  const updates = h("p", { role: "status", "aria-label": "Garage updates", class: "status-line" });
  const announce = (text: string) => { updates.textContent = text; };

  const carSelect = h("select", { id: "car-select", "aria-label": "Car" });
  const mapSelect = h("select", { id: "map-select", "aria-label": "Reference map" });
  const carView = new CarView();
  const carFacts = h("div", { class: "car-facts" });
  const meters = METERS.map((spec) => new Meter(spec));
  const figure = new ReferenceFigure();
  const slots = new Map<System, Slot>();

  const current = (): GarageCar => garage.cars.find((car) => car.carId === garage.selectedCarId) ?? garage.cars[0];
  const nextStats = (car: GarageCar, system: System) =>
    tunedStats(carModel(car.carId)!.stats, { ...car.stages, [system]: car.stages[system] + 1 });

  function finishSweep(): void {
    sweep?.finish();
    sweep = null;
  }

  function fillOptions(): void {
    carSelect.replaceChildren(...garage.cars.map((car) => h("option", { value: car.carId, selected: car.carId === garage.selectedCarId }, car.name)));
    const maps: LayoutId[] = quarryOpen ? ["saltflat-ring", "quarry-switchbacks"] : ["saltflat-ring"];
    mapSelect.replaceChildren(...maps.map((id) => h("option", { value: id, selected: id === referenceMap }, LAYOUTS[id].name)));
  }

  function renderPips(system: System): void {
    const slot = slots.get(system)!;
    const stage = shownPips.get(system) ?? 0;
    slot.pips.setAttribute("aria-label", `Stage ${stage} of ${MAX_STAGE}`);
    slot.pips.replaceChildren(...[1, 2, 3].map((n) => h("span", { class: n <= stage ? "pip on" : "pip" })));
  }

  function renderSlots(): void {
    const car = current();
    for (const system of SYSTEMS) {
      const slot = slots.get(system)!;
      const stage = car.stages[system];
      slot.upgrade.hidden = stage >= MAX_STAGE;
      slot.upgrade.textContent = `Upgrade ${SYSTEM_NAMES[system]} to stage ${Math.min(stage + 1, MAX_STAGE)}`;
      slot.refit.hidden = stage === 0;
      slot.refit.textContent = `Refit ${SYSTEM_NAMES[system]} to stock`;
      renderPips(system);
    }
  }

  function renderCar(): void {
    const car = current();
    carView.setCar(car.carId, car.name);
    carFacts.replaceChildren(
      h("span", { class: "car-name" }, car.name),
      h("span", null, h("span", { class: "label" }, "Class"), h("span", { class: "mono" }, car.class)),
      h("span", null, h("span", { class: "label" }, "PI"), h("span", { class: "mono" }, String(car.pi))));
  }

  function renderSheet(): void {
    const car = current();
    for (const meter of meters) meter.set(car.stats, units);
    if (car.latestReference) figure.showCommitted(car.latestReference);
    else figure.showBaseline(referenceMap, referenceLap(LAYOUTS[referenceMap], car.stats).lapMs);
  }

  function renderAll(): void {
    for (const system of SYSTEMS) shownPips.set(system, current().stages[system]);
    fillOptions();
    renderCar();
    renderSlots();
    renderSheet();
  }

  function focusSlot(system: System): void {
    const slot = slots.get(system)!;
    slot.quiet = !slot.upgrade.hidden;
    (slot.upgrade.hidden ? slot.refit : slot.upgrade).focus();
  }

  async function reread(): Promise<Garage> {
    finishSweep();
    garage = (await get<Garage>("/v1/garage")).data;
    balance.read(garage.balance);
    renderAll();
    return garage;
  }

  function confirmedUpgrade(system: System, data: UpgradeResponse): void {
    finishSweep();
    const car = garage.cars.find((entry) => entry.carId === data.carId)!;
    const stages: Stages = { ...car.stages, [system]: data.stage };
    car.stages = stages;
    car.paid = { ...car.paid, [system]: car.paid[system] + data.price };
    car.pi = data.pi;
    car.overClassLimit = data.overClassLimit;
    car.stats = tunedStats(carModel(car.carId)!.stats, stages);
    car.latestReference = data.reference;
    const from = balance.shown;
    balance.beginSweep(data.purchaseId, data.balance);
    renderCar();
    renderSlots();
    for (const meter of meters) meter.set(car.stats, units);
    focusSlot(system);
    const name = SYSTEM_NAMES[system];
    const running = new Sweep({
      figure, reference: data.reference, fromBalance: from, toBalance: data.balance,
      showBalance: (value) => balance.show(value),
      balanceDone: () => balance.endSweep(data.balance),
      fillPips: () => {
        shownPips.set(system, data.stage);
        renderPips(system);
      },
      announce: () => announce(`${name} stage ${data.stage} fitted. Balance: ${fmtCoins(data.balance)} coins. ${summary(data.reference)}`),
    });
    sweep = running;
    running.start(reduced);
  }

  function openUpgrade(system: System): void {
    const car = current();
    const stage = car.stages[system] + 1;
    const price = stagePrice(car.class, stage);
    const next = nextStats(car, system);
    const nextPi = tunedPi(carModel(car.carId)!.pi, { ...car.stages, [system]: stage });
    const name = SYSTEM_NAMES[system];
    const changes = [
      ["Acceleration", car.stats.accelMps2.toFixed(1), next.accelMps2.toFixed(1), " m/s²"],
      ["Braking", car.stats.brakeMps2.toFixed(1), next.brakeMps2.toFixed(1), " m/s²"],
      ["Grip", String(car.stats.gripPct), String(next.gripPct), "%"],
      ["Lane change", String(car.stats.laneChangeSteps), String(next.laneChangeSteps), " steps"],
      ["Top speed", String(speedValue(car.stats.topMps, units)), String(speedValue(next.topMps, units)), ` ${UNIT_LABEL[units]}`],
    ].filter(([, before, after]) => before !== after);
    dialog = new PurchaseDialog<UpgradeResponse>({
      title: "Confirm upgrade",
      price,
      path: `/v1/garage/cars/${car.carId}/upgrades/${system}`,
      payload: { stage, layoutId: referenceMap },
      details: () => [
        h("p", null, h("strong", null, `${name} stage ${stage}`), ` for ${car.name}`),
        h("p", { class: "mono" }, `Price ${fmtCoins(price)} coins`),
        h("ul", { class: "mono" }, ...changes.map(([label, before, after, unit]) => h("li", null, `${label} ${before} → ${after}${unit}`)),
          h("li", null, `PI ${car.pi} → ${nextPi}`)),
        overClassLimit(car.class, nextPi)
          ? h("p", { class: "dialog-error" },
            `This upgrade takes PI to ${nextPi}, over the class ${car.class} limit of ${CLASS_PI[car.class].max}. The car can no longer enter class ${car.class} events.`)
          : null,
      ].filter((node) => node !== null),
      knownBalance: () => balance.latest,
      opener: () => slots.get(system)!.upgrade,
      onPending: (pending) => balance.setPending(pending),
      onConfirmed: (data) => confirmedUpgrade(system, data),
      onInsufficient: async () => (await reread()).balance,
      onRefresh: () => void reread().then(() => {
        announce(REFRESHED);
        focusSlot(system);
      }),
      onClose: () => {
        unwatch();
        dialog = null;
        stillPointer();
      },
    });
    const opened = dialog;
    const unwatch = balance.watch((value) => opened.balanceChanged(value));
  }

  function openRefit(system: System): void {
    const car = current();
    const refund = refitRefund(car.paid[system]);
    const name = SYSTEM_NAMES[system];
    const attempt = new PurchaseAttempt<{ refund: number; balance: number }>(`/v1/garage/cars/${car.carId}/refits/${system}`, {});
    const confirm = h("button", { type: "button", class: "primary" }, `Refit and refund ${fmtCoins(refund)} coins`);
    const cancel = h("button", { type: "button" }, "Cancel");
    let busy = false;
    const handle = openDialog({
      title: "Confirm refit",
      body: [h("p", null, h("strong", null, `${name} back to stock`), ` on ${car.name}`),
        h("p", { class: "mono" }, `Refund ${fmtCoins(refund)} coins`)],
      actions: [confirm, cancel],
      onEscape: () => leave(),
      initialFocus: confirm,
    });
    const leave = () => {
      if (busy) return;
      handle.close();
      stillPointer();
      slots.get(system)!.refit.focus();
    };
    cancel.addEventListener("click", leave);
    confirm.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      confirm.disabled = true;
      confirm.textContent = "Refitting…";
      const outcome = await attempt.send();
      handle.close();
      stillPointer();
      if (outcome.kind === "confirmed") balance.read(outcome.data.balance);
      await reread();
      focusSlot(system);
      announce(outcome.kind === "confirmed"
        ? `${name} refitted to stock. Refund: ${fmtCoins(outcome.data.refund)} coins. Balance: ${fmtCoins(outcome.data.balance)} coins.`
        : REFRESHED);
    });
  }

  function previewState(system: System): void {
    const slot = slots.get(system)!;
    const car = current();
    const preview = (slot.focused || slot.hovered) && car.stages[system] < MAX_STAGE;
    for (const meter of meters) {
      if (preview) meter.showPreview(car.stats, nextStats(car, system), units);
      else meter.endPreview(car.stats, units);
    }
  }

  for (const system of SYSTEMS) {
    const slot: Slot = {
      pips: h("div", { class: "pips", role: "img" }),
      upgrade: h("button", { type: "button", class: "dark" }),
      refit: h("button", { type: "button" }),
      focused: false,
      hovered: false,
      quiet: false,
    };
    slot.upgrade.addEventListener("click", () => openUpgrade(system));
    slot.refit.addEventListener("click", () => openRefit(system));
    slot.upgrade.addEventListener("focus", () => {
      slot.focused = !slot.quiet;
      slot.quiet = false;
      previewState(system);
    });
    slot.upgrade.addEventListener("blur", () => { slot.focused = false; previewState(system); });
    slot.upgrade.addEventListener("mouseenter", () => {
      if (!pointerMoved) return;
      slot.hovered = true;
      previewState(system);
    });
    slot.upgrade.addEventListener("mouseleave", () => { slot.hovered = false; previewState(system); });
    slots.set(system, slot);
  }

  // Hover previews follow a moving pointer, not content that appears under a still one.
  let pointerMoved = true;
  const onPointerMove = (event: PointerEvent) => { if (event.movementX || event.movementY) pointerMoved = true; };
  document.addEventListener("pointermove", onPointerMove);
  const stillPointer = () => { pointerMoved = false; };

  carSelect.addEventListener("change", () => {
    finishSweep();
    garage.selectedCarId = carSelect.value;
    renderAll();
    void send<Garage>("PATCH", "/v1/garage", { selectedCarId: carSelect.value }).then((result) => {
      if (result.status !== 200 || ctx.signal.aborted) return;
      garage = result.data;
      balance.read(garage.balance);
    });
  });
  mapSelect.addEventListener("change", () => {
    finishSweep();
    referenceMap = mapSelect.value as LayoutId;
    renderSheet();
  });

  const unitsGroup = radioGroup("Speed units", "units", [{ value: "kmh", label: "km/h" }, { value: "mph", label: "mph" }], units,
    (value) => {
      units = value as Units;
      for (const meter of meters) meter.set(current().stats, units);
      void send<Me>("PATCH", "/v1/me", { units }).then((result) => { if (result.status === 200) setMe(result.data); });
    });

  main.append(
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Roadbook · Garage"), h("h1", null, "Garage"))),
    h("div", { class: "garage-head" },
      h("div", { class: "balance" }, h("span", { class: "label" }, "Coin balance"), balanceRegion),
      h("div", { class: "field" }, h("label", { class: "label", for: "car-select" }, "Car"), carSelect),
      h("div", { class: "field" }, h("label", { class: "label", for: "map-select" }, "Reference map"), mapSelect),
      unitsGroup),
    h("div", { class: "garage-grid" },
      h("section", { class: "cell car-cell", "aria-label": "Car" },
        h("div", { class: "cell-head" }, h("h2", null, "01 Car")), carView.element, carFacts),
      h("section", { class: "cell slots-cell", "aria-label": "Upgrade slots" },
        h("div", { class: "cell-head" }, h("h2", null, "02 Slots")),
        ...SYSTEMS.map((system) => {
          const slot = slots.get(system)!;
          return h("div", { class: "slot", role: "group", "aria-label": SYSTEM_NAMES[system] },
            h("div", { class: "slot-head" }, h("span", { class: "slot-name" }, SYSTEM_NAMES[system]), slot.pips),
            h("div", { class: "slot-actions" }, slot.upgrade, slot.refit));
        })),
      h("section", { class: "cell sheet-cell", "aria-label": "Setup sheet" },
        h("div", { class: "cell-head" }, h("h2", null, "03 Setup")), h("div", { class: "meters" }, ...meters.map((meter) => meter.element)), figure.element)),
    updates,
    h("div", { class: "garage-links" },
      h("a", { href: "/garage/coins", class: "button" }, "Coin history"),
      h("a", { href: "/garage/dealer", class: "button" }, "Dealer"),
      player.guest ? h("a", { href: "/sign-in", class: "button" }, "Save my garage") : null));
  renderAll();
  if ((ctx.state as { focusNav?: boolean } | null)?.focusNav) {
    document.querySelector<HTMLElement>('.nav-link[href="/garage"]')?.focus();
  }

  const stopListening = live.listen((push) => {
    if (push.type === "balance") balance.push(push.balance, push.purchaseId);
    if (push.type === "championship") {
      const open = push.leagues.some((league) => league.leagueId === "rookie" && league.status === "complete");
      if (open !== quarryOpen) {
        quarryOpen = open;
        fillOptions();
      }
    }
  });
  ctx.signal.addEventListener("abort", () => {
    finishSweep();
    dialog?.close();
    stopListening();
    carView.dispose();
    document.removeEventListener("pointermove", onPointerMove);
  });
}
