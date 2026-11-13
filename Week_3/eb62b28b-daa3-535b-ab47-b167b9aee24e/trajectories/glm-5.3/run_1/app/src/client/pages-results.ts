import { el, api } from "./dom.js";
import { memberShell, type MemberSelf } from "./pages-member.js";
import { DURATIONS, animate, prefersReducedMotion } from "./motion.js";
import { zoneFor, cityFor } from "./zones.js";
import { DateTime } from "luxon";
import { FLAG_LABEL } from "../shared/enums.js";
import { dec } from "../shared/money.js";

type MarkerResults = {
  marker: string;
  name: string;
  category: string;
  unit: string;
  decimals: number;
  scale: { min: string; max: string };
  draws: {
    drawId: string;
    collectedAt: string;
    resultId: string;
    value: string;
    flag: string;
    ageBand: string;
    range: { low: string; high: string; optimalLow: string; optimalHigh: string; effectiveFrom: string };
    note: string | null;
    correctedBy: string | null;
    correctedAt: string | null;
  }[];
};

const CATEGORY_NAMES: Record<string, string> = {
  metabolic: "Metabolic",
  heart: "Heart",
  hormones: "Hormones",
  kidneyLiver: "Kidney and liver",
  nutrients: "Nutrients",
  inflammationBlood: "Inflammation and blood",
};

const CATEGORY_ORDER = ["metabolic", "heart", "hormones", "kidneyLiver", "nutrients", "inflammationBlood"];

export async function markerBandPage(member: MemberSelf, staffView = false): Promise<HTMLElement> {
  const path = staffView ? "" : "/api/me/results";
  const result = await api<{ markers: MarkerResults[] }>(path);
  const markers = result.ok ? result.data.markers : [];
  const main = el("main", { class: "page results-page" });
  main.append(el("h1", { class: "page-title" }, staffView ? "Results" : "Your results"));

  const groups = new Map<string, MarkerResults[]>();
  for (const categoryId of CATEGORY_ORDER) {
    const inCategory = markers.filter((marker) => marker.category === categoryId);
    if (inCategory.length > 0) groups.set(categoryId, inCategory);
  }

  for (const [categoryId, inCategory] of groups) {
    const heading = el("h2", { class: "results-category" }, CATEGORY_NAMES[categoryId] ?? categoryId);
    main.append(heading);
    for (const marker of inCategory) {
      main.append(markerCard(member, marker));
    }
  }

  const message = el("a", { href: "/me/messages", class: "button primary" }, "Message your care team");
  return memberShell(member, main, message, "/me/results");
}

