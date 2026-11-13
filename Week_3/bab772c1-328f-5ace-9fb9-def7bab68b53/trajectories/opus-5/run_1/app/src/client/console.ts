/** The replay console, shared by the author and the reader. */

import { formatDoy, isoInstant, parseDoyToMs, parseIsoInstant } from "../shared/doy.js";
import { formatMetLabel } from "../shared/met.js";
import { snapIndex, type Frame, type FrameRate } from "../shared/frames.js";
import { readoutLines } from "../shared/readout.js";
import { banners, consoleCopy, fieldErrors, pages, uploadCopy } from "../shared/copy.js";
import { formatDistance } from "../shared/units.js";
import type { DistanceUnit, SpeedUnit } from "../shared/units.js";
import type {
  Mission,
  MissionEvent,
  Pass,
  Sample,
  ServiceStatus,
  ShareMission,
  Speaker,
  TranscriptLine,
} from "../shared/model.js";
import {
  announce,
  clear,
  el,
  fieldError,
  liveRegion,
  prefersReducedMotion,
  trapFocus,
} from "./dom.js";
import {
  encodeCaptureName,
  getJson,
  getJsonRetrying,
  request,
  requestKey,
  sha256Hex,
} from "./api.js";
import { DiscView } from "./disc.js";
import { Playback, type PlaybackRate } from "./playback.js";
import { openPinEventDialog } from "./dialogs.js";
import { transcriptPanel, type TranscriptPanel } from "./transcript.js";
import {
  capturesPanel,
  eventsPanel,
  landmarksPanel,
  passesPanel,
  referencePanel,
  sharePanel,
  subscribersPanel,
  type PassesPanel,
  type SharePanel,
} from "./panels.js";
import type { ConsoleMission, Host, Panel } from "./host.js";

const STATUS_INTERVAL_MS = 10_000;
const PASS_POLL_MS = 1000;
const WIDE_BREAKPOINT = 1280;
const MEDIUM_BREAKPOINT = 768;

type Layout = "narrow" | "medium" | "wide";

function layoutFor(width: number): Layout {
  if (width >= WIDE_BREAKPOINT) {
    return "wide";
  }
  return width >= MEDIUM_BREAKPOINT ? "medium" : "narrow";
}

type ConsoleOptions =
  | { mode: "author"; missionId: string }
  | { mode: "share"; token: string };

export function renderConsole(root: HTMLElement, options: ConsoleOptions): void {
  new ReplayConsole(root, options).start();
}

class ReplayConsole implements Host {
  readonly mode: "author" | "share";
  readonly apiBase: string;
  readonly missionId: string | null;
  readonly token: string | null;

  private missionData: ConsoleMission = {
    name: "",
    epochMs: 0,
    distanceUnit: "km",
    speedUnit: "m_s",
    sampleCount: 0,
    totalBytes: 0,
    perilune: null,
    reference: null,
    landmarks: [],
    passes: [],
    sharePasses: [],
    share: null,
    changeVersion: 0,
    expiresUtc: null,
  };
  private trackSamples: Sample[] = [];
  private transcriptLines: TranscriptLine[] = [];
  private speakerList: Speaker[] = [];
  private eventList: MissionEvent[] = [];
  private viewDistance: DistanceUnit = "km";
  private viewSpeed: SpeedUnit = "m_s";
  private lens = 0;
  private rate: PlaybackRate = 1;
  private showPins = true;
  private showTicks = true;
  private lastVersion = 0;
  private readonly watchedPasses = new Set<string>();

  private readonly disc: DiscView;
  private readonly playback: Playback;
  private readonly transcript: TranscriptPanel;

  private readonly metReadout = el("output", { class: "met-readout mono" });
  private readonly channelsButton = el("button", {
    type: "button",
    text: "Channels",
    "aria-expanded": "false",
  });
  private readonly metBand: HTMLElement;
  private readonly header: HTMLElement;
  private readonly heading = el("h1");
  private readonly epochLine = el("p", { class: "mono" });
  private readonly perilunLine = el("p", { class: "mono" });
  private readonly expiryLine = el("p", { class: "mono" });
  private readonly bannerBox = el("div", { class: "banners" });
  private readonly plate = el("div", {
    role: "group",
    "aria-label": "Readout",
    class: "plate mono",
  });
  private readonly discPane: HTMLElement;
  private readonly emptyNotice: HTMLElement;
  private readonly gotoInput = el("input", {
    id: "goto-gmt",
    type: "text",
    class: "text mono",
    placeholder: "2026-073/02:00:00",
    "aria-label": "Go to GMT",
  });
  private readonly gotoRow: HTMLElement;
  private readonly playButton = el("button", { type: "button", class: "primary", text: "Play" });
  private readonly rateRadios: { rate: PlaybackRate; input: HTMLInputElement }[];
  private readonly playbackRow: HTMLElement;
  private readonly pinButton = el("button", { type: "button", class: "primary", text: "Pin event" });
  private readonly channelRail: HTMLElement;
  private readonly distanceRadios: { unit: DistanceUnit; input: HTMLInputElement }[];
  private readonly speedRadios: { unit: SpeedUnit; input: HTMLInputElement }[];
  private readonly pinCheckbox = el("input", { type: "checkbox", id: "channel-pins" });
  private readonly tickCheckbox = el("input", { type: "checkbox", id: "channel-ticks" });
  private readonly closeChannels = el("button", { type: "button", text: "Close channels" });
  private readonly uploadStatusRegion = liveRegion("Upload status");
  private readonly consoleStatusRegion = liveRegion("Console status");
  private readonly downloadStatusRegion = liveRegion("Download status");
  private readonly eventsRegion: Panel;
  private readonly landmarks: Panel;
  private readonly reference: Panel | null;
  private readonly passes: PassesPanel | null;
  private readonly captures: Panel | null;
  private readonly share: SharePanel | null;
  private readonly subscribers: Panel | null;
  private wide = window.innerWidth >= WIDE_BREAKPOINT;
  private drawerOpen = false;
  private plateLines = new Map<string, HTMLElement>();
  private readonly rightColumn = el("div", { class: "right-column" });

