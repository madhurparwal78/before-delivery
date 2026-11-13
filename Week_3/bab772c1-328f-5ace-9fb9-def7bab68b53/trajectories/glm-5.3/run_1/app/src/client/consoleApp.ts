// The browser console shared by the author console and the share page. Every
// display value comes from the shared format module; no second rounding or
// parsing path exists here.

import {
  dayOfYearToEpochMs,
  epochMsToDayOfYear,
  formatAltitude,
  formatLatitude,
  formatLongitude,
  formatMetLabel,
  formatSpeed,
  isDayOfYear,
  landmarkRangeM,
  snapSampleIndex,
  type DistanceUnit,
  type SpeedUnit,
} from "../shared/format.js";
import { api, el, hide, maybe, reducedMotion, text, writeParam, readParam } from "./browser.js";
import { drawDisc, drawLens, pickSample, projectPoint, sampleAtOrBefore } from "./disc.js";
import type {
  ApiEvent,
  ApiFrame,
  ApiLandmark,
  ApiLine,
  ApiMission,
  ApiSample,
  ApiSearchResult,
  ApiShareMission,
  ApiSpeaker,
} from "./shapes.js";
import { authorWiring } from "./author.js";

export interface ConsoleState {
  share: boolean;
  missionId: string | null;
  token: string | null;
  apiRoot: string;
  mission: ApiMission | null;
  samples: ApiSample[];
  lines: ApiLine[];
  events: ApiEvent[];
  landmarks: ApiLandmark[];
  subscribers: Array<{ id: string; url: string; created_at: string }>;
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  lensIndex: number;
  lensOpen: boolean;
  playing: boolean;
}

