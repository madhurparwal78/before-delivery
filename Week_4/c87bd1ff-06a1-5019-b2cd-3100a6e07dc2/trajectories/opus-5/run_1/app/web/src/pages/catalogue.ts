import { data, type Screen } from "../app.js";
import { copy } from "../copy.js";
import { clear, el, isWide, reducedMotion } from "../dom.js";
import { CatalogueGrid } from "../grid.js";
import { groundOf, portrait } from "../portrait.js";
import type { Frame, Lot, Sale } from "../types.js";
import { emptyState } from "./simple.js";
import { mergeLot } from "./home.js";

/** The catalogue: a split poster on wide screens, tiles on smaller ones. */
export const catalogueScreen: Screen = (app) => {
  const sale = data<Sale | null>(app, "sale", null);
  let lots = data<Lot[]>(app, "lots", []);
  clear(app.root);
  app.root.className = "page page-catalogue";
  if (!sale) {
    app.root.append(emptyState(copy.noSaleLine, copy.noSaleSentence));
    return;
  }

  const posterArt = el("div", { class: "catalogue-poster-art" });
  const gridHost = el("div", {});
  app.root.append(
    el("div", { class: "catalogue-aside" }, [
      el("h1", { class: "catalogue-title", text: sale.title }),
      posterArt,
    ]),
    el("div", { class: "catalogue-main" }, [gridHost]),
  );

  let shownPortrait = "";
  const swapPoster = (lot: Lot) => {
    if (!isWide() || shownPortrait === lot.id) return;
    shownPortrait = lot.id;
    const art = portrait(lot.portrait, null, "portrait");
    const holder = el("div", {
      class: "catalogue-poster-layer",
      style: `background:${groundOf(lot.portrait)}`,
    });
    holder.append(art);
    clear(posterArt);
    posterArt.append(holder);
    if (reducedMotion()) return;
    const fade = holder.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    fade.finished.then(() => fade.cancel()).catch(() => undefined);
  };

  const grid = new CatalogueGrid(gridHost, swapPoster);
  const paint = () => grid.setLots(lots);
  paint();
  if (lots.length > 0) swapPoster(lots[0]);

  return (frame: Frame) => {
    if (frame.type === "notice") {
      app.say.notice(frame.notice.id, frame.notice.kind, frame.notice.text);
      return;
    }
    lots = mergeLot(lots, frame.lot as unknown as Lot);
    paint();
  };
};
