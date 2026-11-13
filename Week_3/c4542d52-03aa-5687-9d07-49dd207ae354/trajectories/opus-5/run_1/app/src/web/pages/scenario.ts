import type { LiveEvent, SavedScenario, ScenarioResult } from "../../shared/types.js";
import { formatCount, formatMoney, formatPricePerShare } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, announceOnce, applySocketState, replaceAddress, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";

const RESULT_LABELS: Array<[string, (result: ScenarioResult) => string]> = [
  ["Pool top-up", (result) => formatCount(result.pool_top_up)],
  ["Price per share", (result) => formatPricePerShare(result.price_per_share)],
  ["New shares", (result) => formatCount(result.new_shares)],
  ["Post-money fully diluted", (result) => formatCount(result.fully_diluted_after)],
  ["New investor", (result) => `${result.new_investor_percent}%`],
  ["Pool after", (result) => `${result.pool_after_percent}%`],
  ["Dilution", (result) => `${result.dilution_percent}%`],
  ["Investment used", (result) => formatMoney(result.investment_used)],
  [
    "Price vs fair market value",
    (result) => (result.price_to_fmv === null ? "No current valuation" : `${result.price_to_fmv}×`),
  ],
];

let openedScenario: string | null = null;

export function scenarioPage(context: PageContext): Page {
  let pre = context.query.get("pre") ?? "";
  let investment = context.query.get("investment") ?? "";
  let pool = context.query.get("pool") ?? "";
  let result: ScenarioResult | null = null;
  let resultRegion: HTMLElement | null = null;
  let savedList: HTMLElement | null = null;
  const errors = new Map<string, HTMLElement>();

  function setError(name: string, message: string | null): void {
    const node = errors.get(name);
    if (node === undefined) return;
    node.hidden = message === null;
    node.textContent = message === null ? "" : `Error: ${message}`;
  }

  function writeAddress(): void {
    const query = new URLSearchParams({ pre, investment, pool });
    replaceAddress(`/admin/scenario?${query.toString()}`);
  }

  function paintResult(): void {
    if (resultRegion === null) return;
    clear(resultRegion);
    if (result === null) {
      resultRegion.classList.add("greyed");
      return;
    }
    resultRegion.classList.remove("greyed");
    for (const [label, read] of RESULT_LABELS) {
      resultRegion.append(
        el("div", { class: "labelled" }, [
          el("span", { class: "labelled-label" }, [label]),
          el("span", { class: "labelled-value" }, [read(result)]),
        ]),
      );
    }
  }

  async function recompute(announceResult: boolean): Promise<void> {
    for (const name of errors.keys()) setError(name, null);
    if (pre === "" || investment === "" || pool === "") {
      result = null;
      paintResult();
      return;
    }
    try {
      result = await api<ScenarioResult>("/api/scenarios/round", {
        method: "POST",
        body: { pre_money: pre, investment, target_pool_percent: pool },
      });
      paintResult();
      if (announceResult) announce(`Scenario updated: price per share ${formatPricePerShare(result.price_per_share)}.`);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (resultRegion !== null) resultRegion.classList.add("greyed");
      const names: Record<string, string> = {
        pre_money: "pre_money",
        investment: "investment",
        target_pool_percent: "target_pool_percent",
      };
      for (const [name, message] of Object.entries(failure.fields)) setError(names[name] ?? name, message);
    }
  }

  async function drawSaved(): Promise<void> {
    if (savedList === null) return;
    const saved = await api<{ scenarios: SavedScenario[] }>("/api/scenarios/saved");
    clear(savedList);
    for (const scenario of saved.scenarios) {
      const query = new URLSearchParams({
        pre: scenario.pre_money,
        investment: scenario.investment,
        pool: scenario.target_pool_percent,
      });
      const link = el(
        "a",
        { href: `/admin/scenario?${query.toString()}`, "data-route": "", "data-scenario": scenario.name },
        [scenario.name],
      );
      link.addEventListener("click", () => {
        openedScenario = scenario.name;
      });
      savedList.append(el("li", {}, [link]));
    }
    if (openedScenario !== null) {
      const link = savedList.querySelector<HTMLElement>(`[data-scenario="${openedScenario}"]`);
      openedScenario = null;
      if (link !== null) link.focus();
    }
  }

  async function draw(): Promise<void> {
    clear(context.main);
    errors.clear();
    const makeField = (id: string, label: string, name: string, value: string): HTMLElement => {
      const input = el("input", { type: "text", id, value }) as HTMLInputElement;
      const error = el("p", { class: "field-error", hidden: true });
      errors.set(name, error);
      let timer: number | null = null;
      input.addEventListener("input", () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (name === "pre_money") pre = input.value;
          else if (name === "investment") investment = input.value;
          else pool = input.value;
          writeAddress();
          void recompute(true);
        }, 300);
      });
      return el("div", { class: "field" }, [el("label", { for: id }, [label]), input, error]);
    };

    const form = el("form", { class: "column form", "aria-label": "Round scenario" }, [
      makeField("scenario-pre", "Pre-money valuation", "pre_money", pre),
      makeField("scenario-investment", "New investment", "investment", investment),
      makeField("scenario-pool", "Target pool after the round", "target_pool_percent", pool),
    ]) as HTMLFormElement;
    form.addEventListener("submit", (event) => event.preventDefault());

    resultRegion = el("section", { class: "scenario-result", role: "region", "aria-label": "Scenario result" });

    const nameInput = el("input", { type: "text", id: "scenario-name" }) as HTMLInputElement;
    const nameError = el("p", { class: "field-error", hidden: true });
    const save = liveButton("Save scenario", { class: "primary" });
    save.addEventListener("click", () => {
      void (async () => {
        nameError.hidden = true;
        try {
          await api<{ scenario: SavedScenario }>("/api/scenarios/saved", {
            method: "POST",
            body: { name: nameInput.value, pre_money: pre, investment, target_pool_percent: pool },
          });
          announce(`Scenario ${nameInput.value.trim()} saved.`);
          nameInput.value = "";
          await drawSaved();
        } catch (failure) {
          if (!(failure instanceof ApiFailure)) throw failure;
          const message = failure.fields["name"] ?? failure.message;
          nameError.hidden = false;
          nameError.textContent = `Error: ${message}`;
          announce(message);
        }
      })();
    });
    const saveForm = el("form", { class: "column form", "aria-label": "Save scenario" }, [
      el("div", { class: "field" }, [el("label", { for: "scenario-name" }, ["Scenario name"]), nameInput, nameError]),
      save,
    ]) as HTMLFormElement;
    saveForm.addEventListener("submit", (event) => event.preventDefault());

    savedList = el("ul", { class: "saved-list", role: "list", "aria-label": "Saved scenarios" });

    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, ["Nothing here changes the register."]),
        el("div", { class: "column" }, [
          el("h1", { class: "chapter-title" }, ["Round scenario"]),
          form,
          resultRegion,
          saveForm,
          savedList,
        ]),
      ]),
    );
    await recompute(false);
    await drawSaved();
    applySocketState();
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "scenario_saved") {
        void drawSaved();
        return;
      }
      if (event.type === "valuation_changed") {
        void (async () => {
          await recompute(false);
          const copy =
            result === null || result.price_to_fmv === null || result.fmv_per_share === null
              ? "There is no current valuation to compare the round price with."
              : `Fair market value is now ${formatPricePerShare(result.fmv_per_share)}; the round price is ${result.price_to_fmv}× it.`;
          announceOnce(`valuation-${event.seq}`, copy);
        })();
      }
    },
  };
}
