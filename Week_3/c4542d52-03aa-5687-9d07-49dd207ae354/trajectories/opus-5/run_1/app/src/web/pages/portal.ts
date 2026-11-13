import type {
  Grant,
  LiveEvent,
  PortalBoardMember,
  PortalFounderAdmin,
  PortalInvestor,
  PortalLeaver,
  PortalOptionHolder,
} from "../../shared/types.js";
import { formatCount, formatCountdown, formatDate, formatInstant } from "../../shared/format.js";
import { api } from "../api.js";
import { signedInAs, type Page, type PageContext } from "../app.js";
import { clear, el } from "../dom.js";
import { serverNow } from "../live.js";
import { offerWarningStrip, windowWarningStrip } from "../warnings.js";

function photoTiles(): HTMLElement {
  return el("div", { class: "tile tile-photos" }, [
    el("img", { src: "/photos/robot-arms.jpg", alt: "", class: "tile-photo" }),
    el("img", { src: "/photos/workbench.jpg", alt: "", class: "tile-photo" }),
  ]);
}

function nameTile(firstName: string): HTMLElement {
  return el("div", { class: "tile name-tile" }, [el("h1", { class: "giant" }, [firstName])]);
}

function darkTile(children: Array<Node | string>): HTMLElement {
  return el("div", { class: "tile tile-dark" }, children);
}

function redTile(children: Array<Node | string>): HTMLElement {
  return el("div", { class: "tile tile-red" }, children);
}

export function portalPage(context: PageContext): Page {
  let countdownNode: HTMLElement | null = null;
  let windowEndsAt: string | null = null;

  async function draw(): Promise<void> {
    const me = signedInAs();
    clear(context.main);
    const now = serverNow();
    let grants: Grant[] = [];
    if (me.role === "option_holder" || me.role === "leaver") {
      const result = await api<{ grants: Grant[] }>("/api/grants");
      grants = result.grants;
    }

    const tiles: HTMLElement[] = [];
    if (me.role === "option_holder") {
      const portal = await api<PortalOptionHolder>("/api/portal");
      tiles.push(
        nameTile(portal.first_name),
        darkTile([
          el("span", { class: "tile-label" }, ["Vested today:"]),
          el("span", { class: "display-figure" }, [
            `${formatCount(portal.vested_today)} of ${formatCount(portal.total_options)}`,
          ]),
        ]),
        redTile([
          portal.next_tranche_date === null
            ? el("span", { class: "display-figure" }, ["Fully vested"])
            : el("span", { class: "display-figure" }, [`Next tranche ${formatDate(portal.next_tranche_date)}`]),
        ]),
        photoTiles(),
      );
    } else if (me.role === "leaver") {
      const portal = await api<PortalLeaver>("/api/portal");
      windowEndsAt = portal.window_ends_at;
      const remaining =
        portal.window_ends_at === null ? 0 : new Date(portal.window_ends_at).getTime() - now.getTime();
      countdownNode = el("div", { role: "timer", "aria-label": "Exercise window", class: "display-figure" }, [
        remaining > 0 ? `${formatCountdown(remaining)} left` : "Window closed",
      ]);
      tiles.push(
        nameTile(portal.first_name),
        darkTile([
          el("span", { class: "tile-label" }, ["Exercisable now:"]),
          el("span", { class: "display-figure" }, [formatCount(portal.exercisable)]),
        ]),
        redTile([countdownNode]),
        photoTiles(),
      );
    } else if (me.role === "investor") {
      const portal = await api<PortalInvestor>("/api/portal");
      tiles.push(
        nameTile(portal.first_name),
        darkTile([
          el("span", { class: "tile-label" }, ["Your fully diluted ownership:"]),
          el("span", { class: "display-figure" }, [`${portal.ownership}%`]),
        ]),
        redTile([
          el("span", { class: "display-figure" }, [
            portal.open_tender === null
              ? "No tender open"
              : `Tender open until ${formatInstant(portal.open_tender.closes_at)}`,
          ]),
        ]),
        photoTiles(),
      );
    } else if (me.role === "board_member") {
      const portal = await api<PortalBoardMember>("/api/portal");
      tiles.push(
        nameTile(portal.first_name),
        darkTile([
          el("span", { class: "tile-label" }, ["Grants awaiting your vote:"]),
          el("span", { class: "display-figure" }, [formatCount(portal.awaiting_vote)]),
        ]),
        redTile([
          el("span", { class: "display-figure" }, [`Quorum ${portal.quorum} of ${portal.board_size}`]),
        ]),
        photoTiles(),
      );
    } else {
      const portal = await api<PortalFounderAdmin>("/api/portal");
      tiles.push(
        nameTile(portal.first_name),
        darkTile([
          el("span", { class: "tile-label" }, ["Fully diluted:"]),
          el("span", { class: "display-figure" }, [formatCount(portal.fully_diluted_total)]),
        ]),
        redTile([el("span", { class: "display-figure" }, [`Offers to send: ${formatCount(portal.offers_to_send)}`])]),
        photoTiles(),
      );
    }

    const offerStrip = offerWarningStrip(grants, now);
    if (offerStrip !== null) context.main.append(offerStrip);
    const windowStrip = me.role === "leaver" ? windowWarningStrip(me, grants, now) : null;
    if (windowStrip !== null) context.main.append(windowStrip);
    context.main.append(el("section", { class: "portal-board", role: "region", "aria-label": "Portal board" }, tiles));
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "clock") {
        if (countdownNode !== null && windowEndsAt !== null) {
          const remaining = new Date(windowEndsAt).getTime() - serverNow().getTime();
          countdownNode.textContent = remaining > 0 ? `${formatCountdown(remaining)} left` : "Window closed";
        }
        return;
      }
      if (
        event.type === "offer_warning" ||
        event.type === "window_warning" ||
        event.type === "grant_changed" ||
        event.type === "order_changed" ||
        event.type === "cap_table" ||
        event.type === "window_closed" ||
        event.type === "tranche_vested" ||
        event.type === "tender_changed" ||
        event.type === "tender_closed" ||
        event.type === "tender_allocated"
      ) {
        void draw();
      }
    },
  };
}