export async function consoleMain(share: boolean): Promise<void> {
  const missionId = share ? null : window.location.pathname.split("/")[2] ?? null;
  const token = share ? window.location.pathname.split("/")[2] ?? "" : null;
  const apiRoot = share ? `/api/share/${token}` : `/api/missions/${missionId}`;

  const state: ConsoleState = {
    share,
    missionId,
    token,
    apiRoot,
    mission: null,
    samples: [],
    lines: [],
    events: [],
    landmarks: [],
    subscribers: [],
    distanceUnit: "km",
    speedUnit: "m_s",
    lensIndex: 0,
    lensOpen: false,
    playing: false,
  };

  const heading = el("mission-name-heading");
  const epochLine = el("epoch-line");
  const periluneSummary = maybe<HTMLElement>("perilune-summary");
  const expiryLine = maybe<HTMLElement>("expiry-line");
  const banners = el("banners");
  const metReadout = el("met-readout");
  const bandMet = maybe<HTMLElement>("band-met");
  const stickyBand = maybe<HTMLElement>("sticky-band");
  const channelsButton = maybe<HTMLButtonElement>("channels-button");
  const drawerBackdrop = maybe<HTMLElement>("drawer-backdrop");
  const channelsRail = el<HTMLElement>("channels-rail");
  const discPane = el("disc-pane");
  const canvas = el<HTMLCanvasElement>("track-canvas");
  const lens = maybe<HTMLElement>("lens");
  const lensCanvas = maybe<HTMLCanvasElement>("lens-canvas");
  const readoutPlate = el("readout-plate");
  const plateMet = el("plate-met");
  const plateGmt = el("plate-gmt");
  const plateLat = el("plate-lat");
  const plateLon = el("plate-lon");
  const plateAlt = el("plate-alt");
  const plateDr = el("plate-dr");
  const plateRanges = el("plate-ranges");
  const emptyMission = el("empty-mission");
  const goToGmt = el<HTMLInputElement>("go-to-gmt");
  const goToGmtError = el("go-to-gmt-error");
  const goButton = el<HTMLButtonElement>("go-button");
  const playButton = el<HTMLButtonElement>("play-button");
  const pinEventButton = maybe<HTMLButtonElement>("pin-event-button");
  const searchBox = el<HTMLInputElement>("search-transcript");
  const searchResults = el<HTMLUListElement>("search-results");
  const searchStatus = el("search-status");
  const speakersList = el<HTMLUListElement>("speakers-list");
  const transcriptLinesList = el<HTMLUListElement>("transcript-lines");
  const eventsHeadRow = el("events-head-row");
  const eventsBody = el<HTMLTableSectionElement>("events-body");
  const downloadStatus = el("download-status");
  const landmarksList = el<HTMLUListElement>("landmarks-list");
  const dossierLink = el<HTMLAnchorElement>("dossier-link");
  const eventListLink = maybe<HTMLAnchorElement>("event-list-link");
  const capturesList = maybe<HTMLUListElement>("captures-list");
  const eventPinsCheckbox = el<HTMLInputElement>("event-pins");
  const transcriptTicksCheckbox = el<HTMLInputElement>("transcript-ticks");
  const consoleStatus = maybe<HTMLElement>("console-status");

  const plateSpeed = el("plate-spd");

  function announceConsole(message: string): void {
    if (consoleStatus) consoleStatus.textContent = message;
  }

  function announceDownload(message: string): void {
    downloadStatus.textContent = message;
  }

  // ---- Loaders ----

  async function loadAll(): Promise<void> {
    const [missionRes, trackRes, linesRes, eventsRes] = await Promise.all([
      api<ApiMission | ApiShareMission>(share ? `/api/share/${token}` : `/api/missions/${missionId}`),
      api<{ samples: ApiSample[] }>(`${apiRoot}/track`),
      api<{ lines: ApiLine[] }>(`${apiRoot}/transcript`),
      api<{ events: ApiEvent[] }>(`${apiRoot}/events`),
    ]);
    if (!missionRes.ok) return;
    if (share) {
      const shareBody = missionRes.body as ApiShareMission;
      state.mission = {
        ...(shareBody.mission as ApiMission),
        passes: shareBody.passes,
        landmarks: shareBody.landmarks,
        expires_utc: shareBody.expires_utc,
      };
    } else {
      state.mission = missionRes.body as ApiMission;
    }
    state.samples = trackRes.ok && trackRes.body ? trackRes.body.samples : [];
    state.lines = linesRes.ok && linesRes.body ? linesRes.body.lines : [];
    state.events = eventsRes.ok && eventsRes.body ? eventsRes.body.events : [];
    state.landmarks = state.mission?.landmarks ?? [];
  }

  async function reloadTrack(): Promise<void> {
    pausePlayback();
    const previousMet = state.samples[state.lensIndex]?.met ?? null;
    const [trackRes, linesRes, eventsRes, missionRes] = await Promise.all([
      api<{ samples: ApiSample[] }>(`${apiRoot}/track`),
      api<{ lines: ApiLine[] }>(`${apiRoot}/transcript`),
      api<{ events: ApiEvent[] }>(`${apiRoot}/events`),
      api<ApiMission | ApiShareMission>(share ? `/api/share/${token}` : `/api/missions/${missionId}`),
    ]);
    state.samples = trackRes.ok && trackRes.body ? trackRes.body.samples : [];
    state.lines = linesRes.ok && linesRes.body ? linesRes.body.lines : [];
    state.events = eventsRes.ok && eventsRes.body ? eventsRes.body.events : [];
    if (missionRes.ok) {
      if (share) {
        const shareBody = missionRes.body as ApiShareMission;
        state.mission = {
        ...(shareBody.mission as ApiMission),
        passes: shareBody.passes,
        landmarks: shareBody.landmarks,
        expires_utc: shareBody.expires_utc,
      };
      } else {
        state.mission = missionRes.body as ApiMission;
      }
      state.landmarks = state.mission?.landmarks ?? [];
    }
    // The track-reload rule: the lens moves to the last sample at or before its
    // previous MET, or to the first sample.
    if (previousMet !== null && state.samples.length > 0) {
      state.lensIndex = snapSampleIndex(
        state.samples.map((s) => s.met),
        previousMet,
      );
    } else {
      state.lensIndex = 0;
    }
    renderAll();
  }

  // ---- Rendering ----

  function renderAll(): void {
    renderHeader();
    renderEmpty();
    renderUnits();
    renderReadout();
    renderEventsTable();
    renderTranscript();
    renderLandmarks();
    renderCaptures();
    updateDownloadLinks();
    drawDisc(canvas, {
      samples: state.samples,
      lon0: periluneLon0(),
      events: state.events,
      lines: state.lines,
      landmarks: state.landmarks,
      showPins: eventPinsCheckbox.checked,
      showTicks: transcriptTicksCheckbox.checked,
    });
    renderSliderAttributes();
  }

  function periluneLon0(): number {
    return state.mission?.perilune?.lon_deg ?? 0;
  }

  function renderHeader(): void {
    if (!state.mission) return;
    document.title = state.mission.name;
    text(heading, state.mission.name);
    text(epochLine, `Epoch ${epochMsToDayOfYear(Date.parse(state.mission.epoch_utc))}`);
    if (state.mission.perilune) {
      text(
        periluneSummary as HTMLElement,
        `Perilune ${formatAltitude(state.mission.perilune.altitude_m, state.distanceUnit)} at ${state.mission.perilune.met_label}`,
      );
      if (periluneSummary) periluneSummary.hidden = false;
    } else if (periluneSummary) {
      periluneSummary.hidden = true;
    }
    if (share) {
      const shareBody = state.mission as ApiMission & { expires_utc?: string };
      const expires = shareBody.expires_utc;
      if (expires && expiryLine) {
        text(expiryLine, `Expires ${epochMsToDayOfYear(Date.parse(expires))}`);
        expiryLine.hidden = false;
      }
    }
  }

  function renderEmpty(): void {
    const empty = state.samples.length === 0;
    emptyMission.hidden = !empty;
    canvas.hidden = empty;
    readoutPlate.hidden = empty;
    const controls = document.querySelector(".disc-controls") as HTMLElement | null;
    if (controls) controls.hidden = empty;
    updateBandVisibility();
  }

  function updateBandVisibility(): void {
    if (!stickyBand) return;
    const belowWide = window.innerWidth < 1280;
    stickyBand.hidden = !belowWide || state.samples.length === 0;
  }

  function renderUnits(): void {
    for (const radio of channelsRail.querySelectorAll<HTMLInputElement>('input[name="distance"]')) {
      radio.checked = radio.value === state.distanceUnit;
    }
    for (const radio of channelsRail.querySelectorAll<HTMLInputElement>('input[name="speed"]')) {
      radio.checked = radio.value === state.speedUnit;
    }
  }

  function renderSliderAttributes(): void {
    canvas.setAttribute("aria-valuemin", "0");
    canvas.setAttribute("aria-valuemax", String(Math.max(0, state.samples.length - 1)));
    canvas.setAttribute("aria-valuenow", String(state.lensIndex));
    const sample = state.samples[state.lensIndex];
    if (sample) {
      canvas.setAttribute(
        "aria-valuetext",
        `${sample.met_label}, altitude ${formatAltitude(sample.altitude_m, state.distanceUnit)}`,
      );
    }
  }

  function renderReadout(): void {
    const sample = state.samples[state.lensIndex];
    if (!sample) return;
    text(plateMet, `MET ${sample.met_label}`);
    text(plateGmt, `GMT ${epochMsToDayOfYear(Date.parse(sample.utc))}`);
    text(plateLat, `LAT ${formatLatitude(sample.lat_deg)}`);
    text(plateLon, `LON ${formatLongitude(sample.lon_deg)}`);
    text(plateAlt, `ALT ${formatAltitude(sample.altitude_m, state.distanceUnit)}`);
    text(plateSpeed, `SPD ${formatSpeed(sample.speed_m_s, state.speedUnit)}`);
    if (state.mission?.reference) {
      text(
        plateDr,
        `ΔR ${sample.residual_m === null ? "—" : formatAltitude(sample.residual_m, state.distanceUnit)}`,
      );
      plateDr.hidden = false;
    } else {
      plateDr.hidden = true;
    }
    plateRanges.textContent = "";
    for (const landmark of state.landmarks) {
      const range = landmarkRangeM(sample.lat_deg, sample.lon_deg, landmark.lat_deg, landmark.lon_deg);
      const p = document.createElement("p");
      p.className = "plate-line";
      text(p, `Range to ${landmark.name} ${formatAltitude(range, state.distanceUnit)}`);
      plateRanges.append(p);
    }
    text(metReadout, sample.met_label);
    if (bandMet) text(bandMet, sample.met_label);
    renderSliderAttributes();
    renderCurrentLine();
  }

  function renderEventsTable(): void {
    eventsHeadRow.textContent = "";
    const heads = ["MET", "Title", "Altitude", "Speed"];
    if (!share) heads.push("Note");
    for (const head of heads) {
      const th = document.createElement("th");
      th.setAttribute("scope", "col");
      text(th, head);
      eventsHeadRow.append(th);
    }
    eventsBody.textContent = "";
    for (const event of state.events) {
      const tr = document.createElement("tr");
      const cells = [
        event.met_label,
        event.title,
        event.sample ? formatAltitude(event.sample.altitude_m, state.distanceUnit) : "",
        event.sample ? formatSpeed(event.sample.speed_m_s, state.speedUnit) : "",
      ];
      if (!share) cells.push(event.note ?? "");
      for (const value of cells) {
        const td = document.createElement("td");
        text(td, value);
        tr.append(td);
      }
      eventsBody.append(tr);
    }
  }

  function renderTranscript(): void {
    transcriptLinesList.textContent = "";
    for (const line of state.lines) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${line.met_label} ${line.speaker}: ${line.text}`;
      button.addEventListener("click", () => {
        pausePlayback();
        moveLensToMet(line.met);
        writeParam("t", String(state.samples[state.lensIndex]?.met ?? ""));
      });
      li.append(button);
      transcriptLinesList.append(li);
    }
    renderSpeakers();
    renderCurrentLine();
  }

  function renderSpeakers(): void {
    const counts = new Map<string, number>();
    for (const line of state.lines) {
      counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1);
    }
    const speakers: ApiSpeaker[] = [];
    for (const [name, count] of counts) speakers.push({ name, lines: count });
    speakers.sort((a, b) => {
      if (b.lines !== a.lines) return b.lines - a.lines;
      const aPoints = Array.from(a.name);
      const bPoints = Array.from(b.name);
      const len = Math.min(aPoints.length, bPoints.length);
      for (let i = 0; i < len; i++) {
        const ca = aPoints[i].codePointAt(0) ?? 0;
        const cb = bPoints[i].codePointAt(0) ?? 0;
        if (ca !== cb) return ca - cb;
      }
      return aPoints.length - bPoints.length;
    });
    speakersList.textContent = "";
    if (speakers.length === 0) {
      const li = document.createElement("li");
      text(li, "No speakers");
      speakersList.append(li);
    }
    for (const speaker of speakers) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      text(name, speaker.name);
      const count = document.createElement("span");
      count.className = "count";
      text(count, String(speaker.lines));
      li.append(name, count);
      speakersList.append(li);
    }
  }

  function renderCurrentLine(): void {
    const met = state.samples[state.lensIndex]?.met ?? -Infinity;
    const buttons = transcriptLinesList.querySelectorAll("button");
    let currentIndex = -1;
    state.lines.forEach((line, i) => {
      if (line.met <= met) currentIndex = i;
    });
    buttons.forEach((button, i) => {
      if (i === currentIndex) {
        button.setAttribute("aria-current", "true");
        button.scrollIntoView({
          block: "nearest",
          behavior: reducedMotion.matches ? "auto" : "smooth",
        });
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  function renderLandmarks(): void {
    landmarksList.textContent = "";
    if (state.landmarks.length === 0 && !share) {
      const li = document.createElement("li");
      text(li, "No landmarks");
      landmarksList.append(li);
    }
    for (const landmark of state.landmarks) {
      const li = document.createElement("li");
      const info = document.createElement("span");
      text(
        info,
        `${landmark.name} ${formatLatitude(landmark.lat_deg)}, ${formatLongitude(landmark.lon_deg)}`,
      );
      li.append(info);
      if (!share) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${landmark.name}`);
        remove.addEventListener("click", () => {
          void (async () => {
            const result = await api(`/api/missions/${missionId}/landmarks/${landmark.id}`, { method: "DELETE" });
            if (result.ok) {
              state.landmarks = state.landmarks.filter((l) => l.id !== landmark.id);
              renderLandmarks();
              renderReadout();
              redraw();
              announceConsole(`Landmark ${landmark.name} removed.`);
              el<HTMLInputElement>("landmark-name").focus();
            }
          })();
        });
        li.append(remove);
      }
      landmarksList.append(li);
    }
  }

  function renderCaptures(): void {
    if (!capturesList) return;
    capturesList.textContent = "";
    const passes = (state.mission?.passes ?? []).filter((p) => p.state === "parsed");
    for (const pass of passes) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.className = "download-link";
      link.textContent = "Download";
      link.setAttribute("aria-label", `Download ${pass.filename}`);
      link.href = `/api/share/${token}/captures/${pass.id}`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void downloadFile(link.href, pass.filename);
      });
      const name = document.createElement("span");
      text(name, pass.filename);
      li.append(name, link);
      capturesList.append(li);
    }
  }

  function updateDownloadLinks(): void {
    if (share && token) {
      if (eventListLink) {
        eventListLink.href = `/api/share/${token}/events.csv?distance=${state.distanceUnit}&speed=${state.speedUnit}`;
      }
      dossierLink.href = `/api/share/${token}/dossier.pdf?distance=${state.distanceUnit}&speed=${state.speedUnit}`;
    } else if (missionId) {
      dossierLink.href = `/api/missions/${missionId}/dossier.pdf`;
    }
  }

  async function downloadFile(href: string, filename: string): Promise<void> {
    try {
      const response = await fetch(href);
      if (response.status === 410) {
        announceDownload(`${filename} is no longer available.`);
        return;
      }
      if (response.status === 429) {
        const retry = Number(response.headers.get("Retry-After") ?? "1");
        announceDownload(`Too many requests for this replay link. Try again in ${retry} seconds.`);
        return;
      }
      if (response.status === 503) {
        announceDownload(`${filename} was not downloaded. Capture storage is offline.`);
        return;
      }
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      announceDownload(`${filename} was not downloaded. Capture storage is offline.`);
    }
  }

  function redraw(): void {
    drawDisc(canvas, {
      samples: state.samples,
      lon0: periluneLon0(),
      events: state.events,
      lines: state.lines,
      landmarks: state.landmarks,
      showPins: eventPinsCheckbox.checked,
      showTicks: transcriptTicksCheckbox.checked,
    });
  }

  // ---- The lens ----

  function lensCentre(): { x: number; y: number } | null {
    const sample = state.samples[state.lensIndex];
    if (!sample) return null;
    const p = projectPoint(sample.lat_deg, sample.lon_deg, periluneLon0(), canvas.clientWidth);
    return { x: p.x, y: p.y };
  }

  function openLens(): void {
    if (!lens) return;
    if (state.lensOpen) return;
    state.lensOpen = true;
    lens.hidden = false;
    if (!reducedMotion.matches) lens.dataset.motion = "on";
    else delete lens.dataset.motion;
    positionLens(false);
    drawLensNow();
  }

  function closeLens(): void {
    if (!lens) return;
    if (!state.lensOpen) return;
    state.lensOpen = false;
    lens.hidden = true;
    delete lens.dataset.motion;
  }

  function positionLens(animate: boolean): void {
    if (!lens) return;
    const centre = lensCentre();
    if (!centre) return;
    const pane = discPane.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const x = canvasRect.left - pane.left + centre.x;
    const y = canvasRect.top - pane.top + centre.y;
    lens.style.transition = animate && !reducedMotion.matches ? "transform 0.2s ease-out" : "none";
    lens.style.transform = `translate(${x - 80}px, ${y - 80}px)`;
    const wide = window.innerWidth >= 1280;
    if (wide) {
      const plateWidth = readoutPlate.offsetWidth;
      const fitsRight = x + 80 + 16 + plateWidth < pane.width;
      readoutPlate.style.position = "absolute";
      readoutPlate.style.margin = "0";
      readoutPlate.style.top = `${Math.max(0, y - 40)}px`;
      if (fitsRight) {
        readoutPlate.style.left = `${x + 80 + 16}px`;
        readoutPlate.style.right = "auto";
      } else {
        readoutPlate.style.left = "auto";
        readoutPlate.style.right = `${Math.max(0, pane.width - (x - 80) + 16)}px`;
      }
    } else {
      readoutPlate.style.position = "";
      readoutPlate.style.top = "";
      readoutPlate.style.left = "";
      readoutPlate.style.right = "";
      readoutPlate.style.margin = "";
    }
  }

  function drawLensNow(): void {
    if (!lensCanvas || !lens) return;
    const centre = lensCentre();
    if (!centre) return;
    drawLens(lensCanvas, canvas, centre);
  }

  // ---- Pointer and touch ----

  canvas.addEventListener("pointerenter", (event) => {
    if (state.playing) return;
    const rect = canvas.getBoundingClientRect();
    const index = pickSample(state.samples, event.clientX - rect.left, event.clientY - rect.top, periluneLon0(), canvas.clientWidth);
    if (index !== null) {
      state.lensIndex = index;
      openLens();
      renderReadout();
      positionLens(false);
      drawLensNow();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (state.playing) return;
    const rect = canvas.getBoundingClientRect();
    const index = pickSample(state.samples, event.clientX - rect.left, event.clientY - rect.top, periluneLon0(), canvas.clientWidth);
    if (index !== null) {
      state.lensIndex = index;
      if (!state.lensOpen) openLens();
      renderReadout();
      positionLens(true);
      drawLensNow();
    }
  });

  canvas.addEventListener("pointerleave", () => closeLens());

  canvas.addEventListener("pointerup", () => {
    if (!state.playing) writeParam("t", String(state.samples[state.lensIndex]?.met ?? ""));
  });

  let touchActive = false;
  canvas.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      const index = pickSample(state.samples, touch.clientX - rect.left, touch.clientY - rect.top, periluneLon0(), canvas.clientWidth);
      if (index !== null) {
        touchActive = true;
        event.preventDefault();
        pausePlayback();
        state.lensIndex = index;
        openLens();
        renderReadout();
        positionLens(false);
        drawLensNow();
      }
    },
    { passive: false },
  );

  canvas.addEventListener(
    "touchmove",
    (event) => {
      if (!touchActive) return;
      event.preventDefault();
      const touch = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      const index = pickSample(state.samples, touch.clientX - rect.left, touch.clientY - rect.top, periluneLon0(), canvas.clientWidth);
      if (index !== null) {
        state.lensIndex = index;
        renderReadout();
        positionLens(true);
        drawLensNow();
      }
    },
    { passive: false },
  );

  canvas.addEventListener("touchend", () => {
    if (touchActive) {
      touchActive = false;
      writeParam("t", String(state.samples[state.lensIndex]?.met ?? ""));
    }
  });

  // ---- Keyboard ----

  function clampIndex(index: number): number {
    if (state.samples.length === 0) return 0;
    return Math.max(0, Math.min(state.samples.length - 1, index));
  }

  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 60 : 1;
    let handled = true;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        pausePlayback();
        state.lensIndex = clampIndex(state.lensIndex + step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        pausePlayback();
        state.lensIndex = clampIndex(state.lensIndex - step);
        break;
      case "Home":
        pausePlayback();
        state.lensIndex = 0;
        break;
      case "End":
        pausePlayback();
        state.lensIndex = clampIndex(state.samples.length - 1);
        break;
      case "Enter":
        if (!share) openPinDialog();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      renderReadout();
      if (state.lensOpen) {
        positionLens(true);
        drawLensNow();
      }
    }
  });

  canvas.addEventListener("keyup", () => {
    if (!state.playing) writeParam("t", String(state.samples[state.lensIndex]?.met ?? ""));
  });

  canvas.addEventListener("focus", () => {
    pausePlayback();
    openLens();
    positionLens(false);
    drawLensNow();
  });

  canvas.addEventListener("blur", () => closeLens());

  function moveLensToMet(met: number): void {
    if (state.samples.length === 0) return;
    state.lensIndex = snapSampleIndex(
      state.samples.map((s) => s.met),
      met,
    );
    renderReadout();
    if (state.lensOpen) {
      positionLens(true);
      drawLensNow();
    }
  }

  // ---- Go to GMT ----

  function goToGmtAction(): void {
    const value = goToGmt.value;
    if (!isDayOfYear(value)) {
      goToGmtError.textContent = "Use GMT day-of-year: YYYY-DDD/HH:MM:SS.";
      goToGmtError.hidden = false;
      goToGmt.setAttribute("aria-invalid", "true");
      goToGmt.setAttribute("aria-errormessage", "go-to-gmt-error");
      return;
    }
    goToGmtError.textContent = "";
    goToGmtError.hidden = true;
    goToGmt.removeAttribute("aria-invalid");
    goToGmt.removeAttribute("aria-errormessage");
    pausePlayback();
    const ms = dayOfYearToEpochMs(value);
    if (ms === null) return;
    const epochMs = state.mission ? Date.parse(state.mission.epoch_utc) : 0;
    const met = Math.round((ms - epochMs) / 1000);
    moveLensToMet(met);
    writeParam("t", String(state.samples[state.lensIndex]?.met ?? ""));
  }

  goButton.addEventListener("click", goToGmtAction);
  goToGmt.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToGmtAction();
    }
  });

  // ---- Playback ----

  let playStartMs = 0;
  let playStartMetMs = 0;
  let playRate = 1;
  let framesCache: ApiFrame[] = [];
  const rateRadios = document.querySelectorAll<HTMLInputElement>('input[name="rate"]');

  function pausePlayback(): void {
    if (!state.playing) return;
    state.playing = false;
    playButton.textContent = "Play";
    playButton.setAttribute("aria-label", "Play");
    for (const radio of rateRadios) radio.disabled = false;
    const index = snapSampleIndex(
      state.samples.map((s) => s.met),
      Math.floor(currentPlaybackMetMs() / 1000),
    );
    state.lensIndex = index;
    renderReadout();
    if (state.lensOpen) {
      positionLens(true);
      drawLensNow();
    }
    writeParam("t", String(state.samples[state.lensIndex]?.met ?? ""));
  }

  function currentPlaybackMetMs(): number {
    const elapsed = performance.now() - playStartMs;
    return playStartMetMs + elapsed * playRate;
  }

  async function startPlayback(): Promise<void> {
    if (state.samples.length === 0) return;
    const startSample = state.samples[state.lensIndex] ?? state.samples[0];
    let startMet = startSample.met;
    if (state.lensIndex >= state.samples.length - 1) startMet = state.samples[0].met;
    playStartMetMs = startMet * 1000;
    playStartMs = performance.now();
    playRate = Number(document.querySelector<HTMLInputElement>('input[name="rate"]:checked')?.value ?? "1");
    state.playing = true;
    playButton.textContent = "Pause";
    playButton.setAttribute("aria-label", "Pause");
    for (const radio of rateRadios) radio.disabled = true;
    const lastMet = state.samples[state.samples.length - 1].met;
    const fps = playRate === 1 ? 10 : 25;
    const result = await api<{ fps: number; frames: ApiFrame[] }>(
      `${apiRoot}/frames?from=${startMet}&to=${lastMet}&fps=${fps}`,
    );
    framesCache = result.ok && result.body ? result.body.frames : [];
    requestAnimationFrame(playTick);
  }

  function playTick(): void {
    if (!state.playing) return;
    const playbackMetMs = currentPlaybackMetMs();
    const lastMetMs = state.samples[state.samples.length - 1].met * 1000;
    if (playbackMetMs >= lastMetMs) {
      state.lensIndex = state.samples.length - 1;
      state.playing = false;
      playButton.textContent = "Play";
      playButton.setAttribute("aria-label", "Play");
      for (const radio of rateRadios) radio.disabled = false;
      renderReadout();
      writeParam("t", String(state.samples[state.lensIndex].met));
      return;
    }
    const snappedIndex = snapSampleIndex(
      state.samples.map((s) => s.met),
      Math.floor(playbackMetMs / 1000),
    );
    state.lensIndex = snappedIndex;
    const snapped = state.samples[snappedIndex];
    let frameIndex = 0;
    for (let i = 0; i < framesCache.length; i++) {
      if (framesCache[i].met_ms <= playbackMetMs) frameIndex = i;
      else break;
    }
    const frame = framesCache[frameIndex];
    if (frame && !reducedMotion.matches) {
      const metWhole = Math.floor(frame.met_ms / 1000);
      text(plateMet, `MET ${formatMetLabel(metWhole)}`);
      const utcMs = (state.mission ? Date.parse(state.mission.epoch_utc) : 0) + frame.met_ms;
      text(plateGmt, `GMT ${epochMsToDayOfYear(utcMs)}`);
      text(plateLat, `LAT ${formatLatitude(frame.lat_deg)}`);
      text(plateLon, `LON ${formatLongitude(frame.lon_deg)}`);
      text(plateAlt, `ALT ${formatAltitude(frame.altitude_m, state.distanceUnit)}`);
      text(plateSpeed, `SPD ${formatSpeed(frame.speed_m_s, state.speedUnit)}`);
      text(metReadout, formatMetLabel(metWhole));
      if (bandMet) text(bandMet, formatMetLabel(metWhole));
      canvas.setAttribute("aria-valuenow", String(snappedIndex));
      canvas.setAttribute(
        "aria-valuetext",
        `${formatMetLabel(metWhole)}, altitude ${formatAltitude(frame.altitude_m, state.distanceUnit)}`,
      );
    } else {
      renderReadout();
    }
    if (snapped) {
      if (state.mission?.reference) {
        text(
          plateDr,
          `ΔR ${snapped.residual_m === null ? "—" : formatAltitude(snapped.residual_m, state.distanceUnit)}`,
        );
      }
      plateRanges.textContent = "";
      for (const landmark of state.landmarks) {
        const range = landmarkRangeM(snapped.lat_deg, snapped.lon_deg, landmark.lat_deg, landmark.lon_deg);
        const p = document.createElement("p");
        p.className = "plate-line";
        text(p, `Range to ${landmark.name} ${formatAltitude(range, state.distanceUnit)}`);
        plateRanges.append(p);
      }
    }
    renderCurrentLine();
    if (state.lensOpen && frame) {
      const p = projectPoint(frame.lat_deg, frame.lon_deg, periluneLon0(), canvas.clientWidth);
      const pane = discPane.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const x = canvasRect.left - pane.left + p.x;
      const y = canvasRect.top - pane.top + p.y;
      if (lens) {
        lens.style.transition = "none";
        lens.style.transform = `translate(${x - 80}px, ${y - 80}px)`;
      }
      if (lensCanvas) drawLens(lensCanvas, canvas, p);
    }
    requestAnimationFrame(playTick);
  }

  playButton.addEventListener("click", () => {
    if (state.playing) pausePlayback();
    else void startPlayback();
  });

  // ---- Channels drawer ----

  function drawerOpen(): boolean {
    return channelsRail.dataset.open === "true";
  }

  function syncDrawerState(): void {
    const wide = window.innerWidth >= 1280;
    if (wide) {
      // A permanent left column: never inert, no drawer behaviour.
      channelsRail.dataset.open = "true";
      channelsRail.removeAttribute("aria-modal");
      channelsRail.setAttribute("aria-label", "Channels");
      channelsRail.setAttribute("role", "complementary");
      if (drawerBackdrop) hide(drawerBackdrop, true);
      channelsButton?.setAttribute("aria-expanded", "false");
      return;
    }
    const open = channelsButton?.getAttribute("aria-expanded") === "true";
    channelsRail.dataset.open = open ? "true" : "false";
    channelsRail.setAttribute("role", open ? "dialog" : "presentation");
    if (open) channelsRail.setAttribute("aria-modal", "true");
    else channelsRail.removeAttribute("aria-modal");
    // A closed drawer is inert: not visible, focusable or in the tree.
    for (const input of channelsRail.querySelectorAll<HTMLElement>("input")) {
      input.inert = !open;
      input.tabIndex = open ? 0 : -1;
    }
    const close = channelsRail.querySelector<HTMLElement>("#close-channels");
    if (close) close.inert = !open;
    if (drawerBackdrop) hide(drawerBackdrop, !open);
  }

  function openDrawer(): void {
    channelsButton?.setAttribute("aria-expanded", "true");
    syncDrawerState();
    const checked = channelsRail.querySelector<HTMLInputElement>('input[name="distance"]:checked');
    (checked ?? channelsRail.querySelector<HTMLInputElement>('input[name="distance"]'))?.focus();
  }

  function closeDrawer(): void {
    channelsButton?.setAttribute("aria-expanded", "false");
    syncDrawerState();
    channelsButton?.focus();
  }

  channelsButton?.addEventListener("click", () => {
    if (channelsButton.getAttribute("aria-expanded") === "true") closeDrawer();
    else openDrawer();
  });

  drawerBackdrop?.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawerOpen()) {
      closeDrawer();
    }
  });

  // Tab and Shift+Tab wrap inside the drawer while it is open.
  channelsRail.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !drawerOpen()) return;
    const focusables = Array.from(
      channelsRail.querySelectorAll<HTMLElement>("button, input"),
    ).filter((node) => !node.inert && !node.hasAttribute("disabled"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if (!channelsRail.querySelector("#close-channels")) {
    const close = document.createElement("button");
    close.type = "button";
    close.id = "close-channels";
    close.textContent = "Close channels";
    close.addEventListener("click", closeDrawer);
    channelsRail.append(close);
  }
  syncDrawerState();
  window.addEventListener("resize", () => {
    syncDrawerState();
  });

  // ---- Units ----

  for (const radio of channelsRail.querySelectorAll<HTMLInputElement>('input[name="distance"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      state.distanceUnit = radio.value as DistanceUnit;
      renderReadout();
      renderEventsTable();
      renderHeader();
      updateDownloadLinks();
      if (share) writeParam("distance", state.distanceUnit);
      else void saveUnits();
    });
  }
  for (const radio of channelsRail.querySelectorAll<HTMLInputElement>('input[name="speed"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      state.speedUnit = radio.value as SpeedUnit;
      renderReadout();
      renderEventsTable();
      renderHeader();
      updateDownloadLinks();
      if (share) writeParam("speed", state.speedUnit);
      else void saveUnits();
    });
  }
  eventPinsCheckbox.addEventListener("change", redraw);
  transcriptTicksCheckbox.addEventListener("change", redraw);

  async function saveUnits(): Promise<void> {
    const result = await api(`/api/missions/${missionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/merge-patch+json" },
      body: JSON.stringify({ distance_unit: state.distanceUnit, speed_unit: state.speedUnit }),
    });
    if (result.ok) {
      announceConsole(
        `Units saved: ${state.distanceUnit === "km" ? "km" : "nmi"} and ${state.speedUnit === "m_s" ? "m/s" : "ft/s"}.`,
      );
    } else {
      announceConsole("Units could not be saved. The share page still opens in the previous units.");
    }
  }

  // ---- Search ----

  let searchTimer: number | null = null;
  let searchSequence = 0;

  function runSearch(refresh: boolean): void {
    const query = searchBox.value.trim();
    if (query === "") {
      searchResults.textContent = "";
      searchStatus.textContent = "";
      return;
    }
    const sequence = ++searchSequence;
    if (!refresh) searchStatus.textContent = "Searching...";
    void (async () => {
      const result = await api<ApiSearchResult>(`${apiRoot}/search?q=${encodeURIComponent(query)}`);
      if (sequence !== searchSequence) return;
      if (searchBox.value.trim() !== query) return;
      if (!result.ok) {
        searchStatus.textContent = "Search is offline.";
        return;
      }
      const hits = result.body?.hits ?? [];
      const focusedInResults = searchResults.contains(document.activeElement);
      searchResults.textContent = "";
      const countWord = hits.length === 1 ? "1 result" : `${hits.length} results`;
      searchStatus.textContent =
        hits.length === 0 ? `No results for "${query}"` : `${countWord} for "${query}"`;
      if (hits.length === 0) {
        const li = document.createElement("li");
        text(li, "No results");
        searchResults.append(li);
      }
      for (const hit of hits) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent =
          hit.kind === "line" ? `${hit.met_label} ${hit.speaker}: ${hit.text}` : `${hit.met_label} ${hit.text}`;
        button.addEventListener("click", () => {
          pausePlayback();
          moveLensToMet(hit.met);
          writeParam("t", String(state.samples[state.lensIndex]?.met ?? ""));
        });
        li.append(button);
        searchResults.append(li);
      }
      if (focusedInResults && !searchResults.contains(document.activeElement)) {
        searchResults.focus();
      }
    })();
  }

  searchBox.addEventListener("input", () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      const query = searchBox.value.trim();
      if (query === "") {
        writeParam("q", null);
        searchResults.textContent = "";
        searchStatus.textContent = "";
        return;
      }
      writeParam("q", query);
      runSearch(false);
    }, 250);
  });

  // ---- Banners and status ----

  async function loadBanners(): Promise<void> {
    const result = await api<{ storage: string; search: string; queue: string; webhooks: string }>("/api/status");
    if (!result.ok || !result.body) return;
    banners.textContent = "";
    const showsQueue = !share;
    const alerts: string[] = [];
    if (result.body.storage === "down") {
      alerts.push(
        "Capture storage is offline. Uploads, deletions and capture downloads are paused; the replay still plays.",
      );
    }
    if (result.body.search === "down") {
      alerts.push("Transcript search is offline. The track, loupe and transcript still work.");
    }
    if (showsQueue && result.body.queue === "down") {
      alerts.push("The parsing queue is offline. Uploads are stored and will be parsed when it returns.");
    }
    if (showsQueue && result.body.webhooks === "down") {
      alerts.push("Webhooks are offline. Changes are kept and sent to subscribers when it returns.");
    }
    for (const message of alerts) {
      const alert = document.createElement("div");
      alert.setAttribute("role", "alert");
      alert.textContent = message;
      banners.append(alert);
    }
  }

  // ---- Address parameters on open ----

  function applyAddress(): void {
    const t = readParam("t");
    if (t !== null && /^-?\d+$/.test(t)) {
      state.lensIndex = snapSampleIndex(
        state.samples.map((s) => s.met),
        Number(t),
      );
    }
    const q = readParam("q");
    if (q !== null) {
      const trimmed = q.trim();
      if (trimmed.length >= 1 && trimmed.length <= 200) {
        searchBox.value = trimmed;
        runSearch(false);
      }
    }
    if (share) {
      const distance = readParam("distance");
      if (distance === "km" || distance === "nmi") state.distanceUnit = distance;
      const speed = readParam("speed");
      if (speed === "m_s" || speed === "ft_s") state.speedUnit = speed;
    } else if (state.mission) {
      state.distanceUnit = state.mission.distance_unit;
      state.speedUnit = state.mission.speed_unit;
    }
  }

  // ---- Live share page ----

  function openStream(): void {
    if (!share || !token) return;
    stream = new EventSource(`/api/share/${token}/stream`);
    stream.addEventListener("mission-changed", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { version: number };
      if (data.version !== lastVersion) {
        lastVersion = data.version;
        void reloadTrack().then(() => {
          if (searchBox.value.trim() !== "") runSearch(true);
        });
      }
    });
    stream.onerror = () => {
      // EventSource reconnects by itself with Last-Event-ID.
    };
  }

  let stream: EventSource | null = null;
  let lastVersion = -1;

  // ---- Pin dialog hook (author only) ----

  let pinDialogOpener: ((fromSlider: boolean) => void) | null = null;

  function openPinDialog(): void {
    pinDialogOpener?.(true);
  }

  // ---- Boot ----

  await loadAll();
  lastVersion = state.mission?.change_version ?? 0;
  applyAddress();
  renderAll();
  await loadBanners();
  setInterval(() => {
    void loadBanners();
  }, 10000);
  window.addEventListener("resize", () => {
    redraw();
    renderEmpty();
    if (state.lensOpen) {
      positionLens(false);
      drawLensNow();
    }
  });

  if (share) {
    openStream();
  } else if (missionId) {
    pinDialogOpener = authorWiring({
      state,
      canvas,
      onReload: reloadTrack,
      onSearchRefresh: () => runSearch(true),
    });
  }

}
