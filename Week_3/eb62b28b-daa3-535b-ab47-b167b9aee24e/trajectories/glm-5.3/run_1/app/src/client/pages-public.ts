import { el, api } from "./dom.js";
import { publicHeader, partnerStrip, glyphDecor, loadSession, announcementsRegion } from "./shell.js";
import { navigate } from "./router.js";
import { announce, formatMoney, rollValue } from "./motion.js";
import { plusPriceCents } from "../shared/plans.js";
import type { Cadence } from "../shared/enums.js";

export async function homePage(): Promise<HTMLElement> {
  const session = await loadSession();
  const seePlans = el("a", { href: "/plans", class: "button primary" }, "See plans");
  const main = el("main", { class: "page home-page" });
  const hero = el("section", { class: "hero" });
  const heroArt = el("div", { class: "hero-art" });
  heroArt.append(glyphDecor("cloud"));
  const h1 = el("h1", { class: "page-title" }, "Ocotillo Longevity Club");
  const pitch = el(
    "p",
    { class: "hero-pitch" },
    "At-home fasting blood draws, exact lab conversions and a supplement plan that arrives packed — all run from one desk in Scottsdale."
  );
  const cta = el("a", { href: "/plans", class: "button primary hero-cta" }, "See plans");
  hero.append(heroArt, h1, pitch, cta);
  const strip = partnerStrip();
  const features = el("section", { class: "features" });
  const cards: { kind: "tube" | "band" | "packet"; title: string; copy: string }[] = [
    { kind: "tube", title: "At-home draws", copy: "A visiting phlebotomist comes to your door, in your own local time." },
    { kind: "band", title: "The marker band", copy: "Every result on one band, flagged against the range table in force on the day your blood was drawn." },
    { kind: "packet", title: "Supplement packets", copy: "Your blend packed into morning and evening packets, at most four capsules each." },
  ];
  for (const card of cards) {
    const node = el("article", { class: "feature-card" });
    node.append(glyphDecor(card.kind));
    node.append(el("h2", { class: "feature-title" }, card.title));
    node.append(el("p", { class: "feature-copy" }, card.copy));
    features.append(node);
  }
  main.append(hero, strip, features);
  const wrapper = el(
    "div",
    { class: "screen" },
    publicHeader(session),
    announcementsRegion(),
    main,
    el("div", { class: "bottom-bar" }, seePlans),
  );
  return wrapper;
}

type PlansResponse = {
  plans: { id: string; name: string; prices: { cadence: Cadence; months: number; amountCents: number; perMonthCents: number }[] }[];
};

type StatesResponse = { states: { state: string; name: string; served: boolean }[] };

