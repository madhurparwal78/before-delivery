import { LadderEngine, RungUpdate, StationView, rungSentences, JourneyResponse } from "./ladder.js";
import { apiFetch, ApiError } from "./api.js";
import { CorridorRenderer } from "./corridor.js";
import { AudioEngine } from "./audio.js";
import { formatInstant, monthLabel } from "../shared/dates.js";
import { Layer, Station } from "../shared/domain.js";

/**
 * The private listening page (DP-17, DP-48, DP-52): one station under an NDA
 * notice, live link checks, the link-end fade and the brief form.
 */

const COPY = {
  nda: (date: string) => `Private listening under NDA. This link stops working on ${date}.`,
  revoked: "This listening link is not available.",
  expired: "This listening link has expired. Ask Kettlehole Audio for a new one.",
  resting: "Audio is resting. Credits and notes are still here.",
  loadFailed: "The corridor could not load. Refresh to try again.",
  sending: "Sending your brief…",
  sendingButton: "Sending…",
  received: (reference: string) => `Brief ${reference} received. A receipt will follow by email.`,
  checkFields: "Check the highlighted fields.",
  paced: (wait: string) => `You have sent several briefs in a short time. Try again in ${wait}.`,
  fileTooLarge: "That file is too large. The limit is 10,000,000 bytes.",
  fileUnsupported: "That file type isn’t accepted. Send WAV, OGG, MP3 or PDF.",
  storageDown: "Reference files can’t be stored right now. Send the brief without the file, or try again later.",
  wavFormat: "That WAV isn’t PCM or float audio. Send WAV, OGG, MP3 or PDF.",
  wavChannels: "That WAV must have one or two channels. Send a mono or stereo file.",
  wavRate: "That WAV’s sample rate isn’t accepted. Use 22,050 to 96,000 Hz.",
  wavDecode: "That WAV can’t be decoded. Send another file.",
  connectionLost: "Connection lost. Retrying your brief…",
  couldNotConfirm: "We couldn't confirm your brief was received. Press Send brief to try again. It won't be sent twice.",
  monthFull: (label: string) => `${label} is now fully booked. Choose another month or No preference.`,
  generic: "Something went wrong. Your brief was not sent.",
};

class ListenPage {
  private readonly gate: HTMLDialogElement;
  private readonly notice: HTMLElement;
  private readonly linkStatus: HTMLElement;
  private readonly stationsContainer: HTMLElement;
  private readonly layerChanges: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly readoutValue: HTMLElement;
  private readonly corridor: CorridorRenderer | null;
  private readonly audio = new AudioEngine();
  private readonly reducedMotion: boolean;
  private readonly token: string;
  private engine!: LadderEngine;
  private stations: StationView[] = [];
  private stationData: Station[] = [];
  private checking = true;
  private expiresAt: Date | null = null;

  constructor() {
    this.gate = document.getElementById("gate") as HTMLDialogElement;
    this.notice = document.getElementById("nda-notice") as HTMLElement;
    this.linkStatus = document.getElementById("link-status") as HTMLElement;
    this.stationsContainer = document.getElementById("stations") as HTMLElement;
    this.layerChanges = document.getElementById("layer-changes") as HTMLElement;
    this.readout = document.getElementById("readout") as HTMLElement;
    this.readoutValue = document.getElementById("readout-value") as HTMLElement;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.getElementById("corridor") as HTMLCanvasElement;
    this.corridor = new CorridorRenderer(canvas, this.reducedMotion);
    if (!this.corridor.available) {
      (document.getElementById("corridor-fallback") as HTMLElement).hidden = false;
      canvas.hidden = true;
    }
    this.token = window.location.pathname.split("/").pop() || "";
  }

  async init(): Promise<void> {
    this.wireGate();
    this.gate.showModal();
    (document.getElementById("gate-sound") as HTMLButtonElement).focus();
    await this.loadLink();
    this.wireBriefForm();
    await this.loadMonths();
    window.setInterval(() => void this.loadMonths(), 2000);
    window.addEventListener("scroll", () => this.onScroll(), { passive: true });
    window.setInterval(() => this.onScroll(), 80);
  }

