// Parcel Moon: the game screen. One frame loop drives the courier, the camera rigs, the Horizon
// thread, other couriers and every timed overlay from the page clock, and writes the scene's
// state to the Bramble, Route, compass and balance regions. The screen only shows a parcel, a
// delivery or a win once the server has answered.
import "../styles/game.css";
import { Vector3 } from "three";
import { checkDisplayName } from "../../shared/names";
import { compassLabel, unitVector, type LatLon } from "../../shared/geo";
import { errorCode, get, NetworkFailure, newTicket, send, sendRetrying, serverNow, type Answer } from "../lib/api";
import { anyModalOpen, closeDialog, openDialog, type OpenDialog } from "../lib/dialogs";
import { fixed, focusables, h, setData, setText } from "../lib/dom";
import { clamp01, easeInOut, easePrint, now, onReducedMotionChange, pageHidden, reducedMotion } from "../lib/motion";
import { Notices } from "../lib/notices";
import { paper } from "../lib/paper";
import { Figures, type PresenceEntry } from "./figures";
import { Compass, iconButton, makeCard, makeTab, textButton } from "./hud";
import { Letter } from "./letters";
import { ModerationDrawer } from "./moderation";
import { PhotoMode } from "./photo";
import { BrambleScene, type ResidentHome } from "./scene";
import { routeFrom, Thread, type ThreadFrame } from "./thread";
import {
  blendLinear,
  CameraTween,
  clonePose,
  followPose,
  introPose,
  photoPose,
  RADIUS,
  Walker,
  type Pose,
} from "./world";

// ---- types from the API ----

interface Parcel {
  acceptance_id: string;
  mission_id: string;
  version: number;
  title: string;
  reward_stamps: number;
  resident: { resident_id: string; name: string; home: string };
  rush_id: string | null;
  hold_expires_at: string | null;
  route: { route_id: string; door: LatLon; total_arc_m: number; initial_bearing_deg: number };
  dialogue: { offer: string[] };
}

interface Me {
  role: "guest" | "courier" | "helper" | "founder";
  display_name: string;
  satchel_colour: string;
  balance: number;
  email: string | null;
  name_locked: boolean;
  muted: boolean;
  satchels_owned: string[];
  open_parcel: Parcel | null;
}

interface DepotMission {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  version: number;
  dialogue: { offer: string[] };
}

interface RushRow {
  rush_id: string;
  mission_id: string;
  slot: number;
  slots: number;
  title: string;
  resident_id: string;
  reward_stamps: number;
  version: number;
  status: "posted" | "taken" | "yours" | "delivered";
  hold_expires_at: string | null;
}

interface Depot {
  board_date: string;
  time_zone: string;
  rush_left: number;
  missions: DepotMission[];
  rush: RushRow[];
}

interface Postcard {
  postcard_id: string;
  share_url: string;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
}

interface Delivery {
  stamps_awarded: number;
  balance: number;
  dialogue: { thanks: string[] };
}

interface History {
  balance: number;
  movements: Array<{ kind: string; created_at: string; entries: Array<{ amount: number }> }>;
  next_cursor: string | null;
}

interface Satchel {
  satchel_id: string;
  name: string;
  price: number;
  colour: string;
  owned: boolean;
  worn: boolean;
}

const SATCHEL_NAMES: Record<string, string> = {
  canvas: "Canvas Satchel",
  "riso-pink": "Riso Pink Satchel",
  sunpatch: "Sunpatch Satchel",
  "night-ink": "Night Ink Satchel",
  tidewater: "Tidewater Satchel",
};

const INTRO_MS = 1500;
const SETTLE_MS = 400;
const TRAIL_S = 0.1;
const PRESS_MS = 250;
const GLOW_MS = 500;
const BOARD_MS = 10_000;
const PRESENCE_MS = 1000;
const EMOTE_MS = 4000;
const CLOUD_DPS = 4;
const INTERNAL = "Something went wrong on Bramble.";

const localTime = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

class Game {
  // ---- page ----
  private readonly root = document.getElementById("game")!;
  private readonly notices = new Notices();
  private readonly region = h("div", {
    role: "region",
    "aria-label": "Bramble",
    tabindex: "0",
    class: "bramble",
    "data-scene": "loading",
  });
  private readonly canvas = h("canvas", { class: "bramble-canvas", "aria-hidden": "true" });
  private readonly layer = h("div", { class: "dialog-layer" });
  private readonly compass = new Compass();
  private readonly routeStatus = h("div", {
    role: "status",
    "aria-live": "polite",
    "aria-label": "Route",
    class: "route-readout",
    "data-thread-phase": "idle",
    "data-ribbon-visible": "0.00",
    "data-ribbon-fraction": "0.00",
    "data-route-id": "",
    "data-door-screen": "",
  });
  private readonly handButton = textButton("Hand over parcel", "button-primary hand-over");
  private readonly figures = new Figures();

  // ---- cards ----
  private readonly postboxBody = h("div", { class: "card-body" });
  private readonly depotBody = h("div", { class: "card-body" });
  private readonly satchelBody = h("div", { class: "card-body" });
  private readonly postbox = makeCard("Postbox", "postbox", h("h2", { class: "card-title" }, "Postbox"), this.postboxBody);
  private readonly depotCard = makeCard("Depot board", "depot", h("h2", { class: "card-title" }, "Depot board"), this.depotBody);
  private readonly satchelCard = makeCard("Satchel", "satchel", h("h2", { class: "card-title" }, "Satchel"), this.satchelBody);
  private readonly tabs = {
    postbox: makeTab("Postbox", "postbox", "mail"),
    depot: makeTab("Depot board", "depot", "package"),
    satchel: makeTab("Satchel", "satchel", "shopping-bag"),
  };
  private sheet: { key: keyof Game["tabs"]; dialog: OpenDialog } | null = null;
  private readonly balance = h("div", {
    role: "status",
    "aria-label": "Stamp balance",
    class: "balance",
    "data-balance-shown": "0",
    "data-stamp-presses": "0",
  });
  private readonly balanceNumeral = h("span", { class: "balance-numeral", "aria-hidden": "true" }, "—");
  private readonly balanceText = h("span", { class: "visually-hidden" }, "Counting stamps…");
  private readonly wearing = h("p", { class: "wearing" });
  private readonly dropButton = textButton("Drop parcel", "button-quiet");
  private readonly outfitterButton = iconButton("shopping-bag", "Outfitter", "Outfitter");
  private readonly historyButton = iconButton("history", "Stamp history", "Stamp history");
  private readonly emoteToolbar = h("div", { role: "toolbar", "aria-label": "Emotes", class: "emotes" });
  private readonly emotesToggle = iconButton("smile", "Emotes", undefined, "emotes-toggle");
  private readonly photoButton = iconButton("camera", "Photo mode", undefined, "photo-button");
  private readonly moderationButton = iconButton("shield", "Moderation", undefined, "moderation-button");
  private readonly stick = h("div", { role: "group", "aria-label": "Move stick", class: "stick" });
  private readonly knob = h("span", { class: "stick-knob", "aria-hidden": "true" });
  private readonly jumpButton = iconButton("arrow-up", "Jump", undefined, "jump-button");

