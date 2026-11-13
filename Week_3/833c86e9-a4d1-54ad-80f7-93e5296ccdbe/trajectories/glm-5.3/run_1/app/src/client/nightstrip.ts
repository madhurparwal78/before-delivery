import { t, fmt, moneyEl, moneyText } from "./i18n.js";
import { ui } from "./boot.js";
import { status, animateId } from "./ui.js";

export type StripQuote = {
  currency: string;
  nights: { date: string; converted_minor: number; state: string }[];
  rooms: { nights: { date: string; lines: { key: string; minor: number }[] }[] }[];
};

/**
 * Night Strip: one column per night in property-local dates, each showing the
 * weekday, the date and that night's amount over a flat state block, expanding
 * by keyboard into its price lines.
 */
export function renderNightStrip(host: HTMLElement, quote: StripQuote, zone: string): void {
  host.replaceChildren();
  const group = document.createElement("div");
  group.className = "nightstrip";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", ui("strip.name"));
  group.dataset.role = "nightstrip";
  const strip = document.createElement("div");
  strip.className = "nightstrip-row";
  group.appendChild(strip);
  host.appendChild(group);

  let expanded: string | null = null;
  const render = () => {
    strip.replaceChildren();
    quote.nights.forEach((night, i) => {
      const col = document.createElement("div");
      col.className = "night" + (expanded === night.date ? " expanded" : "");
      const btn = document.createElement("button");
      btn.dataset.date = night.date;
      btn.dataset.state = night.state;
      btn.dataset.focusKey = "night-" + i;
      btn.setAttribute("aria-expanded", String(expanded === night.date));
      const wd = document.createElement("span");
      wd.className = "wd";
      wd.textContent = fmt().weekdayDayMonth(night.date, zone);
      const amt = moneyEl(night.converted_minor, quote.currency as "EUR");
      amt.className = "amt";
      const stateBlock = document.createElement("span");
      stateBlock.className = `stateblock ${night.state}`;
      stateBlock.textContent = ui("state." + night.state);
      btn.setAttribute("aria-label", `${fmt().weekdayDayMonth(night.date, zone)}, ${moneyText(night.converted_minor, quote.currency as "EUR")}`);
      btn.append(wd, amt, stateBlock);
      btn.addEventListener("click", () => {
        if (expanded === night.date) {
          expanded = null;
          render();
          btn.focus();
          return;
        }
        expanded = night.date;
        animateId(col, "night-expand", [{ flex: "1 0 90px" }, { flex: "2.4 0 240px" }], { duration: 320, fill: "forwards" });
        render();
        btn.focus();
      });
      col.appendChild(btn);
      if (expanded === night.date) {
        const lines = document.createElement("ul");
        lines.className = "price-lines";
        lines.setAttribute("role", "list");
        lines.setAttribute("aria-label", ui("strip.lines"));
        const nightLines = quote.rooms.flatMap((r) => r.nights[i]?.lines ?? []);
        const merged = new Map<string, number>();
        for (const l of nightLines) merged.set(l.key, (merged.get(l.key) ?? 0) + l.minor);
        for (const [key, minor] of merged) {
          const li = document.createElement("li");
          li.dataset.minor = String(minor);
          li.dataset.currency = "EUR";
          const label = document.createElement("span");
          label.textContent = ui("line." + key);
          const amount = document.createElement("span");
          amount.textContent = moneyText(minor, "EUR");
          li.append(label, amount);
          lines.appendChild(li);
        }
        col.appendChild(lines);
      }
      strip.appendChild(col);
    });
  };
  render();

  strip.addEventListener("keydown", (e) => {
    const rtl = document.documentElement.lang === "ar";
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const btns = [...strip.querySelectorAll<HTMLButtonElement>("button")];
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
    let next = idx;
    if (e.key === "ArrowRight") next = idx + (rtl ? -1 : 1);
    else if (e.key === "ArrowLeft") next = idx + (rtl ? 1 : -1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = btns.length - 1;
    if (next >= 0 && next < btns.length) {
      btns[next].focus();
      status("search-announcements", btns[next].getAttribute("aria-label") ?? "");
    }
  });
  strip.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expanded) {
      e.preventDefault();
      expanded = null;
      render();
      (document.activeElement as HTMLElement)?.focus();
    }
  });
}
