// The three stamp-cards — Postbox, Depot board, Satchel — and their phone tabs and sheets.

import { h } from "../dom.js";
import { icon } from "../dom.js";
import type { ResidentSeed, SatchelSeed } from "../../shared/seed.js";

export type Me = {
  role: string;
  display_name: string;
  satchel_colour: string;
  balance: number;
  email: string | null;
  name_locked: boolean;
  muted: boolean;
  satchels_owned: string[];
  open_parcel: unknown;
};

export type DepotMission = { mission_id: string; title: string; resident_id: string; reward_stamps: number; version: number; dialogue: { offer: string[] } };
export type RushRow = {
  rush_id: string; mission_id: string; slot: number; slots: number; title: string;
  resident_id: string; reward_stamps: number; version: number;
  status: "posted" | "taken" | "yours" | "delivered"; hold_expires_at: string | null;
};

export type DepotRead = {
  board_date: string;
  time_zone: string;
  rush_left: number;
  missions: DepotMission[];
  rush: RushRow[];
};

export type CardsHandle = {
  root: HTMLElement;
  postboxCard: HTMLElement;
  depotCard: HTMLElement;
  satchelCard: HTMLElement;
  tabsBar: HTMLElement;
  openTab: HTMLElement | null;
  setOpenTab(tab: "postbox" | "depot" | "satchel" | null): void;
  refreshDepot(read: DepotRead, pendingClaims: Set<string>): void;
  refreshPostbox(me: Me): void;
  refreshSatchel(me: Me, wornName: string): void;
};

export function residentById(id: string): ResidentSeed | undefined {
  return undefined; // replaced by the caller with the shared seed
}