function markerCard(member: MemberSelf, marker: MarkerResults): HTMLElement {
  const card = el("section", { class: "card marker-card", role: "region", "aria-label": marker.name });
  card.append(el("h3", { class: "marker-name" }, marker.name));

  const zone = zoneFor(member.timeZone ?? "phoenix");
  const city = cityFor(member.timeZone ?? "phoenix");

  // Band
  const band = el("div", { class: "band" });
  const zonesWrap = el("div", { class: "band-zones" });
  const dot = el("div", { class: "band-dot", "data-part": "dot" });
  const trend = el("div", { class: "band-trend", "data-part": "trend" });
  band.append(zonesWrap, trend, dot);

  const value = el("p", { class: "marker-value", "data-part": "value" });
  const flagLabel = el("p", { class: "marker-flag" });

  // Stations
  let selected = marker.draws.length - 1;
  const stations = el("div", {
    class: "stations",
    role: "listbox",
    "aria-label": `Draws for ${marker.name}`,
    tabindex: "0",
  });

  const popoverHost = el("div", { class: "popover-host" });
  let popoverOpen = false;

  const zoneWidth = (range: MarkerResults["draws"][number]["range"], scale: MarkerResults["scale"]): { below: number; inRange: number; optimal: number; above: number } => {
    const min = dec(scale.min);
    const max = dec(scale.max);
    const span = max.minus(min);
    if (span.lte(dec(0))) return { below: 0, inRange: 100, optimal: 0, above: 0 };
    const pct = (v: string) => dec(v).minus(min).dividedBy(span).times(100).toDecimalPlaces(2).toNumber();
    const low = pct(range.low);
    const high = pct(range.high);
    const optimalLow = pct(range.optimalLow);
    const optimalHigh = pct(range.optimalHigh);
    return {
      below: low,
      inRange: Math.max(0, high - low),
      optimal: Math.max(0, optimalHigh - optimalLow),
      above: Math.max(0, 100 - high),
    };
  };

  const render = (animateMotion: boolean) => {
    const draw = marker.draws[selected];
    if (!draw) return;
    // Zones
    const widths = zoneWidth(draw.range, marker.scale);
    zonesWrap.replaceChildren(
      el("div", { class: "zone zone-below", "data-part": "zone", "data-zone": "below", style: `width:${widths.below}%` }),
      el("div", { class: "zone zone-inrange", "data-part": "zone", "data-zone": "inRange", style: `width:${widths.inRange}%` }),
      el("div", { class: "zone zone-above", "data-part": "zone", "data-zone": "above", style: `width:${widths.above}%` }),
      el("div", {
        class: "zone zone-optimal",
        "data-part": "zone",
        "data-zone": "optimal",
        style: `left:${widths.below + widths.inRange * pctOf(draw.range.optimalLow, marker.scale)}%; width:${widths.optimal}%`,
      })
    );
    // Dot position
    const dotPercent = pctOf(draw.value, marker.scale);
    if (animateMotion && !prefersReducedMotion()) {
      dot.style.transition = "none";
      animate(dot, [{ left: `${dotPercent}%` }], DURATIONS.medium);
      dot.style.left = `${dotPercent}%`;
      // Value roll
      const old = value.firstElementChild as HTMLElement | null;
      const fresh = el("span", {}, `${draw.value} ${marker.unit}`);
      if (old) {
        old.style.position = "absolute";
        old.style.inset = "0";
        old.animate([{ transform: "translateY(0)" }, { transform: "translateY(-100%)", opacity: "0" }], { duration: DURATIONS.medium, easing: "ease", fill: "forwards" });
        fresh.style.position = "absolute";
        fresh.style.inset = "0";
        fresh.animate([{ transform: "translateY(100%)", opacity: "0" }, { transform: "translateY(0)", opacity: "1" }], { duration: DURATIONS.medium, easing: "ease", fill: "forwards" });
        value.append(fresh);
        window.setTimeout(() => {
          old.remove();
          fresh.style.position = "";
          fresh.style.inset = "";
        }, DURATIONS.medium);
      } else {
        value.replaceChildren(fresh);
      }
    } else {
      dot.style.left = `${dotPercent}%`;
      value.replaceChildren(el("span", {}, `${draw.value} ${marker.unit}`));
    }
    flagLabel.textContent = FLAG_LABEL[draw.flag as keyof typeof FLAG_LABEL] ?? draw.flag;

    // Stations
    stations.replaceChildren();
    marker.draws.forEach((entry, index) => {
      const option = el("div", {
        class: "station",
        role: "option",
        "aria-selected": String(index === selected),
        "data-state": index === selected ? "selected" : index < selected ? "earlier" : "later",
        "data-at": entry.collectedAt,
        tabindex: "-1",
        id: `station-${marker.marker}-${index}`,
      }, formatDateShort(entry.collectedAt, zone));
      option.addEventListener("click", () => {
        if (selected === index) {
          openPopover(entry, option);
        } else {
          selected = index;
          render(true);
          stations.focus();
        }
      });
      stations.append(option);
    });
  };

  const openPopover = (draw: MarkerResults["draws"][number], station: HTMLElement) => {
    if (popoverOpen) return;
    popoverOpen = true;
    const dialog = el("dialog", { class: "popover", "aria-label": `Draw on ${formatDateShort(draw.collectedAt, zone)}` });
    const heading = el("h4", { class: "popover-title" }, `Draw on ${formatDateShort(draw.collectedAt, zone)}`);
    const close = el("button", { type: "button", class: "dialog-close", "aria-label": "Close" }, "Close");
    const body = el("div", { class: "popover-body" });
    body.append(el("p", {}, `Collected ${formatInstantLocal(draw.collectedAt, zone, city)}`));
    body.append(el("p", {}, `Value ${draw.value} ${marker.unit}`));
    body.append(el("p", {}, `Flag ${FLAG_LABEL[draw.flag as keyof typeof FLAG_LABEL] ?? draw.flag}`));
    body.append(el("p", {}, `Range in force ${draw.range.low}–${draw.range.high} (optimal ${draw.range.optimalLow}–${draw.range.optimalHigh}) from ${draw.range.effectiveFrom}`));
    if (draw.note) body.append(el("p", {}, `Specialist note ${draw.note}`));
    if (draw.correctedBy && draw.correctedAt) {
      body.append(el("p", {}, `${draw.correctedBy} corrected this result at ${formatInstantLocal(draw.correctedAt, "America/Phoenix", "Phoenix")}`));
    }
    dialog.append(heading, close, body);
    popoverHost.append(dialog);
    dialog.showModal();
    animate(dialog, [{ opacity: "0" }, { opacity: "1" }], DURATIONS.short);
    const closeIt = () => {
      if (prefersReducedMotion()) {
        dialog.close();
        dialog.remove();
        popoverOpen = false;
        station.focus();
        return;
      }
      const animation = animate(dialog, [{ opacity: "1" }, { opacity: "0" }], DURATIONS.short);
      animation?.finished.finally(() => {
        dialog.close();
        dialog.remove();
        popoverOpen = false;
        station.focus();
      });
    };
    close.addEventListener("click", closeIt);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeIt();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeIt();
      }
    });
  };

  stations.addEventListener("keydown", (event) => {
    const isNarrow = window.innerWidth < 600;
    let next = selected;
    if (event.key === "ArrowLeft") next = Math.max(0, selected - 1);
    else if (event.key === "ArrowRight") next = Math.min(marker.draws.length - 1, selected + 1);
    else if (isNarrow && event.key === "ArrowUp") next = Math.max(0, selected - 1);
    else if (isNarrow && event.key === "ArrowDown") next = Math.min(marker.draws.length - 1, selected + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = marker.draws.length - 1;
    else if (event.key === "Enter") {
      event.preventDefault();
      const option = stations.children[selected] as HTMLElement | undefined;
      if (option) openPopover(marker.draws[selected] ?? marker.draws[0]!, option);
      return;
    } else {
      return;
    }
    if (next !== selected) {
      event.preventDefault();
      selected = next;
      render(true);
    }
  });

  const stack = el("div", { class: "marker-stack" });
  stack.append(el("div", { class: "marker-head" }, value, flagLabel), band);
  card.append(stack, stations, popoverHost);
  render(false);
  return card;
}

function pctOf(value: string, scale: { min: string; max: string }): number {
  const min = dec(scale.min);
  const max = dec(scale.max);
  const span = max.minus(min);
  if (span.lte(dec(0))) return 50;
  return dec(value).minus(min).dividedBy(span).times(100).toDecimalPlaces(2).toNumber();
}

function formatDateShort(instant: string, zone: string): string {
  return DateTime.fromISO(instant, { zone }).toFormat("ccc dd MMM yyyy");
}

function formatInstantLocal(instant: string, zone: string, city: string): string {
  return `${DateTime.fromISO(instant, { zone }).toFormat("ccc dd MMM yyyy, HH:mm")} ${city} time`;
}