  constructor(
    private readonly root: HTMLElement,
    options: ConsoleOptions,
  ) {
    this.mode = options.mode;
    this.missionId = options.mode === "author" ? options.missionId : null;
    this.token = options.mode === "share" ? options.token : null;
    this.apiBase =
      options.mode === "author"
        ? `/api/missions/${options.missionId}`
        : `/api/share/${options.token}`;

    this.disc = new DiscView({
      onLensSample: (index, { writeAddress }) => this.setLens(index, writeAddress),
      onPinRequest: () => {
        if (this.mode === "author") {
          this.openPinDialog(this.disc.canvas);
        }
      },
      beforeInteraction: () => this.pausePlayback(),
    });
    this.playback = new Playback({
      samples: () => this.trackSamples,
      fetchFrames: (from, to, fps) => this.fetchFrames(from, to, fps),
      onFrame: (frame, snapped) => this.showFrame(frame, snapped),
      onEnd: (index) => {
        this.stopPlaybackChrome();
        this.setLens(index, true);
      },
    });
    this.transcript = transcriptPanel(this, {
      onQuery: (query) => this.writeAddress({ q: query }),
      onPick: (met) => this.goToMet(met, true),
    });

    this.metBand = el("div", { class: "met-band" }, [this.metReadout, this.channelsButton]);
    this.header = el("header", { class: "console-header" }, [
      this.heading,
      this.epochLine,
      this.perilunLine,
      this.expiryLine,
    ]);
    this.emptyNotice = el("div", { class: "empty-mission" }, [
      el("h2", {
        text:
          this.mode === "author" ? pages.emptyAuthor.heading : pages.emptyShare.heading,
      }),
      ...(this.mode === "author" ? [el("p", { text: pages.emptyAuthor.line })] : []),
    ]);
    this.discPane = el("div", { class: "disc-pane" }, [
      this.disc.canvas,
      this.disc.lens,
      this.plate,
      this.emptyNotice,
    ]);
    const goButton = el("button", { type: "button", text: "Go" });
    this.gotoRow = el("div", { class: "goto-row" }, [
      el("label", { for: "goto-gmt", text: "Go to GMT" }),
      this.gotoInput,
      goButton,
    ]);
    goButton.addEventListener("click", () => this.goToTypedGmt());
    this.gotoInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.goToTypedGmt();
      }
    });

    this.rateRadios = ([1, 10, 60] as PlaybackRate[]).map((rate) => {
      const input = el("input", {
        type: "radio",
        name: "playback-rate",
        id: `rate-${rate}`,
        value: String(rate),
      });
      input.checked = rate === 1;
      input.addEventListener("change", () => {
        if (input.checked) {
          this.rate = rate;
        }
      });
      return { rate, input };
    });
    this.playbackRow = el("div", { class: "playback-row" }, [
      this.playButton,
      el(
        "div",
        { role: "radiogroup", "aria-label": "Playback rate", class: "radiogroup" },
        this.rateRadios.flatMap(({ rate, input }) => [
          el("div", { class: "radio-row" }, [
            input,
            el("label", { for: `rate-${rate}`, text: `${rate}\u00d7` }),
          ]),
        ]),
      ),
    ]);
    this.playButton.addEventListener("click", () => this.togglePlayback());
    this.pinButton.addEventListener("click", () => this.openPinDialog(this.pinButton));

    this.distanceRadios = (["km", "nmi"] as DistanceUnit[]).map((unit) => {
      const input = el("input", {
        type: "radio",
        name: "distance-unit",
        id: `distance-${unit}`,
        value: unit,
      });
      input.addEventListener("change", () => {
        if (input.checked) {
          void this.chooseDistance(unit);
        }
      });
      return { unit, input };
    });
    this.speedRadios = (["m_s", "ft_s"] as SpeedUnit[]).map((unit) => {
      const input = el("input", {
        type: "radio",
        name: "speed-unit",
        id: `speed-${unit}`,
        value: unit,
      });
      input.addEventListener("change", () => {
        if (input.checked) {
          void this.chooseSpeed(unit);
        }
      });
      return { unit, input };
    });
    this.pinCheckbox.checked = true;
    this.tickCheckbox.checked = true;
    this.pinCheckbox.addEventListener("change", () => {
      this.showPins = this.pinCheckbox.checked;
      this.redrawDisc();
    });
    this.tickCheckbox.addEventListener("change", () => {
      this.showTicks = this.tickCheckbox.checked;
      this.redrawDisc();
    });
    this.channelRail = el("aside", { class: "channel-rail", "aria-label": "Channels" }, [
      el(
        "div",
        { role: "radiogroup", "aria-label": "Distance", class: "radiogroup" },
        this.distanceRadios.map(({ unit, input }) =>
          el("div", { class: "radio-row" }, [
            input,
            el("label", { for: `distance-${unit}`, text: unit }),
          ]),
        ),
      ),
      el(
        "div",
        { role: "radiogroup", "aria-label": "Speed", class: "radiogroup" },
        this.speedRadios.map(({ unit, input }) =>
          el("div", { class: "radio-row" }, [
            input,
            el("label", { for: `speed-${unit}`, text: unit === "m_s" ? "m/s" : "ft/s" }),
          ]),
        ),
      ),
      el("div", { class: "radio-row" }, [
        this.pinCheckbox,
        el("label", { for: "channel-pins", text: "Event pins" }),
      ]),
      el("div", { class: "radio-row" }, [
        this.tickCheckbox,
        el("label", { for: "channel-ticks", text: "Transcript ticks" }),
      ]),
      this.closeChannels,
    ]);
    this.channelsButton.addEventListener("click", () => this.toggleDrawer());
    this.closeChannels.addEventListener("click", () => this.closeDrawer());
    this.channelRail.addEventListener("keydown", (event) => {
      if (!this.wide && this.drawerOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeDrawer();
          return;
        }
        trapFocus(this.channelRail, event);
      }
    });

    this.eventsRegion = eventsPanel(this);
    this.landmarks = landmarksPanel(this);
    this.reference = this.mode === "author" ? referencePanel(this) : null;
    this.passes =
      this.mode === "author" ? passesPanel(this, (file) => void this.upload(file)) : null;
    this.captures = this.mode === "share" ? capturesPanel(this) : null;
    this.share = this.mode === "author" ? sharePanel(this) : null;
    this.subscribers = this.mode === "author" ? subscribersPanel(this) : null;
  }

  mission(): ConsoleMission {
    return this.missionData;
  }

  samples(): readonly Sample[] {
    return this.trackSamples;
  }

  lines(): readonly TranscriptLine[] {
    return this.transcriptLines;
  }

  speakers(): readonly Speaker[] {
    return this.speakerList;
  }

  events(): readonly MissionEvent[] {
    return this.eventList;
  }

  distanceUnit(): DistanceUnit {
    return this.viewDistance;
  }

  speedUnit(): SpeedUnit {
    return this.viewSpeed;
  }

  lensIndex(): number {
    return this.lens;
  }

  consoleStatus(message: string): void {
    announce(this.consoleStatusRegion, message);
  }

  uploadStatus(message: string): void {
    announce(this.uploadStatusRegion, message);
  }

  downloadStatus(message: string): void {
    announce(this.downloadStatusRegion, message);
  }

  refreshSearch(): void {
    this.transcript.refresh();
  }

  focusSlider(): void {
    this.disc.canvas.focus();
  }

  start(): void {
    this.build();
    void this.loadAll().then(() => this.applyAddress());
    void this.loadStatus();
    setInterval(() => void this.loadStatus(), STATUS_INTERVAL_MS);
    setInterval(() => void this.pollPasses(), PASS_POLL_MS);
    window.addEventListener("resize", () => this.onResize());
    window.matchMedia("(forced-colors: active)").addEventListener("change", () =>
      this.redrawDisc(),
    );
    if (this.mode === "author") {
      this.openAuthorStream();
    } else {
      this.openShareStream();
    }
  }

  private build(): void {
    clear(this.root);
    this.pinButton.classList.add("pin-button");
    this.applyLayout();
  }

  /** The published layouts: the order given is reading order and Tab order. */
  private applyLayout(): void {
    const layout = layoutFor(window.innerWidth);
    this.wide = layout === "wide";
    document.body.classList.remove("layout-narrow", "layout-medium", "layout-wide");
    document.body.classList.add(`layout-${layout}`);
    this.channelsButton.hidden = this.wide;
    this.closeChannels.hidden = this.wide;

    if (this.wide) {
      this.channelRail.setAttribute("role", "complementary");
      this.channelRail.removeAttribute("aria-modal");
      this.channelRail.hidden = false;
      this.channelRail.removeAttribute("inert");
      this.drawerOpen = false;
      this.channelsButton.setAttribute("aria-expanded", "false");
    } else {
      this.channelRail.setAttribute("role", "dialog");
      this.channelRail.setAttribute("aria-modal", "true");
      if (!this.drawerOpen) {
        this.channelRail.hidden = true;
        this.channelRail.setAttribute("inert", "");
      }
    }

    const belowDisc: HTMLElement[] =
      this.mode === "author"
        ? this.wide
          ? [this.gotoRow, this.pinButton, this.playbackRow]
          : [this.gotoRow, this.playbackRow, this.pinButton]
        : [this.gotoRow, this.playbackRow];
    const lower: HTMLElement[] = [this.eventsRegion.element, this.landmarks.element];
    for (const panel of [this.reference, this.passes, this.captures, this.share, this.subscribers]) {
      if (panel) {
        lower.push(panel.element);
      }
    }

    const order: HTMLElement[] = [
      this.metBand,
      this.channelRail,
      this.header,
      this.bannerBox,
      this.discPane,
    ];
    if (layout === "medium") {
      order.push(this.rightColumn);
      this.rightColumn.append(this.plate, ...belowDisc);
      order.push(this.transcript.element, ...lower);
    } else {
      this.discPane.append(this.plate);
      this.rightColumn.remove();
      order.push(...belowDisc);
      if (this.wide) {
        order.push(...lower, this.transcript.element);
      } else {
        order.push(this.transcript.element, ...lower);
      }
    }
    if (this.mode === "author") {
      order.push(this.uploadStatusRegion, this.consoleStatusRegion);
    }
    order.push(this.downloadStatusRegion);
    for (const node of order) {
      this.root.append(node);
    }
    this.redrawDisc();
  }

  private onResize(): void {
    const layout = layoutFor(window.innerWidth);
    if (!document.body.classList.contains(`layout-${layout}`)) {
      this.applyLayout();
      return;
    }
    this.redrawDisc();
  }

  private toggleDrawer(): void {
    if (this.drawerOpen) {
      this.closeDrawer();
      return;
    }
    this.drawerOpen = true;
    this.channelRail.hidden = false;
    this.channelRail.removeAttribute("inert");
    this.channelRail.classList.toggle("instant", prefersReducedMotion());
    this.channelsButton.setAttribute("aria-expanded", "true");
    const checked = this.distanceRadios.find((radio) => radio.input.checked);
    (checked ?? this.distanceRadios[0]).input.focus();
  }

  private closeDrawer(): void {
    this.drawerOpen = false;
    this.channelRail.hidden = true;
    this.channelRail.setAttribute("inert", "");
    this.channelsButton.setAttribute("aria-expanded", "false");
    this.channelsButton.focus();
  }

  // ---- data loading -------------------------------------------------------

  private async loadAll(): Promise<void> {
    await this.loadMission();
    await this.loadTrackData();
    this.renderAll();
  }

  private async loadMission(): Promise<void> {
    if (this.mode === "author") {
      const result = await getJsonRetrying<Mission>(this.apiBase);
      if (!result.ok) {
        return;
      }
      const mission = result.data;
      this.missionData = {
        name: mission.name,
        epochMs: parseIsoInstant(mission.epoch_utc) as number,
        distanceUnit: mission.distance_unit,
        speedUnit: mission.speed_unit,
        sampleCount: mission.sample_count,
        totalBytes: mission.total_bytes,
        perilune: mission.perilune,
        reference: mission.reference,
        landmarks: mission.landmarks,
        passes: mission.passes,
        sharePasses: [],
        share: mission.share,
        changeVersion: mission.change_version,
        expiresUtc: null,
      };
      this.viewDistance = mission.distance_unit;
      this.viewSpeed = mission.speed_unit;
      this.lastVersion = mission.change_version;
      return;
    }
    const result = await getJsonRetrying<ShareMission>(this.apiBase);
    if (!result.ok) {
      this.handleShareFailure(result.code);
      return;
    }
    const share = result.data;
    this.missionData = {
      name: share.mission.name,
      epochMs: parseIsoInstant(share.mission.epoch_utc) as number,
      distanceUnit: share.mission.distance_unit,
      speedUnit: share.mission.speed_unit,
      sampleCount: share.mission.sample_count,
      totalBytes: 0,
      perilune: share.mission.perilune,
      reference: share.mission.reference,
      landmarks: share.landmarks,
      passes: [],
      sharePasses: share.passes,
      share: null,
      changeVersion: share.mission.change_version,
      expiresUtc: share.expires_utc,
    };
    this.lastVersion = share.mission.change_version;
    const addressDistance = new URLSearchParams(window.location.search).get("distance");
    const addressSpeed = new URLSearchParams(window.location.search).get("speed");
    this.viewDistance =
      addressDistance === "km" || addressDistance === "nmi"
        ? addressDistance
        : share.mission.distance_unit;
    this.viewSpeed =
      addressSpeed === "m_s" || addressSpeed === "ft_s"
        ? addressSpeed
        : share.mission.speed_unit;
  }

  private handleShareFailure(code: string): void {
    if (code === "link_revoked") {
      this.showNotice(pages.revoked.heading, pages.revoked.line);
    } else if (code === "link_expired") {
      this.showNotice(pages.expired.heading, pages.expired.line);
    } else if (code === "not_found") {
      this.showNotice(pages.unknownLink.heading, pages.unknownLink.line);
    }
  }

  private showNotice(heading: string, line: string): void {
    clear(this.root);
    this.root.className = "notice";
    this.root.append(el("h1", { text: heading }));
    if (line.length > 0) {
      this.root.append(el("p", { text: line }));
    }
  }

  private async loadTrackData(): Promise<void> {
    const [track, transcript, speakers, events] = await Promise.all([
      getJsonRetrying<{ samples: Sample[] }>(`${this.apiBase}/track`),
      getJsonRetrying<{ lines: TranscriptLine[] }>(`${this.apiBase}/transcript`),
      getJsonRetrying<{ speakers: Speaker[] }>(`${this.apiBase}/speakers`),
      getJsonRetrying<{ events: MissionEvent[] }>(`${this.apiBase}/events`),
    ]);
    if (track.ok) {
      this.trackSamples = track.data.samples;
    }
    if (transcript.ok) {
      this.transcriptLines = transcript.data.lines;
    }
    if (speakers.ok) {
      this.speakerList = speakers.data.speakers;
    }
    if (events.ok) {
      this.eventList = events.data.events;
    }
  }

  async reload(): Promise<void> {
    await this.loadMission();
    await this.loadTrackData();
    this.renderAll();
  }

  /** The track-reload rule: playback pauses, the lens keeps its MET. */
  async reloadTrack(): Promise<void> {
    this.pausePlayback();
    const previousMet = this.trackSamples[this.lens]?.met ?? 0;
    await this.loadMission();
    await this.loadTrackData();
    this.lens = this.trackSamples.length === 0 ? 0 : snapIndex(this.trackSamples, previousMet);
    this.renderAll();
  }

  private renderAll(): void {
    this.heading.textContent = this.missionData.name;
    document.title = `${this.missionData.name} \u00b7 Perilune Ledger`;
    this.epochLine.textContent = `Epoch ${formatDoy(this.missionData.epochMs)}`;
    const perilune = this.missionData.perilune;
    this.perilunLine.hidden = perilune === null;
    if (perilune) {
      this.perilunLine.textContent = `Perilune ${formatDistance(
        perilune.altitude_m,
        this.viewDistance,
      )} at ${perilune.met_label}`;
    }
    this.expiryLine.hidden = this.missionData.expiresUtc === null;
    if (this.missionData.expiresUtc) {
      this.expiryLine.textContent = `Expires ${formatDoy(
        parseIsoInstant(this.missionData.expiresUtc) as number,
      )}`;
    }
    for (const radio of this.distanceRadios) {
      radio.input.checked = radio.unit === this.viewDistance;
    }
    for (const radio of this.speedRadios) {
      radio.input.checked = radio.unit === this.viewSpeed;
    }
    const empty = this.trackSamples.length === 0;
    this.emptyNotice.hidden = !empty;
    this.disc.canvas.hidden = empty;
    this.plate.hidden = empty;
    this.gotoRow.hidden = empty;
    this.playbackRow.hidden = empty;
    this.pinButton.hidden = empty;
    if (empty) {
      this.disc.closeLens();
    }
    this.eventsRegion.update();
    this.landmarks.update();
    this.reference?.update();
    this.passes?.update();
    this.captures?.update();
    this.share?.update();
    this.subscribers?.update();
    this.transcript.update();
    this.disc.setScene({
      samples: this.trackSamples,
      landmarks: this.missionData.landmarks,
      lines: this.transcriptLines,
      events: this.eventList,
      perilune: this.missionData.perilune,
      showPins: this.showPins,
      showTicks: this.showTicks,
    });
    this.lens = Math.min(this.lens, Math.max(0, this.trackSamples.length - 1));
    this.updateReadout();
  }

  private redrawDisc(): void {
    this.disc.setScene({
      samples: this.trackSamples,
      landmarks: this.missionData.landmarks,
      lines: this.transcriptLines,
      events: this.eventList,
      perilune: this.missionData.perilune,
      showPins: this.showPins,
      showTicks: this.showTicks,
    });
  }

  // ---- the lens and the readout -------------------------------------------

  private setLens(index: number, writeAddress: boolean): void {
    this.lens = index;
    this.disc.clearFramePoint();
    this.disc.setLensIndex(index);
    this.updateReadout();
    if (writeAddress) {
      const sample = this.trackSamples[index];
      if (sample) {
        this.writeAddress({ t: String(sample.met) });
      }
    }
  }

  goToMet(met: number, writeAddress: boolean): void {
    this.pausePlayback();
    if (this.trackSamples.length === 0) {
      return;
    }
    this.setLens(snapIndex(this.trackSamples, met), writeAddress);
  }

  private updateReadout(): void {
    const sample = this.trackSamples[this.lens];
    if (!sample) {
      this.metReadout.textContent = "";
      return;
    }
    this.renderPlate(
      {
        met_label: sample.met_label,
        utc_ms: parseIsoInstant(sample.utc) as number,
        lat_deg: sample.lat_deg,
        lon_deg: sample.lon_deg,
        altitude_m: sample.altitude_m,
        speed_m_s: sample.speed_m_s,
        residual_m: sample.residual_m,
      },
      sample,
    );
    this.disc.setValueText(
      `${sample.met_label}, altitude ${formatDistance(sample.altitude_m, this.viewDistance)}`,
    );
    this.disc.canvas.setAttribute("aria-valuenow", String(this.lens));
    this.transcript.setCurrentMet(sample.met);
  }

  private renderPlate(
    values: {
      met_label: string;
      utc_ms: number;
      lat_deg: number;
      lon_deg: number;
      altitude_m: number;
      speed_m_s: number;
      residual_m: number | null;
    },
    rangeSample: Sample,
  ): void {
    const lines = readoutLines(
      {
        met_label: values.met_label,
        utc_ms: values.utc_ms,
        lat_deg: values.lat_deg,
        lon_deg: values.lon_deg,
        altitude_m: values.altitude_m,
        speed_m_s: values.speed_m_s,
        residual_m: values.residual_m,
      },
      {
        distanceUnit: this.viewDistance,
        speedUnit: this.viewSpeed,
        hasReference: this.missionData.reference !== null,
        landmarks: this.missionData.landmarks,
      },
    );
    const ranges = readoutLines(
      {
        met_label: rangeSample.met_label,
        utc_ms: parseIsoInstant(rangeSample.utc) as number,
        lat_deg: rangeSample.lat_deg,
        lon_deg: rangeSample.lon_deg,
        altitude_m: rangeSample.altitude_m,
        speed_m_s: rangeSample.speed_m_s,
        residual_m: rangeSample.residual_m,
      },
      {
        distanceUnit: this.viewDistance,
        speedUnit: this.viewSpeed,
        hasReference: this.missionData.reference !== null,
        landmarks: this.missionData.landmarks,
      },
    );
    const merged = lines.map((line) =>
      line.label === "\u0394R" || line.label.startsWith("Range to ")
        ? (ranges.find((candidate) => candidate.label === line.label) ?? line)
        : line,
    );
    const labels = merged.map((line) => line.label).join("|");
    if (this.plate.dataset.labels !== labels) {
      clear(this.plate);
      this.plateLines = new Map();
      for (const line of merged) {
        const value = el("span", { class: "plate-value" });
        this.plate.append(
          el("div", { class: "plate-line" }, [
            el("span", { class: "plate-label", text: line.label }),
            value,
          ]),
        );
        this.plateLines.set(line.label, value);
      }
      this.plate.dataset.labels = labels;
    }
    for (const line of merged) {
      const target = this.plateLines.get(line.label);
      if (target) {
        rollText(target, line.value);
      }
    }
    rollText(this.metReadout, values.met_label);
  }

  // ---- playback -----------------------------------------------------------

  private async fetchFrames(from: number, to: number, fps: FrameRate): Promise<Frame[]> {
    const result = await getJsonRetrying<{ fps: number; frames: Frame[] }>(
      `${this.apiBase}/frames?from=${from}&to=${to}&fps=${fps}`,
    );
    return result.ok ? result.data.frames : [];
  }

  private togglePlayback(): void {
    if (this.playback.playing) {
      const index = this.playback.pause();
      this.stopPlaybackChrome();
      this.setLens(index, true);
      return;
    }
    this.playButton.textContent = "Pause";
    this.playButton.setAttribute("aria-label", "Pause");
    for (const radio of this.rateRadios) {
      radio.input.disabled = true;
    }
    this.playback.start(this.lens, this.rate);
    this.playButton.focus();
  }

  private pausePlayback(): void {
    if (!this.playback.playing) {
      return;
    }
    const index = this.playback.pause();
    this.stopPlaybackChrome();
    this.lens = index;
    this.disc.setLensIndex(index);
    this.updateReadout();
  }

  private stopPlaybackChrome(): void {
    this.playButton.textContent = "Play";
    this.playButton.removeAttribute("aria-label");
    for (const radio of this.rateRadios) {
      radio.input.disabled = false;
    }
    this.plate.classList.remove("playing");
  }

  private showFrame(frame: Frame | null, snapped: number): void {
    const sample = this.trackSamples[snapped];
    if (!sample) {
      return;
    }
    this.plate.classList.add("playing");
    if (!frame) {
      this.lens = snapped;
      this.disc.setLensIndex(snapped);
      this.updateReadout();
      return;
    }
    const metSeconds = Math.floor(frame.met_ms / 1000);
    this.renderPlate(
      {
        met_label: formatMetLabel(metSeconds),
        utc_ms: this.missionData.epochMs + metSeconds * 1000,
        lat_deg: frame.lat_deg,
        lon_deg: frame.lon_deg,
        altitude_m: frame.altitude_m,
        speed_m_s: frame.speed_m_s,
        residual_m: sample.residual_m,
      },
      sample,
    );
    this.disc.canvas.setAttribute("aria-valuenow", String(snapped));
    this.disc.setValueText(
      `${sample.met_label}, altitude ${formatDistance(sample.altitude_m, this.viewDistance)}`,
    );
    this.transcript.setCurrentMet(sample.met);
    if (this.disc.isLensOpen) {
      this.disc.setFramePoint(frame.lat_deg, frame.lon_deg);
    }
  }

  // ---- Go to GMT ----------------------------------------------------------

  private goToTypedGmt(): void {
    fieldError(this.gotoInput, null);
    const ms = parseDoyToMs(this.gotoInput.value.trim());
    if (ms === null) {
      fieldError(this.gotoInput, fieldErrors.dayOfYear);
      return;
    }
    const met = Math.floor((ms - this.missionData.epochMs) / 1000);
    this.goToMet(met, true);
  }

  // ---- units --------------------------------------------------------------

  private async chooseDistance(unit: DistanceUnit): Promise<void> {
    this.viewDistance = unit;
    this.afterUnitChange();
    if (this.mode === "share") {
      this.writeAddress({ distance: unit });
      return;
    }
    await this.saveUnits({ distance_unit: unit });
  }

  private async chooseSpeed(unit: SpeedUnit): Promise<void> {
    this.viewSpeed = unit;
    this.afterUnitChange();
    if (this.mode === "share") {
      this.writeAddress({ speed: unit });
      return;
    }
    await this.saveUnits({ speed_unit: unit });
  }

  private afterUnitChange(): void {
    this.updateReadout();
    this.eventsRegion.update();
    this.landmarks.update();
    const perilune = this.missionData.perilune;
    if (perilune) {
      this.perilunLine.textContent = `Perilune ${formatDistance(
        perilune.altitude_m,
        this.viewDistance,
      )} at ${perilune.met_label}`;
    }
  }

  private async saveUnits(patch: Record<string, string>): Promise<void> {
    const result = await request<Mission>("PATCH", this.apiBase, {
      body: patch,
      contentType: "application/merge-patch+json",
    });
    const distanceLabel = this.viewDistance;
    const speedLabel = this.viewSpeed === "m_s" ? "m/s" : "ft/s";
    if (result.ok) {
      this.missionData.distanceUnit = result.data.distance_unit;
      this.missionData.speedUnit = result.data.speed_unit;
      this.consoleStatus(consoleCopy.unitsSaved(distanceLabel, speedLabel));
      return;
    }
    this.consoleStatus(consoleCopy.unitsRefused);
  }

  // ---- the address --------------------------------------------------------

  private writeAddress(changes: Record<string, string>): void {
    const parameters = new URLSearchParams(window.location.search);
    for (const [name, value] of Object.entries(changes)) {
      if (value.length === 0) {
        parameters.delete(name);
      } else {
        parameters.set(name, value);
      }
    }
    const query = parameters.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query.length > 0 ? `?${query}` : ""}`,
    );
  }

  private applyAddress(): void {
    const parameters = new URLSearchParams(window.location.search);
    const t = parameters.get("t");
    if (this.trackSamples.length > 0) {
      const met = t !== null && /^-?\d+$/.test(t) ? Number(t) : null;
      this.lens = met === null ? 0 : snapIndex(this.trackSamples, met);
      this.setLensQuietly(this.lens);
    }
    const q = parameters.get("q");
    if (q !== null) {
      const trimmed = q.trim();
      if (trimmed.length >= 1 && trimmed.length <= 200) {
        this.transcript.openQuery(trimmed);
      }
    }
  }

  private setLensQuietly(index: number): void {
    this.disc.setLensIndex(index);
    this.updateReadout();
  }

  // ---- pinning ------------------------------------------------------------

  private openPinDialog(opener: HTMLElement): void {
    const sample = this.trackSamples[this.lens];
    if (!sample) {
      return;
    }
    openPinEventDialog({
      metLabel: sample.met_label,
      apiBase: this.apiBase,
      status: (message) => this.consoleStatus(message),
      onSaved: () => {
        void this.reload().then(() => this.refreshSearch());
      },
      onClosed: () => opener.focus(),
    });
  }

  // ---- uploads ------------------------------------------------------------

  private async upload(file: File): Promise<void> {
    const key = requestKey();
    const bytes = await file.arrayBuffer();
    const checksum = await sha256Hex(bytes);
    const filename = file.name.normalize("NFC");
    this.uploadStatus(uploadCopy.pending(filename));
    this.missionData.passes = [
      ...this.missionData.passes,
      {
        id: `pending-${key}`,
        mission_id: this.missionId ?? "",
        filename,
        state: "uploading",
        size_bytes: file.size,
        sha256: checksum,
        sample_count: 0,
        transcript_line_count: 0,
        rejected_line: null,
        rejected_reason: null,
        created_at: isoInstant(Date.now()),
      } satisfies Pass,
    ];
    this.passes?.update();

    const send = (): Promise<{ status: number; body: Record<string, unknown> | null }> =>
      new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${this.apiBase}/passes`);
        xhr.setRequestHeader("content-type", "application/octet-stream");
        xhr.setRequestHeader("idempotency-key", key);
        xhr.setRequestHeader("x-capture-filename", encodeCaptureName(filename));
        xhr.setRequestHeader("x-capture-sha256", checksum);
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            this.passes?.setProgress(event.loaded / event.total);
          }
        });
        xhr.addEventListener("load", () => {
          let body: Record<string, unknown> | null = null;
          try {
            body = JSON.parse(xhr.responseText) as Record<string, unknown>;
          } catch {
            body = null;
          }
          resolve({ status: xhr.status, body });
        });
        xhr.addEventListener("error", () => resolve({ status: 0, body: null }));
        xhr.addEventListener("abort", () => resolve({ status: 0, body: null }));
        xhr.send(bytes);
      });

    let answer = await send();
    if (answer.status === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      answer = await send();
    }
    while (
      answer.status === 409 &&
      (answer.body as { error?: string } | null)?.error === "idempotency_request_in_progress"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      answer = await send();
    }
    this.passes?.setProgress(0);
    this.missionData.passes = this.missionData.passes.filter(
      (pass) => pass.id !== `pending-${key}`,
    );

    if (answer.status === 202) {
      const stored = answer.body as unknown as Pass | null;
      if (stored?.id) {
        this.watchedPasses.add(stored.id);
      }
      const status = await getJson<ServiceStatus>("/api/status");
      this.uploadStatus(
        status.ok && status.data.queue === "down"
          ? uploadCopy.storedQueueDown(filename)
          : uploadCopy.stored(filename),
      );
      await this.reload();
      return;
    }
    this.announceUploadRefusal(filename, answer.status, answer.body ?? {});
    await this.reload();
  }

  private announceUploadRefusal(
    filename: string,
    status: number,
    body: Record<string, unknown>,
  ): void {
    const code = String(body.error ?? "");
    if (code === "duplicate_capture") {
      this.uploadStatus(uploadCopy.duplicate(filename));
      return;
    }
    if (code === "quota_exceeded") {
      this.uploadStatus(
        uploadCopy.quota(
          filename,
          Number(body.used_bytes ?? 0),
          Number(body.quota_bytes ?? 0),
        ),
      );
      return;
    }
    if (code === "capture_too_large" || status === 413) {
      this.uploadStatus(uploadCopy.tooLarge(filename));
      return;
    }
    if (code === "storage_unavailable" || status === 0) {
      this.uploadStatus(uploadCopy.storageOffline(filename));
      return;
    }
    const errors = (body.errors ?? {}) as Record<string, string>;
    const order = ["idempotency_key", "filename", "sha256", "body"];
    const message = order.map((field) => errors[field]).find((value) => value !== undefined);
    this.uploadStatus(uploadCopy.refused(filename, message ?? code));
  }

  private async pollPasses(): Promise<void> {
    if (this.mode !== "author") {
      return;
    }
    const waiting = new Set(this.watchedPasses);
    for (const pass of this.missionData.passes) {
      if (pass.state === "stored" && !pass.id.startsWith("pending-")) {
        waiting.add(pass.id);
      }
    }
    if (waiting.size === 0) {
      return;
    }
    for (const passId of waiting) {
      const result = await getJson<Pass>(`/api/passes/${passId}`);
      if (!result.ok) {
        this.watchedPasses.delete(passId);
        continue;
      }
      if (result.data.state === "parsed") {
        this.watchedPasses.delete(passId);
        this.uploadStatus(
          uploadCopy.parsed(
            result.data.filename,
            result.data.sample_count,
            result.data.transcript_line_count,
          ),
        );
        await this.reloadTrack();
        this.refreshSearch();
        return;
      }
      if (result.data.state === "rejected") {
        this.watchedPasses.delete(passId);
        const reason = result.data.rejected_reason ?? "parser_failed";
        this.uploadStatus(
          result.data.rejected_line === null
            ? uploadCopy.rejected(result.data.filename, reason)
            : uploadCopy.rejectedAtLine(result.data.filename, result.data.rejected_line, reason),
        );
        await this.reload();
        return;
      }
    }
  }

  // ---- banners and streams -----------------------------------------------

  private async loadStatus(): Promise<void> {
    const result = await getJson<ServiceStatus>("/api/status");
    if (!result.ok) {
      return;
    }
    const show: string[] = [];
    if (result.data.storage === "down") {
      show.push(banners.storage);
    }
    if (result.data.search === "down") {
      show.push(banners.search);
    }
    if (this.mode === "author") {
      if (result.data.queue === "down") {
        show.push(banners.queue);
      }
      if (result.data.webhooks === "down") {
        show.push(banners.webhooks);
      }
    }
    clear(this.bannerBox);
    for (const banner of show) {
      this.bannerBox.append(el("p", { role: "alert", class: "banner", text: banner }));
    }
  }

  private openAuthorStream(): void {
    const stream = new EventSource(`${this.apiBase}/stream`);
    stream.addEventListener("readers", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        readers: number | null;
      };
      this.share?.setReaders(data.readers);
    });
  }

  private openShareStream(): void {
    const stream = new EventSource(`${this.apiBase}/stream`);
    stream.addEventListener("error", () => {
      void getJson<unknown>(this.apiBase).then((result) => {
        if (!result.ok) {
          this.handleShareFailure(result.code);
        }
      });
    });
    stream.addEventListener("mission-changed", (event) => {
      const message = event as MessageEvent<string>;
      const data = JSON.parse(message.data) as { version: number };
      if (data.version === this.lastVersion) {
        return;
      }
      this.lastVersion = data.version;
      void this.reloadTrack().then(() => this.refreshSearch());
    });
  }
}

/** Rolls each changed numeral; accessible text changes at once. */
function rollText(target: HTMLElement, text: string): void {
  const previous = target.dataset.value ?? "";
  if (previous === text) {
    return;
  }
  target.dataset.value = text;
  if (prefersReducedMotion() || previous.length !== text.length) {
    target.textContent = text;
    return;
  }
  clear(target);
  for (let index = 0; index < text.length; index += 1) {
    const changed = previous[index] !== text[index];
    const grew = (text[index] ?? "") > (previous[index] ?? "");
    target.append(
      el("span", {
        class: changed ? (grew ? "digit roll-up" : "digit roll-down") : "digit",
        text: text[index],
      }),
    );
  }
}
