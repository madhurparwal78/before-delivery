// Open seats screen: offer cards with per-seat claim buttons.
import { api, ApiCallError, el, formatRange, parseInstant } from "../lib";
import { pollWhileConnected, statusRegion } from "../components";
import { App } from "../main";
import type { HolderAssignmentView, OfferAssignmentView } from "../types";
import { languageName } from "./drawer";

export function renderOffers(app: App): void {
  const main = app.main;
  const list = el("ul", { "aria-label": "Open seats", class: "cards" });
  const claimStatus = statusRegion("Claim status");
  main.append(
    el("h1", { text: "Open seats" }),
    claimStatus.el,
    list,
  );

  const renderOffersList = (): void => {
    api<{ offers: OfferAssignmentView[] }>("GET", "/api/offers").then((res) => {
      list.replaceChildren();
      for (const offer of res.offers) {
        list.append(buildCard(offer));
      }
    }).catch(() => {
      claimStatus.set("Open seats not updating. Retrying…");
    });
  };

  const buildCard = (offer: OfferAssignmentView): HTMLLIElement => {
    const card = el("li", { class: "card" });
    card.append(
      el("h3", {}, el("span", { class: "num", text: offer.number }), ` — ${languageName(offer.language)}`),
      el("p", { text: `${offer.setting} · ${offer.city}` }),
      el("p", { text: formatRange(parseInstant(offer.start_at)!, parseInstant(offer.end_at)!) }),
      el("p", { text: `${offer.duration_minutes} min` }),
    );
    const lanes = el("div", { class: "lanes", style: "margin: 10px 0;" });
    const claims = el("div", { class: "two-col", style: "margin-top: 10px;" });
    for (const seat of offer.seats) {
      const open = seat.status === "open";
      const lane = el("div", { role: "group", "aria-label": `Seat ${seat.seat}`, class: `lane ${open ? "hatched" : "held"}` });
      if (!open) lane.append(el("div", { class: "fill" }));
      const initials = (seat as { interpreter_initials?: string | null }).interpreter_initials;
      lane.append(el("span", { class: "label", text: open ? "open" : (initials ?? "taken") }));
      lanes.append(lane);
      if (open) {
        const lossNote = el("span", {});
        const btn = el("button", {
          class: "btn",
          text: `Claim seat ${seat.seat} on ${offer.number}`,
          onclick: async () => {
            btn.disabled = true;
            claimStatus.set("Claiming…");
            try {
              const held = await api<HolderAssignmentView>("POST", `/api/assignments/${offer.number}/seats/${seat.seat}/claim`, {});
              void held;
              claimStatus.set(`Seat ${seat.seat} on ${offer.number} is yours. Details are in My seats.`);
              renderOffersList();
            } catch (err) {
              btn.disabled = false;
              if (err instanceof ApiCallError) {
                if (err.code === "seat_taken") {
                  claimStatus.set("Seat already taken");
                  lossNote.textContent = "Seat already taken";
                  renderOffersList();
                } else if (err.code === "already_holding") {
                  claimStatus.set("You already hold a seat on this request.");
                } else if (err.code === "calendar_conflict") {
                  claimStatus.set("This overlaps a seat you already hold.");
                } else {
                  claimStatus.set("Couldn't reach Teamseat. Try again.");
                }
              } else {
                claimStatus.set("Couldn't reach Teamseat. Try again.");
              }
            }
          },
        });
        claims.append(el("div", {}, btn, lossNote));
      }
    }
    card.append(lanes, claims);
    return card;
  };

  void app;
  renderOffersList();
  pollWhileConnected(main, renderOffersList);
}