  // ---- state ----
  private me: Me | null = null;
  private depot: Depot | null = null;
  private residents: ResidentHome[] = [];
  private postcards: Postcard[] = [];
  private parcel: Parcel | null = null;
  private carrying: "none" | "standard" | "rush" = "none";
  private readonly walker = new Walker();
  private readonly thread = new Thread();
  private scene: BrambleScene | null = null;
  private sceneState: "loading" | "ready" | "no-webgl" = "loading";
  private intro: "playing" | "done" | "skipped" | "off" = "off";
  private introStart = 0;
  private cameraPose: Pose | null = null;
  private cameraLabel: "intro" | "over-shoulder" | "orbit" | "photo" = "over-shoulder";
  private follow: { pose: Pose; settled: boolean; settleStart: number; settleFrom: Pose | null } | null = null;
  private tween: { tween: CameraTween; label: "over-shoulder" | "photo" } | null = null;
  private lastFrame = now();
  private ambientSeconds = 0;
  private cloudDeg = 0;
  private walkPhase = 0;
  private keys = new Set<string>();
  private stickVector = { x: 0, y: 0 };
  private letter: Letter | null = null;
  private acceptPending = false;
  private readonly claimsPending = new Set<string>();
  private handoverTicket: { acceptance: string; ticket: string; retryBody: unknown | null } | null = null;
  private readonly lapsed = new Set<string>();
  private holdNextRead = 0;
  private shownBalance = 0;
  private presses = 0;
  private pressQueue: Array<{ balance: number; start: number }> = [];
  private glowStart = -Infinity;
  private routeTextAt = -Infinity;
  private lastPhase = "idle";
  private stream = `s${newTicket().slice(2, 26)}`;
  private seq = 0;
  private pendingEmote: string | null = null;
  private ownEmote: { name: string; at: number } | null = null;
  private presenceBusy = false;
  private readonly photo: PhotoMode;
  private readonly drawer: ModerationDrawer;
  private width = innerWidth;
  private height = innerHeight;

  constructor() {
    this.photo = new PhotoMode(this.layer, this.notices, {
      capture: (yaw, fov) =>
        this.scene ? this.scene.capture(photoPose(this.walker, yaw, fov, this.scene.blockers), this.ribbonSpan) : null,
      signedIn: () => !!this.me && this.me.role !== "guest",
      uploaded: () => void this.loadPostcards(),
      closed: () => this.leavePhoto(),
    });
    this.drawer = new ModerationDrawer(this.layer, this.notices);
    this.build();
    this.bindInput();
    onReducedMotionChange((reduced) => this.onReducedChange(reduced));
    document.addEventListener("visibilitychange", () => this.onVisibility());
    addEventListener("resize", () => this.resize());
    void this.boot();
  }

  private ribbonSpan: ThreadFrame["ribbon"] = null;

  // ---- building the page ----

  private build(): void {
    this.region.append(this.canvas);
    this.balance.append(this.balanceNumeral, h("span", { class: "balance-unit", "aria-hidden": "true" }, "stamps"), this.balanceText);
    for (const [name, label, glyph] of [
      ["wave", "Wave", "hand"],
      ["cheer", "Cheer", "party-popper"],
      ["sleepy", "Sleepy", "moon"],
      ["heart", "Heart", "heart"],
    ] as const) {
      const b = iconButton(glyph, label);
      b.addEventListener("click", () => this.emote(name));
      this.emoteToolbar.append(b);
    }
    this.stick.append(this.knob);
    this.moderationButton.hidden = true;
    const routeZone = h(
      "div",
      { class: "route-zone" },
      this.compass.el,
      this.routeStatus,
      this.handButton,
    );
    const tools = h("div", { class: "tools" }, this.emotesToggle, this.emoteToolbar, this.photoButton, this.moderationButton);
    const touch = h("div", { class: "touch" }, this.stick, this.jumpButton);
    const tabRow = h("nav", { class: "card-tabs", "aria-label": "Cards" }, this.tabs.postbox, this.tabs.depot, this.tabs.satchel);
    this.root.append(
      this.notices.el,
      tabRow,
      this.postbox,
      this.depotCard,
      this.satchelCard,
      this.region,
      this.figures.list,
      routeZone,
      tools,
      touch,
      this.layer,
    );
    this.handButton.hidden = true;
    this.handButton.addEventListener("click", () => void this.handOver());
    this.dropButton.addEventListener("click", () => void this.drop());
    this.outfitterButton.addEventListener("click", () => void this.openOutfitter());
    this.historyButton.addEventListener("click", () => void this.openHistory());
    this.photoButton.addEventListener("click", () => this.openPhoto());
    this.moderationButton.addEventListener("click", () => void this.drawer.show(this.moderationButton));
    this.emotesToggle.setAttribute("aria-expanded", "false");
    this.emotesToggle.addEventListener("click", () => {
      const open = this.emotesToggle.getAttribute("aria-expanded") !== "true";
      this.emotesToggle.setAttribute("aria-expanded", String(open));
      this.root.classList.toggle("emotes-open", open);
    });
    for (const key of ["postbox", "depot", "satchel"] as const) this.tabs[key].addEventListener("click", () => this.toggleSheet(key));
    this.renderSatchel();
    this.renderPostbox();
    this.depotBody.append(h("p", { class: "skeleton" }, "—"));
    this.updateTouchMode();
  }

  private updateTouchMode(): void {
    this.root.classList.toggle("touch-mode", matchMedia("(pointer: coarse)").matches);
  }

  private toggleSheet(key: keyof Game["tabs"]): void {
    const wasOpen = this.sheet?.key === key;
    if (this.sheet) this.closeSheet();
    if (wasOpen) return;
    const card = { postbox: this.postbox, depot: this.depotCard, satchel: this.satchelCard }[key];
    this.root.dataset.sheet = key;
    this.tabs[key].setAttribute("aria-expanded", "true");
    const dialog = openDialog({
      el: card,
      opener: this.tabs[key],
      trap: false,
      focus: focusables(card)[0] ?? this.tabs[key],
      onClose: () => {
        delete this.root.dataset.sheet;
        this.tabs[key].setAttribute("aria-expanded", "false");
        if (this.sheet?.key === key) this.sheet = null;
      },
    });
    this.sheet = { key, dialog };
  }

  private closeSheet(): void {
    if (this.sheet) closeDialog(this.sheet.dialog, false);
    this.sheet = null;
  }

  private resize(): void {
    this.width = innerWidth;
    this.height = innerHeight;
    this.scene?.resize(this.width, this.height);
    this.updateTouchMode();
    if (this.sheet && innerWidth > 600) this.closeSheet();
  }

  // ---- boot ----

  private async boot(): Promise<void> {
    this.notices.say("Packing your satchel…", true);
    // the session starts first, alongside the world and the scene
    const session = this.startSession();
    const world = await this.retryForever(() =>
      get<{ depot: LatLon; residents: Array<{ resident_id: string; name: string; home: string; door: LatLon }> }>("/api/world"),
    );
    this.residents = world.data.residents.map((r) => ({ id: r.resident_id, name: r.name, home: r.home, door: r.door }));
    try {
      this.scene = new BrambleScene(this.canvas, this.residents, world.data.depot);
      this.scene.resize(this.width, this.height);
    } catch {
      this.scene = null;
      this.sceneState = "no-webgl";
      this.region.append(
        paper(h("div", { class: "no-webgl" }, h("p", {}, "Bramble needs WebGL to draw the planet."))),
      );
    }
    requestAnimationFrame(this.frame);
    this.applyMe(await session, true);
    this.notices.clear();
    await this.refreshDepot();
    window.setInterval(() => {
      if (!pageHidden()) void this.refreshDepot();
    }, BOARD_MS);
    window.setInterval(() => {
      if (!pageHidden()) void this.presenceTick();
    }, PRESENCE_MS);
  }

  /** Reads Me; with no usable session (401) it starts a guest. */
  private async startSession(): Promise<Me> {
    const me = await this.retryForever(() => get<Me>("/api/me"));
    if (me.status !== 401) return me.data;
    return (await this.retryForever(() => send<Me>({ method: "POST", path: "/api/guest", body: {} }))).data;
  }

  /** Session start: retries every 3 seconds on a network failure. */
  private async retryForever<T>(attempt: () => Promise<Answer<T>>): Promise<Answer<T>> {
    for (;;) {
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof NetworkFailure)) throw error;
        this.notices.say("Couldn't reach the depot. Retrying…", true);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private applyMe(me: Me, initial = false): void {
    const roleChanged = this.me?.role !== me.role;
    this.me = me;
    if (initial) {
      this.shownBalance = me.balance;
      this.pressQueue = [];
      if (me.open_parcel) this.restoreParcel(me.open_parcel);
    }
    this.moderationButton.hidden = !(me.role === "helper" || me.role === "founder");
    this.renderPostbox();
    this.renderSatchel();
    if (roleChanged && me.role !== "guest") void this.loadPostcards();
  }

  private restoreParcel(parcel: Parcel): void {
    this.parcel = parcel;
    this.carrying = parcel.rush_id ? "rush" : "standard";
    this.thread.resume(routeFrom(parcel));
  }

