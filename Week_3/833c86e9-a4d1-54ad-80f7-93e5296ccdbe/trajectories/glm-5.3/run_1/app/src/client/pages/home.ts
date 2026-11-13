import { t, state, fmt } from "../i18n.js";
import { ui } from "../boot.js";
import { HOME_LAYERS } from "../../domain/messages.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement): Promise<void> {
    main.replaceChildren();
    // the search form lives on the home page too, so the keyboard journey
    // reaches the destination combobox by Tab from the start
    const form = document.createElement("div");
    form.className = "home-search";
    const { destinationCombobox } = await import("../widgets/search.js");
    const { partyControls } = await import("../widgets/search.js");
    let adults = 2;
    let ages: number[] = [];
    let dest: { code: string; name: string; zone: string } | null = null;
    const destWrap = destinationCombobox(null, (d) => { dest = d; });
    destWrap.querySelector("input")?.setAttribute("aria-label", ui("search.destination"));
    const party = partyControls(2, [], (a, ag) => { adults = a; ages = ag; });
    const datesBtn = document.createElement("button");
    datesBtn.dataset.focusKey = "dates";
    datesBtn.setAttribute("aria-label", ui("search.dates"));
    datesBtn.textContent = ui("search.dates");
    let inDate: string | null = null;
    let outDate: string | null = null;
    const { openDatePicker } = await import("../widgets/search.js");
    datesBtn.addEventListener("click", () => {
      openDatePicker({
        opener: datesBtn,
        dest: dest?.code,
        zone: dest?.zone ?? "UTC",
        cur: state.cur,
        arrival: inDate,
        departure: outDate,
        onPicked: (a, b) => {
          inDate = a;
          outDate = b;
          if (a && b) {
            const nights = Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
            datesBtn.setAttribute("aria-label", `${ui("search.dates")}, ${fmt().dayMonth(a, dest?.zone ?? "UTC")} to ${fmt().dayMonth(b, dest?.zone ?? "UTC")}, ${nights} ${nights === 1 ? "night" : "nights"}`);
            datesBtn.textContent = `${fmt().dayMonth(a, dest?.zone ?? "UTC")} – ${fmt().dayMonth(b, dest?.zone ?? "UTC")}`;
          }
        }
      });
    });
    const searchBtn = document.createElement("button");
    searchBtn.dataset.focusKey = "home-search";
    searchBtn.textContent = ui("search.search");
    searchBtn.addEventListener("click", () => {
      const url = new URLSearchParams();
      if (dest) url.set("dest", dest.code);
      if (inDate && outDate) {
        url.set("in", inDate);
        url.set("out", outDate);
      }
      url.set("adults", String(adults));
      if (ages.length) url.set("ages", ages.join(","));
      location.href = `/search?${url.toString()}`;
    });
    form.append(destWrap, datesBtn, party, searchBtn);
    main.prepend(form);

    const hero = document.createElement("section");
    hero.className = "hero";
    const word = document.createElement("div");
    word.className = "hero-word";
    word.textContent = t("hero.word");
    const sentence = document.createElement("div");
    sentence.className = "hero-sentence";
    const p = document.createElement("p");
    p.textContent = t("hero.sentence");
    const cta = document.createElement("a");
    cta.className = "hero-cta accent-block";
    cta.href = "/search";
    cta.textContent = ui("home.cta");
    sentence.append(p, cta);
    hero.append(word, sentence);
    main.appendChild(hero);

    const sections = document.createElement("div");
    sections.className = "home-sections";
    const layers = document.createElement("div");
    layers.className = "home-layers";
    for (const line of HOME_LAYERS[state.lang]) {
      const el = document.createElement("p");
      el.textContent = line;
      layers.appendChild(el);
    }
    const cancel = document.createElement("div");
    cancel.className = "sage-field";
    cancel.textContent = t("home.cancel");
    sections.append(layers, cancel);
    main.appendChild(sections);

    const numerals = document.createElement("div");
    numerals.className = "home-numerals";
    const first = document.createElement("div");
    const n1 = document.createElement("div");
    n1.className = "num";
    n1.textContent = "9%";
    const p1 = document.createElement("p");
    p1.textContent = t("home.commission");
    first.append(n1, p1);
    const second = document.createElement("div");
    const n2 = document.createElement("div");
    n2.className = "num";
    n2.textContent = "180";
    const p2 = document.createElement("p");
    p2.textContent = t("home.reviews");
    second.append(n2, p2);
    numerals.append(first, second);
    main.appendChild(numerals);

    const illus = document.createElement("div");
    illus.className = "home-illustration";
    const img = document.createElement("img");
    img.src = "/images/harbour.svg";
    img.alt = ui("home.illustration");
    illus.appendChild(img);
    main.appendChild(illus);
  }
};

export default page;
