import { data, type Screen } from "../app.js";
import { copy } from "../copy.js";
import { clear, el } from "../dom.js";
import { CatalogueGrid } from "../grid.js";
import { groundOf, portrait } from "../portrait.js";
import type { Frame, Lot, Sale } from "../types.js";
import { emptyState } from "./simple.js";

/** The home poster: the sale title pinned over the first six lots. */
export const homeScreen: Screen = (app) => {
  const sale = data<Sale | null>(app, "sale", null);
  let lots = data<Lot[]>(app, "lots", []);
  clear(app.root);
  app.root.className = "page page-home";
  if (!sale) {
    app.root.append(emptyState(copy.noSaleLine, copy.noSaleSentence));
    return;
  }

  const posterLots = [...lots]
    .sort((a, b) => (a.lot_number ?? 0) - (b.lot_number ?? 0))
    .slice(0, 6);
  const foot = el("div", { class: "poster-foot" }, [
    el("p", { class: "poster-line", text: copy.homeLine }),
    el("a", { class: "action", href: "/catalogue", text: "View the catalogue" }),
  ]);
  const strip = el("div", { class: "poster-strip" });
  posterLots.forEach((lot, index) => {
    const lotNumber = lot.lot_number ?? 0;
    strip.append(
      el("figure", { class: "poster-lot", style: `background:${groundOf(lot.portrait)}` }, [
        portrait(lot.portrait, `Lot ${lotNumber}, ${lot.title}`, "portrait"),
        el("figcaption", {
          class: "poster-caption",
          text: copy.posterCaption(lotNumber, lot.estimate_low ?? 0, lot.estimate_high ?? 0),
        }),
      ]),
    );
    // On a phone the line and the action stack under the first portrait; on
    // wider screens they sit at the bottom of the first screen.
    if (index === 0) strip.append(foot);
  });

  const gridHost = el("div", {});
  app.root.append(
    el("section", { class: "poster" }, [
      el("div", { class: "poster-pin" }, [el("h1", { class: "poster-title", text: sale.title })]),
      strip,
    ]),
    el("section", { class: "home-release" }, [
      el("h2", { text: "Closing soonest" }),
      gridHost,
    ]),
  );

  const grid = new CatalogueGrid(gridHost, () => undefined);
  const paint = () => grid.setLots(lots.slice(0, 12));
  paint();

  return (frame: Frame) => {
    if (frame.type === "notice") {
      app.say.notice(frame.notice.id, frame.notice.kind, frame.notice.text);
      return;
    }
    lots = mergeLot(lots, frame.lot as unknown as Lot);
    paint();
  };
};

/** mergeLot keeps the catalogue in the server's closing-soonest order. */
export const mergeLot = (lots: Lot[], next: Lot): Lot[] => {
  if (!lots.some((lot) => lot.id === next.id)) return lots;
  const merged = lots.map((lot) => (lot.id === next.id ? next : lot));
  const live = (lot: Lot) => lot.status === "open" || lot.status === "extended";
  return merged.sort((a, b) => {
    if (live(a) !== live(b)) return live(a) ? -1 : 1;
    if (live(a)) {
      const left = a.closes_at ?? "";
      const right = b.closes_at ?? "";
      if (left !== right) return left < right ? -1 : 1;
    }
    return (a.lot_number ?? 0) - (b.lot_number ?? 0);
  });
};