  // ---- cards ----

  private renderPostbox(): void {
    const me = this.me;
    const body: Node[] = [];
    if (!me) {
      this.postboxBody.replaceChildren(h("p", { class: "skeleton" }, "—"));
      return;
    }
    body.push(h("p", { class: "courier-name" }, me.display_name));
    if (me.role === "guest") {
      const claim = iconButton("key-round", "Claim this save", "Claim this save", "button-primary");
      claim.addEventListener("click", () => this.openClaim(claim));
      body.push(h("p", { class: "card-note" }, "Guest courier — your save lives on this device."), claim);
    } else {
      body.push(h("p", { class: "card-note email" }, me.email ?? ""));
    }
    const input = h("input", { id: "display-name", class: "field-input", type: "text", autocomplete: "nickname", value: me.display_name });
    const save = textButton("Save name");
    const nameForm = h(
      "form",
      { class: "name-form" },
      h("label", { for: "display-name", class: "field-label" }, "Display name"),
      h("div", { class: "field-row" }, input, save),
    );
    nameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.saveName(input.value);
    });
    save.type = "submit";
    body.push(nameForm);
    if (me.role !== "guest") {
      const list = h("ul", { "aria-label": "Postcards", class: "postcards" });
      for (const card of this.postcards) list.append(this.postcardItem(card));
      body.push(h("h3", { class: "card-subtitle" }, "Postcards"));
      if (!this.postcards.length)
        body.push(
          h(
            "div",
            { class: "empty-postbox" },
            h("span", { class: "empty-art", "aria-hidden": "true" }),
            h("p", {}, "No postcards yet — open Photo mode to take one."),
          ),
        );
      body.push(list);
      const out = iconButton("log-out", "Sign out", "Sign out", "button-quiet");
      out.addEventListener("click", () => void this.signOut());
      body.push(out);
    }
    const focusedId = document.activeElement?.id;
    this.postboxBody.replaceChildren(...body);
    if (focusedId === "display-name") input.focus();
  }

  private postcardItem(card: Postcard): HTMLLIElement {
    const thumb = h("img", { src: `/p/${card.share_url.split("/p/")[1]}/image.png`, alt: "Postcard", width: "96", height: "64", loading: "lazy" });
    const frame = h("span", { class: "postcard-thumb" }, thumb);
    thumb.addEventListener("error", () => frame.replaceChildren(h("span", { class: "postcard-closed" }, "Image in the darkroom")));
    const copy = iconButton("copy", "Copy link");
    const mail = iconButton("mail", "Mail to a friend");
    const revoke = iconButton("trash-2", "Revoke postcard");
    copy.addEventListener("click", () => void this.copyLink(card));
    mail.addEventListener("click", () => this.openMail(card, mail));
    revoke.addEventListener("click", () => this.confirmRevoke(card, revoke));
    const taken = new Date(card.created_at);
    return h(
      "li",
      { class: "postcard" },
      frame,
      h("span", { class: "postcard-date" }, taken.toLocaleDateString(undefined, { day: "numeric", month: "short" })),
      h("span", { class: "postcard-actions" }, copy, mail, revoke),
    );
  }

  private renderSatchel(): void {
    const me = this.me;
    setText(this.wearing, me ? `Wearing ${SATCHEL_NAMES[me.satchel_colour] ?? me.satchel_colour}` : "—");
    const actions = h("div", { class: "satchel-actions" }, this.outfitterButton, this.historyButton);
    const parts: Node[] = [this.balance, this.wearing, actions];
    if (this.parcel && this.carrying !== "none") parts.push(this.dropButton);
    if (this.satchelBody.childNodes.length !== parts.length || [...this.satchelBody.childNodes].some((n, i) => n !== parts[i]))
      this.satchelBody.replaceChildren(...parts);
  }

  private renderDepot(): void {
    const depot = this.depot;
    if (!depot) return;
    const focused = document.activeElement as HTMLElement | null;
    const focusLabel = focused?.getAttribute("aria-label") ?? null;
    const standard = h("ul", { class: "missions" });
    for (const m of depot.missions) {
      const b = h(
        "button",
        { type: "button", class: "mission", "aria-label": `Read ${m.title}` },
        h("span", { class: "mission-title" }, m.title),
      );
      b.addEventListener("click", () => this.readLetter(m, b));
      standard.append(h("li", { class: "mission-row" }, b, h("span", { class: "mission-reward" }, `+${m.reward_stamps} stamps`)));
    }
    const rush = h("ul", { class: "rush" });
    for (const row of depot.rush) {
      const name = `Claim ${row.title}, parcel ${row.slot} of ${row.slots}`;
      const parts: Node[] = [
        h("span", { class: "rush-slot" }, `Parcel ${row.slot} of ${row.slots}`),
        h("span", { class: "rush-title" }, ` ${row.title}`),
      ];
      if (this.claimsPending.has(row.rush_id)) {
        parts.push(h("button", { type: "button", class: "button button-small claim", "aria-label": name, "aria-disabled": "true" }, "Claiming…"));
      } else if (row.status === "posted") {
        const b = h("button", { type: "button", class: "button button-small claim", "aria-label": name }, "Claim");
        b.addEventListener("click", () => void this.claim(row));
        parts.push(b);
      } else {
        const text = { taken: "Taken", yours: "Yours", delivered: "Delivered" }[row.status];
        parts.push(h("span", { class: `rush-status rush-${row.status}` }, text));
      }
      rush.append(h("li", { class: "rush-row" }, ...parts));
    }
    this.depotBody.replaceChildren(
      h("p", { class: "card-note" }, `Board for ${depot.board_date}`),
      standard.childElementCount ? standard : h("p", { class: "card-note" }, "No errands posted right now."),
      h(
        "h3",
        { class: "card-subtitle rush-heading" },
        "Rush board · ",
        h("span", { class: "nowrap" }, depot.board_date),
        " · ",
        h("span", { class: "nowrap" }, `${depot.rush_left} left`),
      ),
      rush.childElementCount ? rush : h("p", { class: "card-note" }, "No rush parcels today."),
    );
    if (focused && !focused.isConnected && focusLabel) {
      const again = [...this.depotBody.querySelectorAll<HTMLElement>("button")].find((b) => b.getAttribute("aria-label") === focusLabel);
      again?.focus({ preventScroll: true });
    }
  }

  private async refreshDepot(): Promise<void> {
    const answer = await get<Depot>("/api/depot").catch(() => null);
    if (!answer || answer.status !== 200) return;
    this.depot = answer.data;
    this.checkLapseOnBoard();
    this.renderDepot();
  }

  // ---- letters and taking a parcel ----

  private doorScreen(door: LatLon): [number, number] {
    if (!this.scene) return [Math.round(this.width / 2), Math.round(this.height / 2)];
    const at = new Vector3(...unitVector(door)).multiplyScalar(RADIUS + 1);
    const ndc = at.clone().project(this.scene.camera);
    const x = Math.round(((ndc.x + 1) / 2) * this.width);
    const y = Math.round(((1 - ndc.y) / 2) * this.height);
    return [Math.min(this.width, Math.max(0, x)), Math.min(this.height, Math.max(0, y))];
  }

  private readLetter(mission: DepotMission, opener: HTMLElement): void {
    if (this.letter) return;
    const resident = this.residents.find((r) => r.id === mission.resident_id)!;
    const letter = new Letter(resident.name, mission.dialogue.offer, this.doorScreen(resident.door), now(), reducedMotion());
    const take = textButton("Take the parcel", "button-primary");
    const notNow = textButton("Not now", "button-quiet");
    letter.actions.append(take, notNow);
    take.addEventListener("click", () => void this.takeParcel(mission, letter, take));
    notNow.addEventListener("click", () => {
      if (!letter.locked) letter.fold(now(), reducedMotion());
    });
    this.letter = letter;
    letter.show(this.layer, opener, take, () => {
      if (this.letter === letter) this.letter = null;
    });
  }

  private position(): LatLon {
    const p = this.walker.latLon();
    return { lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)) };
  }

  private async takeParcel(mission: DepotMission, letter: Letter, take: HTMLButtonElement): Promise<void> {
    if (this.acceptPending) return;
    this.acceptPending = true;
    letter.locked = true;
    take.setAttribute("aria-disabled", "true");
    this.notices.say("Taking the parcel…", true);
    const call = { method: "POST", path: `/api/missions/${encodeURIComponent(mission.mission_id)}/accept`, body: { position: this.position() } };
    let answer: Answer<Parcel> | null = null;
    try {
      answer = await sendRetrying<Parcel>(call, () => this.notices.say("Connection wobbly — trying again…", true));
    } catch {
      const me = await get<Me>("/api/me").catch(() => null);
      const open = me?.status === 200 ? me.data.open_parcel : null;
      if (open && open.mission_id === mission.mission_id && !open.rush_id) answer = { status: 201, data: open, headers: new Headers() };
    }
    this.acceptPending = false;
    letter.locked = false;
    if (!answer) {
      take.setAttribute("aria-disabled", "false");
      this.notices.say("Couldn't reach the depot. Try again.");
      return;
    }
    const code = errorCode(answer);
    if (answer.status === 201 || answer.status === 200) {
      this.onParcel(answer.data, letter);
      this.notices.say("Parcel taken. Follow the teal thread.");
    } else if (code === "mission_not_live") {
      letter.fold(now(), reducedMotion());
      this.notices.say("This errand is no longer posted.");
      void this.refreshDepot();
    } else if (code === "hands_full") {
      letter.fold(now(), reducedMotion());
      this.notices.say("Your hands are full — deliver or drop your parcel first.");
    } else {
      take.setAttribute("aria-disabled", "false");
      this.notices.say(INTERNAL);
    }
  }

  /** A 201 or 200: the letter folds, and the thread starts once the fold has reached zero. */
  private onParcel(parcel: Parcel, letter: Letter | null): void {
    const t = now();
    const reduced = reducedMotion();
    this.parcel = parcel;
    this.carrying = parcel.rush_id ? "rush" : "standard";
    this.handoverTicket = null;
    this.holdNextRead = 0;
    const wait = letter ? letter.fold(t, reduced) : 0;
    this.thread.begin(routeFrom(parcel), t + wait, reduced);
    this.renderSatchel();
    void this.refreshDepot();
  }

  // ---- hand-over, drop, claim, lapse ----

  private async handOver(): Promise<void> {
    const parcel = this.parcel;
    if (!parcel || this.thread.handing) return;
    const phase = this.lastPhase;
    if (phase !== "arrived") return;
    if (!this.handoverTicket || this.handoverTicket.acceptance !== parcel.acceptance_id)
      this.handoverTicket = { acceptance: parcel.acceptance_id, ticket: newTicket(), retryBody: null };
    const ticket = this.handoverTicket;
    const body = ticket.retryBody ?? { acceptance_id: parcel.acceptance_id, position: this.position() };
    this.thread.handing = true;
    this.notices.say("Handing over…", true);
    const call = { method: "POST", path: "/api/deliveries", body, headers: { "Handover-Ticket": ticket.ticket } };
    let answer: Answer<Delivery>;
    try {
      answer = await sendRetrying<Delivery>(call, () => this.notices.say("Connection wobbly — trying again…", true));
    } catch {
      ticket.retryBody = body;
      this.thread.handing = false;
      this.notices.say("Couldn't hand over. Your parcel is still safe — try again.");
      return;
    }
    ticket.retryBody = null;
    this.thread.handing = false;
    const code = errorCode(answer);
    if (answer.status === 201) {
      this.delivered(parcel, answer.data.dialogue.thanks);
      this.pushBalance(answer.data.balance);
      this.notices.say(`Delivered to ${parcel.resident.name}. +${answer.data.stamps_awarded} stamps.`);
      void this.refreshMe();
    } else if (code === "already_delivered") {
      this.delivered(parcel, null);
      this.notices.say("That parcel was already delivered.");
    } else if (code === "hold_expired") {
      this.applyLapse(parcel.acceptance_id);
    } else if (code === "validation") {
      this.notices.say("Walk a little closer to the door.");
    } else if (code === "parcel_dropped" || code === "not_found") {
      this.closeParcel();
      this.thread.rewind(now());
      this.notices.say("That parcel is already closed.");
    } else this.notices.say(INTERNAL);
    void this.refreshDepot();
  }

  private delivered(parcel: Parcel, thanks: string[] | null): void {
    this.thread.delivered(now());
    this.closeParcel();
    if (thanks) {
      const resident = this.residents.find((r) => r.id === parcel.resident.resident_id)!;
      const letter = new Letter(resident.name, thanks, this.doorScreen(resident.door), now(), reducedMotion());
      const fold = textButton("Fold letter", "button-primary");
      fold.addEventListener("click", () => letter.fold(now(), reducedMotion()));
      letter.actions.append(fold);
      if (this.letter) this.letter.fold(now(), true);
      this.letter = letter;
      letter.show(this.layer, this.region, fold, () => {
        if (this.letter === letter) this.letter = null;
      });
    }
  }

  private closeParcel(): void {
    this.parcel = null;
    this.carrying = "none";
    this.handoverTicket = null;
    this.renderSatchel();
  }

  private async drop(): Promise<void> {
    const parcel = this.parcel;
    if (!parcel) return;
    this.notices.say("Dropping…", true);
    const answer = await send({ method: "POST", path: `/api/acceptances/${parcel.acceptance_id}/drop`, body: {} }).catch(() => null);
    if (!answer) return this.notices.say("Couldn't reach the depot. Try again.");
    if (answer.status === 200) {
      this.rewindNow();
      this.notices.say("Parcel dropped.");
    } else if (errorCode(answer) === "parcel_closed") {
      this.rewindNow();
      this.notices.say("That parcel is already closed.");
    } else this.notices.say(INTERNAL);
    void this.refreshDepot();
  }

  /** A drop or lapse: rewind the ribbon and bring the camera home from wherever it is. */
  private rewindNow(): void {
    const t = now();
    if (this.thread.inSequence(t) && this.cameraPose && !reducedMotion())
      this.tween = { tween: new CameraTween(clonePose(this.cameraPose), () => this.followRest(), t, 375), label: "over-shoulder" };
    this.thread.rewind(t);
    this.closeParcel();
  }

  private async claim(row: RushRow): Promise<void> {
    if (this.claimsPending.has(row.rush_id)) return;
    this.claimsPending.add(row.rush_id);
    this.renderDepot();
    this.notices.say("Claiming…", true);
    const call = { method: "POST", path: `/api/rush/${row.rush_id}/claim`, body: { position: this.position() } };
    let answer: Answer<Parcel> | null = null;
    try {
      answer = await sendRetrying<Parcel>(call, () => this.notices.say("Connection wobbly — trying again…", true));
    } catch {
      const me = await get<Me>("/api/me").catch(() => null);
      const open = me?.status === 200 ? me.data.open_parcel : null;
      if (open && open.rush_id === row.rush_id) answer = { status: 201, data: open, headers: new Headers() };
    }
    this.claimsPending.delete(row.rush_id);
    const code = answer ? errorCode(answer) : "";
    if (!answer) this.notices.say("Couldn't reach the depot. Try again.");
    else if (answer.status === 201 || answer.status === 200) {
      this.onParcel(answer.data, null);
      this.notices.say(`It's yours! Deliver before ${localTime(answer.data.hold_expires_at!)}.`);
    } else if (code === "parcel_taken") this.notices.say("Another courier got there first.");
    else if (code === "sign_in_required") this.notices.say("Claim your save to race for rush parcels.");
    else if (code === "hands_full") this.notices.say("Your hands are full — deliver or drop your parcel first.");
    else if (code === "board_closed") this.notices.say("That board has closed for the day.");
    else if (code === "mission_not_live") this.notices.say("This errand is no longer posted.");
    else this.notices.say(INTERNAL);
    if (this.depot && answer && (answer.status === 201 || answer.status === 200 || code === "parcel_taken")) {
      const mine = answer.status !== 409;
      this.depot = {
        ...this.depot,
        rush: this.depot.rush.map((r) => (r.rush_id === row.rush_id ? { ...r, status: mine ? "yours" : "taken" } : r)),
      };
    }
    this.renderDepot();
    void this.refreshDepot();
  }

  /** Applies a lapsed rush hold once: rewind, empty hands, one announcement. */
  private applyLapse(acceptanceId: string): void {
    if (this.lapsed.has(acceptanceId)) return;
    this.lapsed.add(acceptanceId);
    if (this.parcel?.acceptance_id !== acceptanceId) return;
    this.rewindNow();
    this.notices.say("Your rush hold ran out. The parcel is back on the board.");
    void this.refreshDepot();
  }

  private checkLapseOnBoard(): void {
    const parcel = this.parcel;
    if (!parcel?.rush_id || !this.depot || this.thread.handing) return;
    const row = this.depot.rush.find((r) => r.rush_id === parcel.rush_id);
    const theirs = row && (row.status === "yours" || row.status === "delivered");
    if (!theirs && serverNow() >= Date.parse(parcel.hold_expires_at!)) this.applyLapse(parcel.acceptance_id);
  }

  /** Reads Me once the hold ends by the server clock, again every second until the server agrees. */
  private watchHold(): void {
    const parcel = this.parcel;
    if (!parcel?.rush_id || this.thread.handing || now() < this.holdNextRead) return;
    if (serverNow() < Date.parse(parcel.hold_expires_at!)) return;
    this.holdNextRead = now() + 1000;
    void get<Me>("/api/me")
      .then((me) => {
        if (me.status !== 200) return;
        const open = me.data.open_parcel;
        if (!open || open.acceptance_id !== parcel.acceptance_id) this.applyLapse(parcel.acceptance_id);
      })
      .catch(() => undefined);
  }

  private async refreshMe(): Promise<void> {
    const me = await get<Me>("/api/me").catch(() => null);
    if (me?.status === 200) this.applyMe(me.data);
  }

  // ---- balance presses ----

  private pushBalance(balance: number): void {
    const t = now();
    if (reducedMotion()) {
      this.shownBalance = balance;
      this.presses++;
      if (this.me) this.me.balance = balance;
      return;
    }
    const last = this.pressQueue.at(-1);
    const start = Math.max(t, last ? last.start + PRESS_MS : t);
    this.pressQueue.push({ balance, start });
    if (this.me) this.me.balance = balance;
  }

  private updatePresses(t: number): void {
    const reduced = reducedMotion();
    let scale = 1;
    while (this.pressQueue.length) {
      const head = this.pressQueue[0]!;
      if (reduced || t >= head.start + PRESS_MS) {
        this.shownBalance = head.balance;
        this.presses++;
        this.pressQueue.shift();
        this.glowStart = reduced ? -Infinity : head.start + PRESS_MS;
        continue;
      }
      if (t >= head.start) {
        const k = (t - head.start) / PRESS_MS;
        if (k >= 0.5) this.shownBalance = head.balance;
        scale = 1 - 0.18 * Math.sin(Math.PI * k);
      }
      break;
    }
    const glow = reduced ? 0 : 1 - clamp01((t - this.glowStart) / GLOW_MS);
    this.balanceNumeral.style.transform = scale === 1 ? "" : `scale(${scale.toFixed(3)})`;
    this.balance.style.setProperty("--glow", glow.toFixed(3));
    setText(this.balanceNumeral, String(this.shownBalance));
    setText(this.balanceText, `${this.shownBalance} stamps`);
    setData(this.balance, "data-balance-shown", String(this.shownBalance));
    setData(this.balance, "data-stamp-presses", String(this.presses));
  }

  // ---- Postbox dialogs and actions ----

  private dialogShell(label: string, role: "dialog" | "alertdialog", ...content: Node[]): HTMLElement {
    return paper(h("div", { role, "aria-modal": "true", "aria-label": label, class: "sheet-dialog" }, ...content));
  }

  private showDialog(el: HTMLElement, opener: HTMLElement, focus?: HTMLElement, onClose?: () => void): OpenDialog {
    this.layer.append(el);
    return openDialog({ el, opener, focus: focus ?? null, onClose: () => (el.remove(), onClose?.()) });
  }

  private closeButton(entry: () => OpenDialog): HTMLButtonElement {
    const b = iconButton("x", "Close", undefined, "dialog-close button-quiet");
    b.addEventListener("click", () => closeDialog(entry()));
    return b;
  }

  private openClaim(opener: HTMLElement): void {
    const email = h("input", { id: "claim-email", type: "email", class: "field-input", autocomplete: "email" });
    const error = h("p", { id: "claim-email-error", class: "field-error" });
    const sendKey = textButton("Send postbox key", "button-primary");
    let entry: OpenDialog;
    const form = h(
      "form",
      { class: "dialog-form", novalidate: true },
      h("label", { for: "claim-email", class: "field-label" }, "Email"),
      email,
      error,
      sendKey,
    );
    const el = this.dialogShell(
      "Claim this save",
      "dialog",
      h("h2", { class: "dialog-title" }, "Claim this save"),
      h("p", { class: "dialog-text" }, "We'll email you a postbox key. Open it and your stamps, satchels and parcel travel with you to any device."),
      form,
      this.closeButton(() => entry),
    );
    sendKey.type = "submit";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      this.notices.say("Sending your postbox key…", true);
      const answer = await send({ method: "POST", path: "/api/auth/postbox-key", body: { email: email.value } }).catch(() => null);
      if (answer?.status === 200) {
        error.textContent = "";
        email.removeAttribute("aria-describedby");
        this.notices.say("Check your inbox for a postbox key.");
      } else if (answer && errorCode(answer) === "validation") {
        error.textContent = "Enter an email address like name@example.com.";
        email.setAttribute("aria-describedby", "claim-email-error");
        email.focus();
        this.notices.say("Enter an email address like name@example.com.");
      } else if (answer && errorCode(answer) === "post_office_closed")
        this.notices.say("The post office is closed right now. Try again in a few minutes.");
      else this.notices.say(answer ? INTERNAL : "Couldn't reach the depot. Try again.");
    });
    entry = this.showDialog(el, opener, email);
  }

  private async saveName(value: string): Promise<void> {
    const check = checkDisplayName(value);
    if (!check.ok) return this.notices.say("Names are 1 to 24 characters.");
    this.notices.say("Saving…", true);
    const answer = await send<Me>({ method: "PATCH", path: "/api/me", body: { display_name: value } }).catch(() => null);
    if (answer?.status === 200) {
      this.applyMe(answer.data);
      this.notices.say("Name saved.");
    } else if (answer && errorCode(answer) === "name_locked")
      this.notices.say("A community helper reset your name. It can't be changed right now.");
    else if (answer && errorCode(answer) === "validation") this.notices.say("Names are 1 to 24 characters.");
    else this.notices.say(answer ? INTERNAL : "Couldn't reach the depot. Try again.");
  }

  private async loadPostcards(): Promise<void> {
    if (!this.me || this.me.role === "guest") return;
    const answer = await get<{ postcards: Postcard[] }>("/api/postcards").catch(() => null);
    if (answer?.status !== 200) return;
    this.postcards = answer.data.postcards;
    this.renderPostbox();
  }

  private async copyLink(card: Postcard): Promise<void> {
    try {
      await navigator.clipboard.writeText(card.share_url);
      this.notices.say("Link copied.");
    } catch {
      this.notices.say(INTERNAL);
    }
  }

  private openMail(card: Postcard, opener: HTMLElement): void {
    const input = h("input", { id: "friend-email", type: "email", class: "field-input", autocomplete: "off" });
    const error = h("p", { id: "friend-email-error", class: "field-error" });
    const sendButton = textButton("Send postcard", "button-primary");
    let ticket = newTicket();
    let ticketFor = "";
    let entry: OpenDialog;
    input.addEventListener("input", () => {
      if (input.value !== ticketFor) ticket = newTicket();
    });
    const form = h(
      "form",
      { class: "dialog-form", novalidate: true },
      h("label", { for: "friend-email", class: "field-label" }, "Friend's email"),
      input,
      error,
      sendButton,
    );
    sendButton.type = "submit";
    const el = this.dialogShell(
      "Mail a postcard",
      "dialog",
      h("h2", { class: "dialog-title" }, "Mail a postcard"),
      h("p", { class: "dialog-text" }, "Your friend gets one email with your display name and the postcard's link."),
      form,
      this.closeButton(() => entry),
    );
    let busy = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      const to = input.value.trim();
      if (!/^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/.test(to)) {
        error.textContent = "Enter your friend's email address.";
        input.setAttribute("aria-describedby", "friend-email-error");
        this.notices.say("Enter your friend's email address.");
        return;
      }
      error.textContent = "";
      ticketFor = input.value;
      busy = true;
      this.notices.say("Posting…", true);
      const call = { method: "POST", path: `/api/postcards/${card.postcard_id}/mail`, body: { to }, headers: { "Mail-Ticket": ticket } };
      let answer: Answer | null = null;
      try {
        answer = await sendRetrying(call, () => this.notices.say("Connection wobbly — trying again…", true));
      } catch {
        answer = null;
      }
      busy = false;
      const code = answer ? errorCode(answer) : "";
      if (!answer) this.notices.say("Couldn't reach the post office. Press Send postcard again — it won't send twice.");
      else if (answer.status === 200) {
        closeDialog(entry);
        this.notices.say(`Postcard mailed to ${to}.`);
      } else if (code === "mail_limit") {
        const minutes = Math.ceil(Number(answer.headers.get("Retry-After") ?? "60") / 60);
        this.notices.say(`You've mailed a lot of postcards. Try again in ${minutes} minutes.`);
      } else if (code === "post_office_closed") this.notices.say("The post office is closed right now. Try again in a few minutes.");
      else if (code === "validation") {
        error.textContent = "Enter your friend's email address.";
        this.notices.say("Enter your friend's email address.");
      } else if (code === "not_found") {
        closeDialog(entry);
        void this.loadPostcards();
      } else this.notices.say(INTERNAL);
    });
    entry = this.showDialog(el, opener, input);
  }

  private confirmRevoke(card: Postcard, opener: HTMLElement): void {
    const revoke = textButton("Revoke", "button-primary");
    const keep = textButton("Keep it", "button-quiet");
    const el = this.dialogShell(
      "Revoke postcard",
      "alertdialog",
      h("p", { class: "dialog-text" }, "Revoke this postcard? Its link will stop working."),
      h("div", { class: "confirm-actions" }, keep, revoke),
    );
    const entry = this.showDialog(el, opener, keep);
    keep.addEventListener("click", () => closeDialog(entry));
    revoke.addEventListener("click", async () => {
      closeDialog(entry, false);
      this.notices.say("Revoking…", true);
      const answer = await send({ method: "DELETE", path: `/api/postcards/${card.postcard_id}` }).catch(() => null);
      if (answer?.status === 204) {
        this.postcards = this.postcards.filter((p) => p.postcard_id !== card.postcard_id);
        this.renderPostbox();
        this.notices.say("Postcard revoked. Its link no longer works.");
        this.postbox.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
      } else if (answer && errorCode(answer) === "darkroom_closed") {
        this.notices.say("The darkroom is closed. Your walk isn't affected — postcards will develop again when it reopens.");
        if (opener.isConnected) opener.focus();
      } else this.notices.say(answer ? INTERNAL : "Couldn't reach the depot. Try again.");
    });
  }

  private async signOut(): Promise<void> {
    this.notices.say("Signing out…", true);
    const answer = await send({ method: "POST", path: "/api/auth/sign-out", body: {} }).catch(() => null);
    if (answer?.status !== 204) return this.notices.say(answer ? INTERNAL : "Couldn't reach the depot. Try again.");
    const guest = await send<Me>({ method: "POST", path: "/api/guest", body: {} }).catch(() => null);
    this.postcards = [];
    if (guest && (guest.status === 201 || guest.status === 200)) {
      this.parcel = null;
      this.carrying = "none";
      this.thread.rewind(now());
      this.applyMe(guest.data, true);
    }
    this.notices.say("Signed out. You're a guest courier again.");
    void this.refreshDepot();
  }

  // ---- Satchel dialogs ----

  private async openOutfitter(): Promise<void> {
    const list = h("ul", { class: "outfitter" });
    let entry: OpenDialog;
    const el = this.dialogShell(
      "Outfitter",
      "dialog",
      h("h2", { class: "dialog-title" }, "Outfitter"),
      h("p", { class: "dialog-text" }, "Satchels for every route. Prices in stamps."),
      list,
      this.closeButton(() => entry),
    );
    const render = (satchels: Satchel[]): void => {
      const focusedLabel = (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? "";
      const focusedIndex = satchels.findIndex((s) => focusedLabel.endsWith(s.name));
      list.replaceChildren(
        ...satchels.map((s) => {
          const swatch = h("span", { class: `swatch swatch-${s.colour}`, "aria-hidden": "true" });
          let action: Node;
          if (!s.owned) {
            const b = textButton(`Buy`, "button-small button-primary");
            b.setAttribute("aria-label", `Buy ${s.name}`);
            b.addEventListener("click", () => void this.buy(s, refresh));
            action = b;
          } else if (!s.worn) {
            const b = textButton("Wear", "button-small");
            b.setAttribute("aria-label", `Wear ${s.name}`);
            b.addEventListener("click", () => void this.wear(s, refresh));
            action = b;
          } else action = h("span", { class: "wearing-badge" }, "Wearing");
          return h(
            "li",
            { class: "outfitter-row" },
            swatch,
            h("span", { class: "outfitter-name" }, s.name),
            h("span", { class: "outfitter-price" }, `${s.price} stamps`),
            action,
          );
        }),
      );
      if (focusedIndex >= 0 && !list.contains(document.activeElement)) {
        const row = list.children[focusedIndex];
        (row?.querySelector("button") ?? list.closest(".sheet-dialog")?.querySelector("button"))?.focus({ preventScroll: true });
      }
    };
    const refresh = async (): Promise<void> => {
      const answer = await get<{ satchels: Satchel[] }>("/api/outfitter").catch(() => null);
      if (answer?.status === 200) render(answer.data.satchels);
    };
    const answer = await get<{ satchels: Satchel[] }>("/api/outfitter").catch(() => null);
    if (answer?.status !== 200) return this.notices.say(answer ? INTERNAL : "Couldn't reach the outfitter. Your stamps are safe — try again.");
    render(answer.data.satchels);
    entry = this.showDialog(el, this.outfitterButton);
  }

  private async buy(s: Satchel, refresh: () => Promise<void>): Promise<void> {
    const ticket = newTicket();
    this.notices.say("Wrapping it up…", true);
    const call = { method: "POST", path: `/api/outfitter/${s.satchel_id}/buy`, body: {}, headers: { "Purchase-Ticket": ticket } };
    let answer: Answer<{ balance: number }>;
    try {
      answer = await sendRetrying<{ balance: number }>(call, () => this.notices.say("Connection wobbly — trying again…", true));
    } catch {
      return this.notices.say("Couldn't reach the outfitter. Your stamps are safe — try again.");
    }
    const code = errorCode(answer);
    if (answer.status === 201) {
      this.pushBalance(answer.data.balance);
      this.notices.say(`${s.name} is yours.`);
      if (this.me) this.me.satchels_owned = [...this.me.satchels_owned, s.satchel_id];
    } else if (code === "insufficient_stamps") this.notices.say(`You need ${s.price - (this.me?.balance ?? 0)} more stamps.`);
    else if (code === "already_owned") this.notices.say("You already own this satchel.");
    else this.notices.say(INTERNAL);
    await refresh();
  }

  private async wear(s: Satchel, refresh: () => Promise<void>): Promise<void> {
    this.notices.say("Changing satchels…", true);
    const answer = await send<Me>({ method: "PATCH", path: "/api/me", body: { satchel_id: s.satchel_id } }).catch(() => null);
    if (answer?.status === 200) {
      this.applyMe(answer.data);
      this.notices.say(`Now wearing ${s.name}.`);
    } else if (answer && errorCode(answer) === "not_owned") this.notices.say("Buy this satchel first.");
    else this.notices.say(answer ? INTERNAL : "Couldn't reach the outfitter. Your stamps are safe — try again.");
    await refresh();
  }

  private async openHistory(): Promise<void> {
    const list = h("ul", { "aria-label": "Movements", class: "movements" });
    const total = h("p", { class: "history-balance" });
    const older = textButton("Show older", "button-quiet");
    let cursor: string | null = null;
    let entry: OpenDialog | null = null;
    const el = this.dialogShell(
      "Stamp history",
      "dialog",
      h("h2", { class: "dialog-title" }, "Stamp history"),
      total,
      list,
      older,
      this.closeButton(() => entry!),
    );
    const load = async (): Promise<boolean> => {
      this.notices.say("Loading older stamps…", true);
      const answer = await get<History>(`/api/me/ledger?limit=20${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`).catch(
        () => null,
      );
      if (answer?.status !== 200) {
        this.notices.say("Couldn't fetch your stamp history. Try again.");
        return false;
      }
      this.notices.clear();
      setText(total, `${answer.data.balance} stamps`);
      for (const mv of answer.data.movements) {
        const amount = mv.entries[0]!.amount;
        const text = `${amount >= 0 ? "+" : "−"}${Math.abs(amount)} stamps · ${mv.kind === "delivery" ? "Delivery" : "Outfitter"}`;
        const when = new Date(mv.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        list.append(h("li", { class: `movement movement-${mv.kind}` }, h("span", { class: "movement-text" }, text), h("span", { class: "movement-time" }, ` ${when}`)));
      }
      cursor = answer.data.next_cursor;
      older.hidden = !cursor;
      if (!list.childElementCount) list.append(h("li", { class: "movement-empty" }, "No stamps yet — deliver a parcel to earn your first."));
      return true;
    };
    older.addEventListener("click", async () => {
      const index = list.childElementCount;
      await load();
      if (older.hidden) (list.children[index] as HTMLElement | undefined)?.setAttribute("tabindex", "-1");
      if (older.hidden) entry && (focusables(el)[0] ?? el).focus();
    });
    if (!(await load())) return;
    entry = this.showDialog(el, this.historyButton);
  }

  // ---- emotes and presence ----

  private emote(name: string): void {
    this.pendingEmote = name;
    this.ownEmote = { name, at: now() };
  }

  private async presenceTick(): Promise<void> {
    if (this.presenceBusy || !this.me) return;
    this.presenceBusy = true;
    const p = this.position();
    const emote = this.pendingEmote;
    this.pendingEmote = null;
    const body: Record<string, unknown> = {
      stream: this.stream,
      seq: ++this.seq,
      position: { lat: p.lat, lon: p.lon, heading_deg: Math.round(this.walker.heading()) % 360 },
    };
    if (emote) body.emote = emote;
    try {
      const beat = await send<{ muted: boolean }>({ method: "POST", path: "/api/presence", body });
      if (beat.status === 200 && emote && beat.data.muted) this.notices.say("You're muted, so emotes are hidden from others.");
      const read = await get<{ couriers: PresenceEntry[] }>("/api/presence");
      if (read.status === 200) this.figures.apply(read.data.couriers, now(), reducedMotion());
    } catch {
      // the next beat tries again
    }
    this.presenceBusy = false;
  }

  // ---- photo mode ----

  private openPhoto(): void {
    if (this.photo.open) return;
    const t = now();
    this.closeSheet();
    this.walker.halt();
    this.keys.clear();
    this.root.classList.add("photo-open");
    this.photo.show(this.photoButton, t);
    if (this.cameraPose && !reducedMotion())
      this.tween = { tween: new CameraTween(clonePose(this.cameraPose), () => this.photoPoseNow(), t, 380), label: "photo" };
    else this.tween = null;
  }

  private leavePhoto(): void {
    this.root.classList.remove("photo-open");
    const t = now();
    if (this.cameraPose && !reducedMotion())
      this.tween = { tween: new CameraTween(clonePose(this.cameraPose), () => this.followRest(), t, 380), label: "over-shoulder" };
    else this.tween = null;
    this.follow = null;
  }

  private photoPoseNow(): Pose {
    const shown = this.photo.shown(now(), reducedMotion());
    return photoPose(this.walker, shown.yaw, shown.fov, this.scene?.blockers ?? []);
  }

  // ---- input ----

  private bindInput(): void {
    addEventListener(
      "keydown",
      (e) => {
        if (this.intro === "playing") {
          this.skipIntro();
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    addEventListener(
      "pointerdown",
      () => {
        if (this.intro === "playing") this.skipIntro();
      },
      true,
    );
    addEventListener("keydown", (e) => {
      const target = document.activeElement;
      const inWorld = target === this.region || target === document.body || target === null;
      if (!inWorld || this.photo.open || anyModalOpen()) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "Enter" && target === this.region) {
        if (this.lastPhase === "arrived") void this.handOver();
        return;
      }
      if (["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key)) {
        e.preventDefault();
        if (key === " ") {
          if (!e.repeat) this.walker.jump();
        } else this.keys.add(key);
      }
    });
    addEventListener("keyup", (e) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(key);
    });
    addEventListener("blur", () => this.keys.clear());
    let active: number | null = null;
    const radius = (): number => this.stick.getBoundingClientRect().width / 2;
    const moveKnob = (e: PointerEvent): void => {
      const box = this.stick.getBoundingClientRect();
      const r = radius();
      let x = (e.clientX - (box.left + r)) / r;
      let y = (e.clientY - (box.top + r)) / r;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      this.stickVector = { x, y };
      this.knob.style.transform = `translate(${(x * r * 0.55).toFixed(1)}px, ${(y * r * 0.55).toFixed(1)}px)`;
    };
    this.stick.addEventListener("pointerdown", (e) => {
      active = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      moveKnob(e);
    });
    this.stick.addEventListener("pointermove", (e) => {
      if (e.pointerId === active) moveKnob(e);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== active) return;
      active = null;
      this.stickVector = { x: 0, y: 0 };
      this.knob.style.transform = "";
    };
    this.stick.addEventListener("pointerup", release);
    this.stick.addEventListener("pointercancel", release);
    this.stick.addEventListener("lostpointercapture", release);
    this.jumpButton.addEventListener("click", () => this.walker.jump());
  }

  private skipIntro(): void {
    if (this.intro !== "playing") return;
    this.intro = "skipped";
    this.follow = null;
  }

  private applyInput(): void {
    const frozen = this.intro === "playing" || this.photo.open || this.sceneState === "loading";
    let forward = 0;
    let turn = 0;
    if (!frozen) {
      if (this.keys.has("w") || this.keys.has("ArrowUp")) forward += 1;
      if (this.keys.has("s") || this.keys.has("ArrowDown")) forward -= 1;
      if (this.keys.has("d") || this.keys.has("ArrowRight")) turn += 1;
      if (this.keys.has("a") || this.keys.has("ArrowLeft")) turn -= 1;
      forward += -this.stickVector.y;
      turn += this.stickVector.x;
    }
    this.walker.forwardInput = Math.max(-1, Math.min(1, forward));
    this.walker.turnInput = Math.max(-1, Math.min(1, turn));
  }

  // ---- motion preferences and visibility ----

  private onReducedChange(reduced: boolean): void {
    if (reduced) {
      if (this.intro === "playing") this.skipIntro();
      this.thread.settleForReducedMotion();
      this.tween = null;
    }
  }

  private onVisibility(): void {
    if (!pageHidden()) {
      this.lastFrame = now();
      const parcel = this.parcel;
      if (parcel?.rush_id && serverNow() >= Date.parse(parcel.hold_expires_at!) && !this.thread.handing) {
        this.applyLapse(parcel.acceptance_id);
        void this.refreshMe();
        void this.refreshDepot();
      }
    }
    this.tick();
  }

  // ---- cameras ----

  private followRest(): Pose {
    return followPose(this.walker, this.scene?.blockers ?? []);
  }

  private followCamera(t: number, dt: number, reduced: boolean): Pose {
    const rest = this.followRest();
    if (!this.follow || reduced) {
      this.follow = { pose: rest, settled: true, settleStart: 0, settleFrom: null };
      return rest;
    }
    const f = this.follow;
    if (this.walker.moving || this.walker.turning) {
      const k = 1 - Math.exp(-dt / TRAIL_S);
      f.pose = {
        pos: f.pose.pos.clone().lerp(rest.pos, k),
        target: f.pose.target.clone().lerp(rest.target, k),
        up: f.pose.up.clone().lerp(rest.up, k).normalize(),
        fov: rest.fov,
      };
      f.settled = false;
      f.settleFrom = null;
    } else if (!f.settled) {
      if (!f.settleFrom) {
        f.settleFrom = clonePose(f.pose);
        f.settleStart = t;
      }
      const k = clamp01((t - f.settleStart) / SETTLE_MS);
      f.pose = blendLinear(f.settleFrom, rest, easePrint(k));
      if (k >= 1) f.settled = true;
    } else f.pose = rest;
    return f.pose;
  }

  private camera(t: number, dt: number, reduced: boolean, threadCamera: Pose | null): { pose: Pose; settled: boolean } {
    if (this.intro === "playing") {
      const k = (t - this.introStart) / INTRO_MS;
      if (k >= 1) {
        this.intro = "done";
        this.follow = null;
      } else {
        this.cameraLabel = "intro";
        return { pose: blendLinear(introPose(this.walker), this.followRest(), easeInOut(k)), settled: false };
      }
    }
    if (threadCamera && !reduced) {
      this.cameraLabel = "orbit";
      this.follow = null;
      return { pose: threadCamera, settled: false };
    }
    if (this.tween && !reduced) {
      const tw = this.tween;
      if (!tw.tween.done(t)) {
        this.cameraLabel = tw.label;
        return { pose: tw.tween.pose(t), settled: false };
      }
      this.tween = null;
      this.follow = null;
    }
    if (this.photo.open) {
      this.cameraLabel = "photo";
      const shown = this.photo.shown(t, reduced);
      return { pose: photoPose(this.walker, shown.yaw, shown.fov, this.scene?.blockers ?? []), settled: shown.settled };
    }
    this.cameraLabel = "over-shoulder";
    const pose = this.followCamera(t, dt, reduced);
    return { pose, settled: this.follow!.settled };
  }

  // ---- the frame ----

  private frame = (): void => {
    this.tick();
    if (!pageHidden()) requestAnimationFrame(this.frame);
    else setTimeout(this.frame, 250);
  };

  private tick(): void {
    const t = now();
    const dt = Math.min(0.1, Math.max(0, (t - this.lastFrame) / 1000));
    this.lastFrame = t;
    const reduced = reducedMotion();
    if (this.sceneState === "loading" && this.scene) {
      this.sceneState = "ready";
      this.intro = reduced ? "off" : "playing";
      this.introStart = t;
    }
    this.applyInput();
    this.walker.update(dt, reduced);
    if (this.walker.moving) this.walkPhase += dt * 9;
    const ambient = this.sceneState !== "ready" || reduced ? "off" : pageHidden() ? "paused" : "running";
    if (ambient === "running") {
      this.ambientSeconds += dt;
      this.cloudDeg = (this.cloudDeg + dt * CLOUD_DPS) % 360;
    }
    const aspect = this.width / Math.max(1, this.height);
    const frame = this.thread.frame(t, this.walker.p, reduced, aspect, () => this.followRest());
    this.ribbonSpan = frame.ribbon;
    const cam = this.camera(t, dt, reduced, frame.camera);
    this.cameraPose = cam.pose;
    this.figures.update(t, reduced);
    this.letter?.update(t, reduced);
    this.updatePresses(t);
    this.watchHold();
    if (this.scene) {
      this.scene.apply(cam.pose);
      this.scene.setAmbient(this.ambientSeconds, this.cloudDeg);
      this.scene.syncCourier(this.walker, this.carrying, this.me?.satchel_colour ?? "canvas", this.walkPhase);
      this.scene.courier.setBubble(this.ownEmote && t - this.ownEmote.at < EMOTE_MS ? this.ownEmote.name : "", this.ownEmote && t - this.ownEmote.at < EMOTE_MS ? 1 : 0);
      this.scene.syncFigures(this.figures.figures, t, reduced);
      this.scene.render(frame.ribbon);
    }
    this.writeState(t, frame, cam, reduced, ambient);
  }

  private writeState(t: number, frame: ThreadFrame, cam: { pose: Pose; settled: boolean }, reduced: boolean, ambient: string): void {
    const r = this.region;
    const feet = this.walker.feet();
    const pose = cam.pose;
    setData(r, "data-scene", this.sceneState);
    setData(r, "data-camera", this.cameraLabel);
    setData(r, "data-camera-dist-m", fixed(pose.pos.distanceTo(feet), 1));
    setData(r, "data-camera-fov", String(Math.round(this.photo.open ? this.photo.fovTarget : pose.fov)));
    setData(r, "data-camera-alt-m", fixed(pose.pos.length() - RADIUS, 1));
    setData(r, "data-camera-settled", String(cam.settled));
    setData(r, "data-photo-yaw-deg", this.photo.open ? String(this.photo.yawTarget) : "");
    const courierScreen = this.scene?.project(feet);
    setData(r, "data-courier-screen", courierScreen ? courierScreen.join(",") : "");
    const where = this.walker.latLon();
    setData(r, "data-lat", fixed(where.lat, 2));
    setData(r, "data-lon", fixed(where.lon, 2));
    setData(r, "data-grounded", String(this.walker.grounded));
    setData(r, "data-heading-deg", String(Math.round(this.walker.heading()) % 360));
    setData(r, "data-courier-tilt-deg", "0.0");
    setData(r, "data-carrying", this.carrying);
    setData(r, "data-intro", this.sceneState === "ready" ? this.intro : "off");
    setData(r, "data-ambient", ambient);
    setData(r, "data-cloud-deg", String(Math.floor(this.cloudDeg) % 360));

    const route = frame.route;
    const s = this.routeStatus;
    const phase = frame.phase;
    setData(s, "data-thread-phase", phase);
    setData(s, "data-route-id", route && phase !== "rewind" ? route.routeId : "");
    const open = route && phase !== "rewind" && phase !== "delivered";
    setData(s, "data-arc-remaining-m", open ? fixed(frame.arc, 1) : phase === "delivered" ? "0.0" : "");
    setData(s, "data-bearing-deg", open ? String(frame.bearing) : "");
    setData(s, "data-ribbon-fraction", open ? fixed(frame.fraction, 2) : "0.00");
    setData(s, "data-ribbon-visible", fixed(frame.visible, 2));
    let doorScreen = "";
    if (route && this.scene && open) {
      const door = new Vector3(...unitVector(route.door)).multiplyScalar(RADIUS + 1);
      const p = this.scene.project(door);
      doorScreen = p ? p.join(",") : "";
    }
    setData(s, "data-door-screen", doorScreen);
    const walkingLike = phase === "walking" || phase === "arrived" || phase === "handing" || phase === "return";
    const ringDeg = !reduced && open && walkingLike ? frame.bearing : 0;
    this.compass.turn(ringDeg);
    this.compass.setNotch(frame.notch);
    setText(this.compass.metres, open ? `${Math.round(frame.arc)} m` : phase === "delivered" ? "0 m" : "");
    if (open && walkingLike) {
      const enteredArrived = phase === "arrived" && this.lastPhase !== "arrived" && this.lastPhase !== "handing";
      if (enteredArrived || t - this.routeTextAt >= 1000 || !s.textContent) {
        const readout = `Bearing ${compassLabel(frame.bearing)} ${frame.bearing}°, ${Math.round(frame.arc)} m`;
        setText(s, phase === "arrived" || phase === "handing" ? `Arrived at ${route.home}. ${readout}` : readout);
        this.routeTextAt = t;
      }
    } else if (s.textContent) setText(s, "");
    this.root.classList.toggle("reduced", reduced);
    const showHand = phase === "arrived" || phase === "handing";
    this.handButton.hidden = !showHand;
    this.handButton.setAttribute("aria-disabled", phase === "handing" ? "true" : "false");
    if (!showHand && document.activeElement === this.handButton) this.region.focus();
    this.lastPhase = phase;
    this.renderSatchel();
  }
}

new Game();