  private wireGate(): void {
    const sound = document.getElementById("gate-sound") as HTMLButtonElement;
    const muted = document.getElementById("gate-muted") as HTMLButtonElement;
    const intro = document.getElementById("intro-heading") as HTMLElement;
    const toggle = document.getElementById("sound-toggle") as HTMLButtonElement;
    sound.addEventListener("click", async () => {
      await this.audio.start();
      this.audio.setMuted(false);
      toggle.setAttribute("aria-pressed", "true");
      this.closeGate();
    });
    muted.addEventListener("click", () => {
      this.audio.setMuted(true);
      toggle.setAttribute("aria-pressed", "false");
      this.closeGate();
    });
    this.gate.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.audio.setMuted(true);
        toggle.setAttribute("aria-pressed", "false");
        this.closeGate();
      }
      if (event.key === "Tab") {
        const focusables = [sound, muted];
        const focused = document.activeElement as HTMLElement;
        const first = focusables[0];
        const last = focusables[1];
        if (event.shiftKey && focused === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && focused === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    toggle.addEventListener("click", async () => {
      const pressed = toggle.getAttribute("aria-pressed") === "true";
      if (!pressed) await this.audio.start();
      this.audio.setMuted(!pressed);
      toggle.setAttribute("aria-pressed", String(!pressed));
    });
    void intro;
  }

  private closeGate(): void {
    const intro = document.getElementById("intro-heading") as HTMLElement;
    if (this.reducedMotion) {
      this.gate.close();
      intro.focus();
      return;
    }
    this.gate.classList.add("gate-fade");
    window.setTimeout(() => {
      this.gate.close();
      this.gate.classList.remove("gate-fade");
      intro.focus();
    }, 400);
  }

  private async loadLink(): Promise<void> {
    try {
      const data = await apiFetch<{ station: Station; expires_at: string; nda: boolean }>(
        `/api/listen/${this.token}`,
      );
      this.expiresAt = new Date(data.expires_at);
      this.notice.textContent = COPY.nda(formatInstant(this.expiresAt, (window as unknown as { OPERATOR_TZ?: string }).OPERATOR_TZ || "America/Toronto"));
      this.notice.hidden = false;
      this.stationData = [data.station];
      this.buildStation(data.station);
      this.engine = new LadderEngine(this.stations, this.reducedMotion, {
        onRungChange: (update) => this.onRungChange(update),
      });
      this.onScroll();
      this.scheduleChecks();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 410) {
          this.endLink(COPY.expired);
        } else {
          this.endLink(COPY.revoked);
        }
        return;
      }
      this.layerChanges.textContent = COPY.loadFailed;
    }
  }

  private buildStation(station: Station): void {
    const chapter = document.createElement("section");
    chapter.className = "station-chapter";
    chapter.dataset.station = station.slug;
    chapter.dataset.intensity = "0";
    chapter.dataset.camera = "wide";
    const stage = document.createElement("div");
    stage.className = "station-stage";
    const text = document.createElement("div");
    text.className = "station-text";
    text.innerHTML = `
      <p class="credit-label">${escapeHtml(station.credit_label)}</p>
      <h2 tabindex="-1">${escapeHtml(station.title)}</h2>
      <p class="role">${escapeHtml(station.role)}</p>
      <p class="credit-line">${escapeHtml(station.credit_line)}</p>
      <p class="blurb">${escapeHtml(station.blurb)}</p>
      ${station.playable ? "" : `<p class="resting">${COPY.resting}</p>`}
    `;
    stage.appendChild(text);
    chapter.appendChild(stage);
    this.stationsContainer.appendChild(chapter);
    this.stations.push({
      slug: station.slug,
      title: station.title,
      thresholds: station.thresholds,
      chapter,
      stage,
    });
    this.buildLadder(station);
  }

  private buildLadder(station: Station): void {
    const view = this.stations[this.stations.length - 1];
    const group = document.createElement("div");
    group.className = "ladder";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Intensity ladder");
    group.dataset.activeLayers = "";
    const heading = document.createElement("p");
    heading.className = "ladder-heading";
    heading.textContent = "LADDER";
    group.appendChild(heading);
    const names: Record<Layer, string> = { bed: "Bed", pulse: "Pulse", lead: "Lead", stinger: "Stinger" };
    for (const layer of ["stinger", "lead", "pulse", "bed"] as Layer[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rung";
      button.dataset.layer = layer;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", `${names[layer]} layer`);
      const label = document.createElement("span");
      label.className = "name";
      label.textContent = `${names[layer]} ${station.thresholds[layer]}`;
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.className = "rung-fill";
      bar.appendChild(fill);
      button.appendChild(label);
      button.appendChild(bar);
      button.addEventListener("click", () => {
        const threshold = station.thresholds[layer];
        if (this.reducedMotion) {
          const slider = group.querySelector("input[type=range]") as HTMLInputElement | null;
          if (slider) slider.value = String(threshold);
          this.engine.setIntensity(view, threshold);
          return;
        }
        window.scrollTo({ top: view.chapter.offsetTop + threshold * 16 });
      });
      group.appendChild(button);
    }
    view.ladder = group;
    view.buttons = [...group.querySelectorAll<HTMLButtonElement>(".rung")];
    document.getElementById("ladder-slot")?.appendChild(group);
    if (this.reducedMotion) {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.step = "1";
      slider.value = "0";
      slider.setAttribute("role", "slider");
      slider.setAttribute("aria-label", `Intensity for ${station.title}`);
      const row = document.createElement("div");
      row.className = "slider-row";
      row.appendChild(slider);
      group.insertBefore(row, group.firstChild);
      slider.addEventListener("input", () => {
        this.engine.setIntensity(view, Number.parseInt(slider.value, 10));
      });
    }
  }

  private onRungChange(update: RungUpdate): void {
    for (const view of this.stations) {
      const isCurrent = update.station !== null && view.slug === update.station.slug;
      view.chapter.dataset.intensity = isCurrent ? String(update.intensity) : "0";
      view.chapter.dataset.camera = isCurrent ? (this.reducedMotion ? "close" : "moving") : "wide";
      view.ladder?.setAttribute("data-active-layers", isCurrent ? update.activeLayers.join(",") : "");
      for (const button of view.buttons || []) {
        const layer = button.dataset.layer as Layer;
        const active = isCurrent && update.activeLayers.includes(layer);
        button.setAttribute("aria-pressed", String(active));
        const fill = button.querySelector<HTMLElement>(".rung-fill");
        if (fill) fill.style.width = active ? "100%" : "0%";
      }
    }
    if (update.station) {
      if (!this.reducedMotion) {
        window.setTimeout(() => {
          update.station!.chapter.dataset.camera = "close";
        }, 900);
      }
      this.readout.setAttribute("aria-valuenow", String(update.intensity));
      this.readoutValue.textContent = String(update.intensity).padStart(3, "0");
      const data = this.stationData.find((entry) => entry.slug === update.station!.slug);
      if (data && data.playable) {
        void this.audio
          .loadStation(data.slug, data.stems.map((stem) => ({ layer: stem.layer as Layer, url: stem.url })))
          .then(() => {
            this.audio.playStation(data.slug);
            for (const layer of update.activeLayers) this.audio.setLayerActive(layer, true);
          });
      }
    } else {
      this.readout.setAttribute("aria-valuenow", "0");
      this.readoutValue.textContent = "000";
    }
    this.layerChanges.textContent = rungSentences(update);
    if (this.corridor && this.corridor.available) {
      this.corridor.setFrame({
        dolly: update.station ? 1 : 0,
        activeLayers: update.activeLayers.length,
        stationIndex: 0,
      });
    }
  }

  private onScroll(): void {
    if (!this.engine) return;
    if (this.reducedMotion) {
      const focused = document.activeElement as HTMLElement | null;
      const inside =
        focused && this.stations.some((station) => station.stage.contains(focused)) ? focused : null;
      this.engine.updateReducedMotion(window.scrollY, window.innerHeight, inside);
    } else {
      this.engine.updateFromScroll(window.scrollY, window.innerHeight);
    }
  }

  // ---------------------------------------------------------- link checks

  private scheduleChecks(): void {
    // While the link answers 200, re-check every 5 seconds (DP-48).
    window.setInterval(async () => {
      if (!this.checking) return;
      try {
        await apiFetch(`/api/listen/${this.token}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 410) {
          this.endLink(COPY.expired);
        } else if (error instanceof ApiError && error.status === 404) {
          this.endLink(COPY.revoked);
        }
      }
    }, 5000);
    // At the expiry instant, and once a second after that.
    const checkNow = async (): Promise<void> => {
      if (!this.checking) return;
      if (this.expiresAt && Date.now() >= this.expiresAt.getTime()) {
        try {
          await apiFetch(`/api/listen/${this.token}`);
        } catch (error) {
          if (error instanceof ApiError && error.status === 410) {
            this.endLink(COPY.expired);
          } else if (error instanceof ApiError && error.status === 404) {
            this.endLink(COPY.revoked);
          }
          return;
        }
      }
    };
    window.setInterval(() => void checkNow(), 1000);
    // A stem request that answers 410 or 404 triggers an immediate check by
    // patching fetch for this page's stem URLs.
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await originalFetch(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes(`/api/listen/${this.token}/stems/`) && (response.status === 410 || response.status === 404)) {
        void checkNow();
      }
      return response;
    };
  }

  private async endLink(message: string): Promise<void> {
    if (!this.checking) return;
    this.checking = false;
    await this.audio.fadeToSilence(0.4);
    this.stationsContainer.innerHTML = "";
    this.layerChanges.textContent = "";
    this.readout.setAttribute("aria-valuenow", "0");
    this.readoutValue.textContent = "000";
    this.linkStatus.textContent = message;
    this.audio.stopStation();
  }

  // ----------------------------------------------------------- brief form

  private wireBriefForm(): void {
    const form = document.getElementById("brief-form") as HTMLFormElement;
    const button = document.getElementById("brief-send") as HTMLButtonElement;
    const status = document.getElementById("brief-status") as HTMLElement;
    const fileInput = document.getElementById("brief-reference") as HTMLInputElement;
    const name = document.getElementById("brief-name") as HTMLInputElement;
    const email = document.getElementById("brief-email") as HTMLInputElement;
    const studio = document.getElementById("brief-studio") as HTMLInputElement;
    const briefText = document.getElementById("brief-text") as HTMLTextAreaElement;
    const month = document.getElementById("brief-month") as HTMLSelectElement;

    let idempotencyKey: string | null = null;
    let fingerprintAtSend = "";
    let attempts = 0;
    let submitting = false;

    const signature = (): string =>
      JSON.stringify([name.value, email.value, studio.value, briefText.value, month.value, fileInput.files?.[0]?.name ?? "", fileInput.files?.[0]?.size ?? 0]);

    const fieldError = (id: string, message: string | null): void => {
      const wrap = document.getElementById(id) as HTMLElement;
      const paragraph = wrap.querySelector(".error") as HTMLElement;
      if (message) {
        paragraph.textContent = message;
        paragraph.hidden = false;
      } else {
        paragraph.textContent = "";
        paragraph.hidden = true;
      }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;
      const file = fileInput.files?.[0];
      if (file && file.size > 10000000) {
        fieldError("f-reference", COPY.fileTooLarge);
        status.textContent = COPY.fileTooLarge;
        fileInput.focus();
        return;
      }
      submitting = true;
      button.disabled = true;
      button.textContent = COPY.sendingButton;
      status.textContent = COPY.sending;
      const data = new FormData();
      data.set("name", name.value);
      data.set("email", email.value);
      data.set("studio", studio.value);
      data.set("brief", briefText.value);
      if (month.value) data.set("preferred_month", month.value);
      data.set("listen_token", this.token);
      if (file) data.set("attachment", file);
      const signatureNow = signature();
      if (idempotencyKey === null || signatureNow !== fingerprintAtSend) {
        idempotencyKey = `brief-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        fingerprintAtSend = signatureNow;
        attempts = 0;
      }
      const attempt = async (): Promise<void> => {
        let response: Response;
        try {
          response = await fetch("/api/enquiries", {
            method: "POST",
            body: data,
            headers: { "Idempotency-Key": idempotencyKey! },
          });
        } catch {
          status.textContent = COPY.connectionLost;
          attempts += 1;
          if (attempts > 5) {
            status.textContent = COPY.couldNotConfirm;
            submitting = false;
            button.disabled = false;
            button.textContent = "Send brief";
            return;
          }
          window.setTimeout(() => void attempt(), 3000);
          return;
        }
        if (response.status === 201) {
          const body = (await response.json()) as { reference: string };
          status.textContent = COPY.received(body.reference);
          form.reset();
          idempotencyKey = null;
          submitting = false;
          button.disabled = false;
          button.textContent = "Send brief";
          return;
        }
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          errors?: Record<string, string>;
          retry_after_seconds?: number;
        } | null;
        if (payload?.error === "request_in_progress") {
          status.textContent = COPY.connectionLost;
          attempts += 1;
          if (attempts > 5) {
            status.textContent = COPY.couldNotConfirm;
            submitting = false;
            button.disabled = false;
            button.textContent = "Send brief";
            return;
          }
          window.setTimeout(() => void attempt(), 3000);
          return;
        }
        attempts = 0;
        if (response.status === 422 && payload?.errors) {
          const order: [string, string][] = [
            ["f-name", "name"],
            ["f-email", "email"],
            ["f-studio", "studio"],
            ["f-brief", "brief"],
            ["f-month", "preferred_month"],
            ["f-reference", "attachment"],
          ];
          let firstInvalid: HTMLElement | null = null;
          for (const [wrapId, field] of order) {
            const message = payload.errors[field];
            if (message) {
              fieldError(wrapId, message);
              if (!firstInvalid) firstInvalid = document.getElementById(wrapId)?.querySelector("input, textarea, select") ?? null;
            }
          }
          status.textContent = COPY.checkFields;
          if (firstInvalid) firstInvalid.focus();
        } else if (response.status === 429 && payload) {
          const seconds = payload.retry_after_seconds ?? 1;
          status.textContent = COPY.paced(seconds < 120 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`);
        } else if (response.status === 413) {
          fieldError("f-reference", COPY.fileTooLarge);
          status.textContent = COPY.fileTooLarge;
          fileInput.focus();
        } else if (response.status === 415) {
          fieldError("f-reference", COPY.fileUnsupported);
          status.textContent = COPY.fileUnsupported;
          fileInput.focus();
        } else if (response.status === 503) {
          status.textContent = COPY.storageDown;
        } else {
          status.textContent = COPY.generic;
        }
        submitting = false;
        button.disabled = false;
        button.textContent = "Send brief";
      };
      await attempt();
    });
  }

  private async loadMonths(): Promise<void> {
    const select = document.getElementById("brief-month") as HTMLSelectElement;
    if (!select) return;
    try {
      const data = await apiFetch<{ months: { month: string; label: string }[] }>("/api/months");
      const options: HTMLOptionElement[] = [];
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "No preference";
      options.push(none);
      for (const month of data.months) {
        const option = document.createElement("option");
        option.value = month.month;
        option.textContent = month.label;
        options.push(option);
      }
      select.replaceChildren(...options);
    } catch {
      // The next 2-second read retries.
    }
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const page = new ListenPage();
void page.init();