export async function plansPage(): Promise<HTMLElement> {
  const session = await loadSession();
  const plansResult = await api<PlansResponse>("/api/plans");
  const statesResult = await api<StatesResponse>("/api/states");
  const plans = plansResult.ok ? plansResult.data.plans : [];
  const states = statesResult.ok ? statesResult.data.states : [];
  let cadence: Cadence = "sixMonths";

  const main = el("main", { class: "page plans-page" });
  const h1 = el("h1", { class: "page-title" }, "Plans");
  main.append(h1);

  const price = el("div", { class: "price-roll", "data-part": "price" });
  const perMonth = el("div", { class: "per-month-roll", "data-part": "per-month" });

  const renderPrice = (): void => {
    const p = plusPriceCents(cadence);
    price.replaceChildren(el("span", { class: "price-value" }, `${formatMoney(p.amountCents)} ${cadence === "sixMonths" ? "every 6 months" : "a year"}`));
    perMonth.replaceChildren(el("span", { class: "per-month-value" }, `${formatMoney(p.perMonthCents)} a month`));
  };
  renderPrice();

  const cadenceGroup = el("div", { class: "field" });
  cadenceGroup.append(el("span", { class: "field-label", id: "cadence-label" }, "Billing cadence"));
  const sixMonths = el("input", { type: "radio", name: "cadence", id: "cadence-six", value: "sixMonths", checked: true });
  const yearly = el("input", { type: "radio", name: "cadence", id: "cadence-year", value: "yearly" });
  sixMonths.setAttribute("aria-labelledby", "cadence-label");
  yearly.setAttribute("aria-labelledby", "cadence-label");
  const roll = () => {
    const current: Cadence = sixMonths.checked ? "sixMonths" : "yearly";
    if (current === cadence) return;
    cadence = current;
    rollValue(price, () => el("span", { class: "price-value" }, `${formatMoney(plusPriceCents(cadence).amountCents)} ${cadence === "sixMonths" ? "every 6 months" : "a year"}`));
    rollValue(perMonth, () => el("span", { class: "per-month-value" }, `${formatMoney(plusPriceCents(cadence).perMonthCents)} a month`));
  };
  sixMonths.addEventListener("change", roll);
  yearly.addEventListener("change", roll);
  const options = el("div", { class: "radio-row", role: "radiogroup", "aria-labelledby": "cadence-label" });
  options.append(
    el("label", { class: "radio-option", for: "cadence-six" }, sixMonths, el("span", {}, "Every 6 months")),
    el("label", { class: "radio-option", for: "cadence-year" }, yearly, el("span", {}, "Yearly"))
  );
  cadenceGroup.append(options);
  main.append(cadenceGroup, price, perMonth);

  const cards = el("div", { class: "plan-cards" });
  const freeCard = el("article", { class: "plan-card" });
  freeCard.append(el("h2", { class: "plan-name" }, "Free"));
  freeCard.append(el("p", { class: "plan-price" }, "$0"));
  const createFree = el("a", { href: "/join", class: "button" }, "Create a free account");
  freeCard.append(createFree);
  const plusCard = el("article", { class: "plan-card plus-card" });
  plusCard.append(el("h2", { class: "plan-name" }, "Plus"));
  plusCard.append(price.cloneNode(true));
  plusCard.append(perMonth.cloneNode(true));
  const joinPlus = el("button", { type: "button", class: "button primary" }, "Join Plus");
  joinPlus.addEventListener("click", () => {
    if (session) navigate("/me/membership");
    else navigate("/join");
  });
  plusCard.append(joinPlus);
  cards.append(freeCard, plusCard);
  main.append(cards);

  const comparison = el("table", { class: "compare-table" });
  const caption = el("caption", {}, "Compare Free and Plus");
  comparison.append(caption);
  const head = el("thead");
  const headRow = el("tr");
  headRow.append(el("th", { scope: "col" }, ""), el("th", { scope: "col" }, "Free"), el("th", { scope: "col" }, "Plus"));
  head.append(headRow);
  comparison.append(head);
  const body = el("tbody");
  const rows: [string, string, string][] = [
    ["At-home blood draws", "None", "Two a year"],
    ["Results on the marker band", "No", "Yes"],
    ["Written longevity plan", "No", "Yes"],
    ["Custom supplement blend", "No", "Yes, member price"],
    ["Care messages", "No", "Yes"],
    ["Marker catalog", "Yes", "Yes"],
  ];
  for (const [label, free, plus] of rows) {
    const row = el("tr");
    row.append(el("th", { scope: "row" }, label), el("td", {}, free), el("td", {}, plus));
    body.append(row);
  }
  comparison.append(body);
  const compareWrap = el("div", { class: "table-frame", role: "region", "aria-label": "Compare Free and Plus", tabindex: "0" }, comparison);
  main.append(compareWrap);

  // State check
  const stateField = el("div", { class: "state-check" });
  const stateSelect = el("select", { id: "state", class: "input", "aria-label": "Your state" });
  for (const state of states) {
    stateSelect.append(el("option", { value: state.state }, state.name));
  }
  const checkButton = el("button", { type: "button", class: "button" }, "Check state");
  const answer = el("p", { class: "state-answer", role: "note" });
  checkButton.addEventListener("click", async () => {
    const code = (stateSelect as HTMLSelectElement).value;
    const result = await api<{ served: boolean; message: string }>(`/api/states/${code}`);
    if (result.ok) {
      answer.textContent = result.data.message;
      announce(result.data.message);
    }
  });
  stateField.append(stateSelect, checkButton, answer);
  main.append(stateField);
  main.append(el("a", { href: "/markers", class: "text-link" }, "Browse the marker catalog"));

  const bottomJoin = el(
    "button",
    { type: "button", class: "button primary", onclick: () => navigate(session ? "/me/membership" : "/join") },
    "Join Plus"
  );

  const wrapper = el(
    "div",
    { class: "screen" },
    publicHeader(session),
    announcementsRegion(),
    main,
    el("div", { class: "bottom-bar" }, bottomJoin),
  );
  return wrapper;
}