export function createCards(parent: HTMLElement, handlers: {
  onReadMission: (m: DepotMission) => void;
  onClaim: (r: RushRow) => void;
  onOutfitter: () => void;
  onHistory: () => void;
  onClaimSave: () => void;
  onSaveName: (name: string) => void;
  onSignOut: () => void;
  onDrop: () => void;
}): CardsHandle {
  // Postbox card
  const nameInput = h("input", { type: "text", class: "field", maxlength: "60" }) as HTMLInputElement;
  const nameSave = h("button", { class: "btn btn-small", onclick: () => handlers.onSaveName(nameInput.value) }, "Save name");
  const postboxBody = h("div", { class: "card-body" });
  const postboxCard = h(
    "aside",
    { role: "complementary", "aria-label": "Postbox", class: "stamp-card postbox-card" },
    h("h2", { class: "card-heading" }, "Postbox"),
    postboxBody,
  );

  // Depot board card
  const depotList = h("div", { class: "card-body depot-body" });
  const depotCard = h(
    "aside",
    { role: "complementary", "aria-label": "Depot board", class: "stamp-card depot-card" },
    h("h2", { class: "card-heading" }, "Depot board"),
    depotList,
  );

  // Satchel card
  const satchelBody = h("div", { class: "card-body" });
  const satchelCard = h(
    "aside",
    { role: "complementary", "aria-label": "Satchel", class: "stamp-card satchel-card" },
    h("h2", { class: "card-heading" }, "Satchel"),
    satchelBody,
  );

  const tabsBar = h("div", { class: "card-tabs", "aria-hidden": "true" });
  const root = h("div", { class: "cards-root" });
  root.append(tabsBar, postboxCard, depotCard, satchelCard);
  parent.append(root);
  void nameInput;
  void nameSave;
  void icon;

  return {
    root,
    postboxCard,
    depotCard,
    satchelCard,
    tabsBar,
    openTab: null,
    setOpenTab(tab) {
      this.openTab = tab ? (tab === "postbox" ? postboxCard : tab === "depot" ? depotCard : satchelCard) : null;
      for (const card of [postboxCard, depotCard, satchelCard]) card.classList.remove("is-open-sheet");
      if (this.openTab) this.openTab.classList.add("is-open-sheet");
      for (const btn of tabsBar.querySelectorAll("button")) {
        btn.setAttribute("aria-expanded", String(btn.getAttribute("data-tab") === tab));
      }
    },
    refreshDepot(read, pendingClaims) {
      depotList.replaceChildren();
      const heading = h("h3", { class: "rush-heading" }, `Rush board · ${read.board_date} · ${read.rush_left} left`);
      depotList.append(heading);
      const rushList = h("ul", { class: "rush-list" });
      for (const row of read.rush) {
        const li = h("li", { class: "rush-row", "data-rush-id": row.rush_id });
        const meta = h("span", { class: "rush-meta" }, `Parcel ${row.slot} of ${row.slots} · ${row.title}`);
        li.append(meta);
        if (row.status === "posted") {
          const claiming = pendingClaims.has(row.rush_id);
          const btn = h(
            "button",
            {
              class: "btn btn-small btn-rush",
              onclick: () => handlers.onClaim(row),
              "aria-disabled": claiming ? "true" : null,
              disabled: claiming ? "" : null,
            },
            claiming ? "Claiming…" : "Claim",
          );
          btn.setAttribute("aria-label", `Claim ${row.title}, parcel ${row.slot} of ${row.slots}`);
          li.append(btn);
        } else if (row.status === "taken") {
          li.append(h("span", { class: "rush-state" }, "Taken"));
        } else if (row.status === "yours") {
          li.append(h("span", { class: "rush-state is-yours" }, "Yours"));
        } else {
          li.append(h("span", { class: "rush-state is-delivered" }, "Delivered"));
        }
        rushList.append(li);
      }
      depotList.append(rushList);
      if (read.missions.length > 0) {
        depotList.append(h("h3", { class: "missions-heading" }, "Letters"));
        const missionList = h("ul", { class: "mission-list" });
        for (const mission of read.missions) {
          missionList.append(
            h("li", { class: "mission-row" },
              h("button", { class: "btn btn-ghost", onclick: () => handlers.onReadMission(mission) }, `Read ${mission.title}`),
              h("span", { class: "mission-reward" }, `+${mission.reward_stamps} stamps`),
            ),
          );
        }
        depotList.append(missionList);
      }
    },
    refreshPostbox(me) {
      postboxBody.replaceChildren();
      postboxBody.append(h("p", { class: "card-line card-name" }, me.display_name));
      const nameRow = h("div", { class: "card-line name-row" });
      const input = h("input", { type: "text", class: "field field-name", value: me.display_name, maxlength: "60", "aria-label": "Display name" }) as HTMLInputElement;
      nameRow.append(input, h("button", { class: "btn btn-small", onclick: () => handlers.onSaveName(input.value) }, "Save name"));
      postboxBody.append(nameRow);
      if (me.role === "guest") {
        postboxBody.append(
          h("div", { class: "card-line" },
            h("button", { class: "btn btn-small", onclick: () => handlers.onClaimSave() }, "Claim this save"),
          ),
        );
      } else {
        postboxBody.append(h("p", { class: "card-line card-email" }, me.email ?? ""));
        postboxBody.append(h("div", { class: "card-line" }, h("button", { class: "btn btn-small", onclick: () => handlers.onSignOut() }, "Sign out")));
      }
    },
    refreshSatchel(me, wornName) {
      satchelBody.replaceChildren();
      satchelBody.append(h("p", { class: "card-line" }, `Wearing ${wornName}`));
      if (me.open_parcel) {
        satchelBody.append(h("div", { class: "card-line" }, h("button", { class: "btn btn-small", onclick: () => handlers.onDrop() }, "Drop parcel")));
      }
      satchelBody.append(
        h("div", { class: "card-line satchel-buttons" },
          h("button", { class: "btn btn-small", onclick: () => handlers.onOutfitter() }, "Outfitter"),
          h("button", { class: "btn btn-small", onclick: () => handlers.onHistory() }, "Stamp history"),
        ),
      );
    },
  };
}

export function satchelName(id: string, seeds: readonly SatchelSeed[]): string {
  return seeds.find((s) => s.satchel_id === id)?.name ?? id;
}
