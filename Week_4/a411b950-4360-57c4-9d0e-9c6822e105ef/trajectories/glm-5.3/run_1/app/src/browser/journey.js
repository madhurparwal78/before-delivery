import { LadderEngine, rungSentences } from "./ladder.js";
import { apiFetch, NoResponseError, fetchOrNoResponse } from "./api.js";
import { CorridorRenderer } from "./corridor.js";
import { AudioEngine } from "./audio.js";
import { monthLabel } from "../shared/dates.js";
import { LAYERS } from "../shared/domain.js";
/**
 * The journey page (DP-01 to DP-06, DP-18, DP-20, DP-37 to DP-42, DP-65):
 * the sound gate, the station corridor, the intensity ladder, search and the
 * brief form with checked, resumable uploads.
 */
const COPY = {
    layerChanges: "Layer changes",
    layerLoadFailed: "The corridor could not load. Refresh to try again.",
    searchPending: "Searching…",
    searchCount: (count) => `${count} projects found.`,
    searchNone: (query) => `No projects match “${query}”.`,
    sending: "Sending your brief…",
    sendingButton: "Sending…",
    received: (reference) => `Brief ${reference} received. A receipt will follow by email.`,
    checkFields: "Check the highlighted fields.",
    paced: (wait) => `You have sent several briefs in a short time. Try again in ${wait}.`,
    fileTooLarge: "That file is too large. The limit is 10,000,000 bytes.",
    fileUnsupported: "That file type isn’t accepted. Send WAV, OGG, MP3 or PDF.",
    storageDown: "Reference files can’t be stored right now. Send the brief without the file, or try again later.",
    wavFormat: "That WAV isn’t PCM or float audio. Send WAV, OGG, MP3 or PDF.",
    wavChannels: "That WAV must have one or two channels. Send a mono or stereo file.",
    wavRate: "That WAV’s sample rate isn’t accepted. Use 22,050 to 96,000 Hz.",
    wavDecode: "That WAV can’t be decoded. Send another file.",
    connectionLost: "Connection lost. Retrying your brief…",
    couldNotConfirm: "We couldn't confirm your brief was received. Press Send brief to try again. It won't be sent twice.",
    monthFull: (label) => `${label} is now fully booked. Choose another month or No preference.`,
    generic: "Something went wrong. Your brief was not sent.",
    resting: "Audio is resting. Credits and notes are still here.",
};
const FILE_SIZE_LIMIT = 10000000;
class JourneyPage {
    gate;
    soundButton;
    mutedButton;
    soundToggle;
    introHeading;
    stationsContainer;
    ladderSlot;
    layerChanges;
    readout;
    readoutValue;
    corridor;
    audio = new AudioEngine();
    reducedMotion;
    engine;
    stations = [];
    stationData = [];
    currentSlug = null;
    cameraMoving = false;
    cameraTimer = null;
    constructor() {
        this.gate = document.getElementById("gate");
        this.soundButton = document.getElementById("gate-sound");
        this.mutedButton = document.getElementById("gate-muted");
        this.soundToggle = document.getElementById("sound-toggle");
        this.introHeading = document.getElementById("intro-heading");
        this.stationsContainer = document.getElementById("stations");
        this.ladderSlot = document.getElementById("ladder-slot");
        this.layerChanges = document.getElementById("layer-changes");
        this.readout = document.getElementById("readout");
        this.readoutValue = document.getElementById("readout-value");
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const canvas = document.getElementById("corridor");
        this.corridor = new CorridorRenderer(canvas, this.reducedMotion);
        if (!this.corridor.available) {
            const fallback = document.getElementById("corridor-fallback");
            fallback.hidden = false;
            canvas.hidden = true;
        }
    }
    async init() {
        this.openGate();
        this.wireGate();
        this.wireSoundToggle();
        await this.loadJourney();
        await this.loadMonths();
        this.wireSearch();
        this.wireBriefForm();
        window.addEventListener("scroll", this.onScroll.bind(this), { passive: true });
        window.setInterval(() => this.onScroll(), 80);
        window.setInterval(() => void this.loadMonths(), 2000);
        window.addEventListener("focusin", () => this.onScroll());
    }
    // ------------------------------------------------------------------ gate
    openGate() {
        // The gate opens on page load; focus starts on "Enter with sound".
        this.gate.showModal();
        this.soundButton.focus();
        this.trapGateFocus();
        this.gate.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                this.enterMuted();
            }
        });
    }
    trapGateFocus() {
        this.gate.addEventListener("keydown", (event) => {
            if (event.key !== "Tab")
                return;
            const focusables = [this.soundButton, this.mutedButton];
            const focused = document.activeElement;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && focused === first) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && focused === last) {
                event.preventDefault();
                first.focus();
            }
        });
    }
    wireGate() {
        this.soundButton.addEventListener("click", () => {
            void this.enterWithSound();
        });
        this.mutedButton.addEventListener("click", () => {
            this.enterMuted();
        });
    }
    async enterWithSound() {
        await this.audio.start();
        this.audio.setMuted(false);
        this.soundToggle.setAttribute("aria-pressed", "true");
        this.closeGate();
    }
    enterMuted() {
        this.audio.setMuted(true);
        this.soundToggle.setAttribute("aria-pressed", "false");
        this.closeGate();
    }
    closeGate() {
        if (this.reducedMotion) {
            this.gate.close();
            this.introHeading.focus();
            return;
        }
        this.gate.classList.add("gate-fade");
        window.setTimeout(() => {
            this.gate.close();
            this.gate.classList.remove("gate-fade");
            this.introHeading.focus();
        }, 400);
    }
    wireSoundToggle() {
        this.soundToggle.addEventListener("click", async () => {
            const pressed = this.soundToggle.getAttribute("aria-pressed") === "true";
            if (!pressed) {
                await this.audio.start();
            }
            this.audio.setMuted(!pressed);
            this.soundToggle.setAttribute("aria-pressed", String(!pressed));
        });
    }
    // --------------------------------------------------------------- journey
    async loadJourney() {
        try {
            const data = await apiFetch("/api/journey");
            this.stationData = data.stations;
            this.buildStations(data.stations);
        }
        catch {
            this.layerChanges.textContent = COPY.layerLoadFailed;
        }
    }
    buildStations(stations) {
        for (const station of stations) {
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
        }
        this.buildLadder(stations);
        this.engine = new LadderEngine(this.stations, this.reducedMotion, {
            onRungChange: (update) => this.onRungChange(update),
        });
        this.onScroll();
    }
    buildLadder(stations) {
        for (const station of stations) {
            const group = document.createElement("div");
            group.className = "ladder";
            group.setAttribute("role", "group");
            group.setAttribute("aria-label", "Intensity ladder");
            group.dataset.activeLayers = "";
            const heading = document.createElement("p");
            heading.className = "ladder-heading";
            heading.textContent = "LADDER";
            group.appendChild(heading);
            const layerNames = { bed: "Bed", pulse: "Pulse", lead: "Lead", stinger: "Stinger" };
            const thresholds = station.thresholds;
            for (const layer of [...LAYERS].reverse()) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "rung";
                button.dataset.layer = layer;
                button.setAttribute("aria-pressed", "false");
                const label = document.createElement("span");
                label.className = "name";
                label.textContent = `${layerNames[layer]} ${thresholds[layer]}`;
                const bar = document.createElement("span");
                bar.className = "bar";
                const fill = document.createElement("span");
                fill.className = "rung-fill";
                bar.appendChild(fill);
                button.appendChild(label);
                button.appendChild(bar);
                button.setAttribute("aria-label", `${layerNames[layer]} layer`);
                button.addEventListener("click", () => this.onRungPress(station, layer));
                group.appendChild(button);
            }
            const view = this.stations[this.stations.length - 1];
            view.ladder = group;
            view.buttons = [...group.querySelectorAll(".rung")];
            this.ladderSlot.appendChild(group);
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
                    this.onSliderInput(station, Number.parseInt(slider.value, 10));
                });
            }
        }
    }
    onRungPress(station, layer) {
        const threshold = station.thresholds[layer];
        if (this.reducedMotion) {
            const view = this.stations.find((entry) => entry.slug === station.slug);
            if (view) {
                const slider = view.ladder?.querySelector("input[type=range]");
                if (slider)
                    slider.value = String(threshold);
                this.engine.setIntensity(view, threshold);
            }
            return;
        }
        const view = this.stations.find((entry) => entry.slug === station.slug);
        if (!view)
            return;
        const chapterTop = view.chapter.offsetTop;
        window.scrollTo({ top: chapterTop + threshold * 16, behavior: "auto" });
        this.onScroll();
    }
    onSliderInput(station, intensity) {
        const view = this.stations.find((entry) => entry.slug === station.slug);
        if (view)
            this.engine.setIntensity(view, intensity);
    }
    // -------------------------------------------------------------- rung state
    onRungChange(update) {
        const previous = this.currentSlug;
        this.currentSlug = update.station ? update.station.slug : null;
        for (const view of this.stations) {
            const isCurrent = view.slug === this.currentSlug;
            view.chapter.dataset.intensity = isCurrent ? String(update.intensity) : "0";
            view.chapter.dataset.activeLayers = isCurrent ? update.activeLayers.join(",") : "";
            if (!isCurrent)
                view.chapter.dataset.camera = this.reducedMotion ? "wide" : "wide";
            view.ladder?.setAttribute("data-active-layers", isCurrent ? update.activeLayers.join(",") : "");
            for (const button of view.buttons || []) {
                const layer = button.dataset.layer;
                const active = isCurrent && update.activeLayers.includes(layer);
                button.setAttribute("aria-pressed", String(active));
                const fill = button.querySelector(".rung-fill");
                if (fill)
                    fill.style.width = active ? "100%" : "0%";
            }
        }
        if (update.station) {
            this.setCamera(update.station);
            this.readout.setAttribute("aria-valuenow", String(update.intensity));
            this.readoutValue.textContent = String(update.intensity).padStart(3, "0");
            this.writeUrl(update.station.slug, update.intensity);
            this.audio.playStation(update.station.slug);
            const data = this.stationData.find((entry) => entry.slug === update.station.slug);
            if (data && data.playable) {
                void this.audio.loadStation(data.slug, data.stems.map((stem) => ({ layer: stem.layer, url: stem.url })))
                    .then(() => {
                    if (this.currentSlug === data.slug)
                        this.audio.playStation(data.slug);
                    for (const layer of update.activeLayers)
                        this.audio.setLayerActive(layer, true);
                });
            }
            for (const change of update.joined)
                this.audio.setLayerActive(change.layer, true);
            for (const change of update.left)
                this.audio.setLayerActive(change.layer, false);
        }
        else {
            this.readout.setAttribute("aria-valuenow", "0");
            this.readoutValue.textContent = "000";
            this.audio.stopStation();
            this.writeUrl(null, 0);
        }
        this.layerChanges.textContent = rungSentences(update);
        this.updateCorridor(update);
        void previous;
    }
    setCamera(station) {
        if (this.reducedMotion) {
            station.chapter.dataset.camera = "close";
            for (const view of this.stations) {
                if (view !== station)
                    view.chapter.dataset.camera = "wide";
            }
            return;
        }
        station.chapter.dataset.camera = "moving";
        if (this.cameraTimer !== null)
            window.clearTimeout(this.cameraTimer);
        this.cameraTimer = window.setTimeout(() => {
            station.chapter.dataset.camera = "close";
        }, 900);
    }
    writeUrl(slug, intensity) {
        const url = new URL(window.location.href);
        if (slug) {
            url.searchParams.set("station", slug);
            url.searchParams.set("i", String(intensity));
        }
        else {
            url.searchParams.delete("station");
            url.searchParams.delete("i");
        }
        window.history.replaceState(null, "", url.toString().replace(/\?$/, ""));
    }
    updateCorridor(update) {
        if (!this.corridor || !this.corridor.available)
            return;
        const index = update.station ? this.stations.findIndex((s) => s.slug === update.station.slug) : 0;
        const dolly = update.station ? 1 : 0;
        this.corridor.setFrame({ dolly, activeLayers: update.activeLayers.length, stationIndex: Math.max(0, index) });
    }
    onScroll() {
        if (!this.engine)
            return;
        const scrollY = window.scrollY;
        const viewportHeight = window.innerHeight;
        if (this.reducedMotion) {
            const focused = document.activeElement;
            const inside = focused && this.stations.some((station) => station.stage.contains(focused)) ? focused : null;
            this.engine.updateReducedMotion(scrollY, viewportHeight, inside);
        }
        else {
            this.engine.updateFromScroll(scrollY, viewportHeight);
        }
    }
    // ---------------------------------------------------------------- search
    wireSearch() {
        const input = document.getElementById("search-input");
        const results = document.getElementById("search-results");
        const status = document.getElementById("search-status");
        let timer = null;
        input.addEventListener("input", () => {
            if (timer !== null)
                window.clearTimeout(timer);
            const query = input.value.trim();
            timer = window.setTimeout(async () => {
                if (query.length === 0) {
                    results.hidden = true;
                    results.innerHTML = "";
                    status.textContent = "";
                    return;
                }
                status.textContent = COPY.searchPending;
                try {
                    const data = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
                    status.textContent = data.results.length > 0 ? COPY.searchCount(data.results.length) : COPY.searchNone(query);
                    results.innerHTML = "";
                    for (const result of data.results) {
                        const item = document.createElement("li");
                        const link = document.createElement("a");
                        link.href = "#";
                        link.textContent = result.title;
                        link.addEventListener("click", (event) => {
                            event.preventDefault();
                            const view = this.stations.find((station) => station.slug === result.slug);
                            if (!view)
                                return;
                            window.scrollTo({ top: view.chapter.offsetTop, behavior: this.reducedMotion ? "auto" : "auto" });
                            const heading = view.stage.querySelector("h2");
                            if (heading)
                                heading.focus();
                            results.hidden = true;
                        });
                        item.appendChild(link);
                        results.appendChild(item);
                    }
                    results.hidden = data.results.length === 0;
                }
                catch {
                    status.textContent = COPY.layerLoadFailed;
                }
            }, 250);
        });
        document.addEventListener("click", (event) => {
            if (!results.contains(event.target) && event.target !== input) {
                results.hidden = true;
            }
        });
        // 375px: the search box collapses to a button that opens it in place.
        const media = window.matchMedia("(max-width: 640px)");
        const applyCollapsible = () => {
            const box = document.getElementById("searchbox");
            if (media.matches) {
                box.classList.add("collapsed");
                if (!box.querySelector(".search-open")) {
                    const open = document.createElement("button");
                    open.type = "button";
                    open.className = "btn btn-ghost search-open";
                    open.textContent = "Search";
                    open.addEventListener("click", () => {
                        box.classList.remove("collapsed");
                        input.focus();
                    });
                    box.appendChild(open);
                }
            }
        };
        applyCollapsible();
        media.addEventListener("change", applyCollapsible);
        input.addEventListener("focus", () => {
            const box = document.getElementById("searchbox");
            box.classList.remove("collapsed");
        });
    }
    // ----------------------------------------------------------- brief form
    wireBriefForm() {
        const form = document.getElementById("brief-form");
        const button = document.getElementById("brief-send");
        const status = document.getElementById("brief-status");
        const fileInput = document.getElementById("brief-reference");
        const progress = document.getElementById("upload-progress");
        const progressFill = progress.querySelector("span");
        const name = document.getElementById("brief-name");
        const email = document.getElementById("brief-email");
        const studio = document.getElementById("brief-studio");
        const briefText = document.getElementById("brief-text");
        const month = document.getElementById("brief-month");
        let idempotencyKey = null;
        let fingerprintAtSend = "";
        let automaticAttempts = 0;
        let automaticTimer = null;
        let submitting = false;
        const signature = () => JSON.stringify([name.value, email.value, studio.value, briefText.value, month.value, fileInput.files?.[0]?.name ?? "", fileInput.files?.[0]?.size ?? 0]);
        const fieldError = (id, message) => {
            const wrap = document.getElementById(id);
            const paragraph = wrap.querySelector(".error");
            if (message) {
                paragraph.textContent = message;
                paragraph.hidden = false;
                wrap.classList.add("invalid");
            }
            else {
                paragraph.textContent = "";
                paragraph.hidden = true;
                wrap.classList.remove("invalid");
            }
        };
        const resetErrors = () => {
            for (const id of ["f-name", "f-email", "f-studio", "f-brief", "f-month", "f-reference"]) {
                fieldError(id, null);
            }
        };
        const setStatus = (message, kind) => {
            status.textContent = message;
            status.className = `status-line${kind === "success" ? " success" : kind === "error" ? " error" : ""}`;
        };
        const setProgress = (percent) => {
            if (percent === null) {
                progress.hidden = true;
                progress.setAttribute("aria-valuenow", "0");
                progressFill.style.width = "0%";
                return;
            }
            progress.hidden = false;
            progress.setAttribute("aria-valuenow", String(percent));
            progressFill.style.width = `${percent}%`;
            progress.setAttribute("aria-valuenow", String(percent));
            const label = progress;
            void label;
        };
        /** The browser-side reference check (DP-65), in the brief's order. */
        const checkReference = async (file) => {
            if (file.size > FILE_SIZE_LIMIT) {
                return COPY.fileTooLarge;
            }
            const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
            const isWav = head.length >= 12 &&
                String.fromCharCode(head[0], head[1], head[2], head[3]) === "RIFF" &&
                String.fromCharCode(head[8], head[9], head[10], head[11]) === "WAVE";
            if (!isWav)
                return null;
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const info = readWavHeader(bytes);
            if (!info || (info.format !== 1 && info.format !== 3 && !(info.format === 0xfffe && (info.subFormat === 1 || info.subFormat === 3)))) {
                return COPY.wavFormat;
            }
            if (info.channels !== 1 && info.channels !== 2) {
                return COPY.wavChannels;
            }
            if (info.sampleRate < 22050 || info.sampleRate > 96000) {
                return COPY.wavRate;
            }
            try {
                const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                if (!OfflineContext)
                    return null;
                const context = new OfflineContext(info.channels, info.sampleRate, info.sampleRate);
                await context.decodeAudioData(buffer);
            }
            catch {
                return COPY.wavDecode;
            }
            return null;
        };
        const buildBody = () => {
            const data = new FormData();
            data.set("name", name.value);
            data.set("email", email.value);
            data.set("studio", studio.value);
            data.set("brief", briefText.value);
            if (month.value)
                data.set("preferred_month", month.value);
            const slug = new URL(window.location.href).searchParams.get("station");
            if (slug)
                data.set("project_slug", slug);
            if (fileInput.files && fileInput.files[0])
                data.set("attachment", fileInput.files[0]);
            return data;
        };
        const finishSuccess = (reference) => {
            setStatus(COPY.received(reference), "success");
            form.reset();
            idempotencyKey = null;
            submitting = false;
            button.disabled = false;
            button.textContent = "Send brief";
            setProgress(null);
        };
        const retryLater = () => {
            automaticAttempts += 1;
            if (automaticAttempts > 5) {
                setStatus(COPY.couldNotConfirm, "error");
                submitting = false;
                button.disabled = false;
                button.textContent = "Send brief";
                setProgress(null);
                return;
            }
            automaticTimer = window.setTimeout(() => {
                void send();
            }, 3000);
        };
        const send = async () => {
            const data = buildBody();
            const signatureNow = signature();
            if (idempotencyKey === null || signatureNow !== fingerprintAtSend) {
                idempotencyKey = `brief-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                fingerprintAtSend = signatureNow;
                automaticAttempts = 0;
            }
            const headers = { "Idempotency-Key": idempotencyKey };
            let response;
            try {
                response = await fetchOrNoResponse("/api/enquiries", {
                    method: "POST",
                    body: data,
                    headers,
                });
            }
            catch (error) {
                if (error instanceof NoResponseError) {
                    setStatus(COPY.connectionLost, "info");
                    retryLater();
                    return;
                }
                throw error;
            }
            setProgress(null);
            if (response.status === 201) {
                const body = (await response.json());
                finishSuccess(body.reference);
                return;
            }
            const payload = (await response.json().catch(() => null));
            if (payload?.error === "request_in_progress") {
                setStatus(COPY.connectionLost, "info");
                retryLater();
                return;
            }
            automaticAttempts = 0;
            if (response.status === 422 && payload?.errors) {
                resetErrors();
                const order = [
                    ["f-name", "name"],
                    ["f-email", "email"],
                    ["f-studio", "studio"],
                    ["f-brief", "brief"],
                    ["f-month", "preferred_month"],
                    ["f-reference", "attachment"],
                ];
                let firstInvalid = null;
                for (const [wrapId, field] of order) {
                    const message = payload.errors[field];
                    if (message) {
                        fieldError(wrapId, message);
                        if (!firstInvalid)
                            firstInvalid = document.getElementById(wrapId)?.querySelector("input, textarea, select") ?? null;
                    }
                }
                setStatus(COPY.checkFields, "error");
                if (firstInvalid instanceof HTMLElement)
                    firstInvalid.focus();
                submitting = false;
                button.disabled = false;
                button.textContent = "Send brief";
                return;
            }
            if (response.status === 429) {
                const seconds = payload?.retry_after_seconds ?? 1;
                const wait = seconds < 120 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
                setStatus(COPY.paced(wait), "error");
                submitting = false;
                button.disabled = false;
                button.textContent = "Send brief";
                return;
            }
            if (response.status === 413) {
                fieldError("f-reference", COPY.fileTooLarge);
                setStatus(COPY.fileTooLarge, "error");
                fileInput.focus();
                submitting = false;
                button.disabled = false;
                button.textContent = "Send brief";
                return;
            }
            if (response.status === 415) {
                fieldError("f-reference", COPY.fileUnsupported);
                setStatus(COPY.fileUnsupported, "error");
                fileInput.focus();
                submitting = false;
                button.disabled = false;
                button.textContent = "Send brief";
                return;
            }
            if (response.status === 503) {
                setStatus(COPY.storageDown, "error");
                submitting = false;
                button.disabled = false;
                button.textContent = "Send brief";
                return;
            }
            setStatus(COPY.generic, "error");
            submitting = false;
            button.disabled = false;
            button.textContent = "Send brief";
        };
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (submitting)
                return;
            resetErrors();
            const file = fileInput.files?.[0];
            if (file) {
                const problem = await checkReference(file);
                if (problem) {
                    fieldError("f-reference", problem);
                    setStatus(problem, "error");
                    fileInput.focus();
                    return;
                }
            }
            submitting = true;
            button.disabled = true;
            button.textContent = COPY.sendingButton;
            setStatus(COPY.sending, "info");
            if (file && typeof XMLHttpRequest !== "undefined") {
                setProgress(0);
                const data = buildBody();
                const body = new FormData();
                for (const [key, value] of data.entries()) {
                    if (key !== "attachment")
                        body.set(key, value);
                }
                body.set("attachment", file);
                const xhr = new XMLHttpRequest();
                xhr.open("POST", "/api/enquiries");
                xhr.setRequestHeader("Idempotency-Key", idempotencyKey ?? "");
                xhr.upload.addEventListener("progress", (progressEvent) => {
                    if (progressEvent.lengthComputable) {
                        setProgress(Math.floor((progressEvent.loaded / progressEvent.total) * 100));
                    }
                });
                xhr.send(body);
                const response = await new Promise((resolve) => {
                    xhr.addEventListener("load", () => resolve({ status: xhr.status, body: xhr.responseText }));
                    xhr.addEventListener("error", () => resolve({ status: -1, body: null }));
                    xhr.addEventListener("timeout", () => resolve({ status: -1, body: null }));
                });
                setProgress(null);
                if (response.status === 201 && response.body) {
                    finishSuccess(JSON.parse(response.body).reference);
                    return;
                }
                if (response.status === -1) {
                    setStatus(COPY.connectionLost, "info");
                    retryLater();
                    return;
                }
                // Fall through to the shared outcome handling with the parsed payload.
                const payload = response.body ? JSON.parse(response.body) : null;
                if (payload?.error === "request_in_progress") {
                    setStatus(COPY.connectionLost, "info");
                    retryLater();
                    return;
                }
                automaticAttempts = 0;
                if (response.status === 422 && payload?.errors) {
                    resetErrors();
                    let firstInvalid = null;
                    const order = [
                        ["f-name", "name"],
                        ["f-email", "email"],
                        ["f-studio", "studio"],
                        ["f-brief", "brief"],
                        ["f-month", "preferred_month"],
                        ["f-reference", "attachment"],
                    ];
                    for (const [wrapId, field] of order) {
                        const message = payload.errors[field];
                        if (message) {
                            fieldError(wrapId, message);
                            if (!firstInvalid)
                                firstInvalid = document.getElementById(wrapId)?.querySelector("input, textarea, select") ?? null;
                        }
                    }
                    setStatus(COPY.checkFields, "error");
                    if (firstInvalid instanceof HTMLElement)
                        firstInvalid.focus();
                    submitting = false;
                    button.disabled = false;
                    button.textContent = "Send brief";
                    return;
                }
                if (response.status === 429 && payload) {
                    const seconds = payload.retry_after_seconds ?? 1;
                    const wait = seconds < 120 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
                    setStatus(COPY.paced(wait), "error");
                }
                else if (response.status === 413) {
                    fieldError("f-reference", COPY.fileTooLarge);
                    setStatus(COPY.fileTooLarge, "error");
                    fileInput.focus();
                }
                else if (response.status === 415) {
                    fieldError("f-reference", COPY.fileUnsupported);
                    setStatus(COPY.fileUnsupported, "error");
                    fileInput.focus();
                }
                else if (response.status === 503) {
                    setStatus(COPY.storageDown, "error");
                }
                else {
                    setStatus(COPY.generic, "error");
                }
                submitting = false;
                button.disabled = false;
                button.textContent = "Send brief";
                return;
            }
            await send();
        });
    }
    // ---------------------------------------------------------------- months
    async loadMonths() {
        const select = document.getElementById("brief-month");
        if (!select)
            return;
        const focused = document.activeElement === select;
        const previous = select.value;
        try {
            const data = await apiFetch("/api/months");
            const options = [];
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
            if (previous && data.months.some((month) => month.month === previous)) {
                select.value = previous;
            }
            else {
                if (previous) {
                    const status = document.getElementById("brief-status");
                    const label = monthLabel(previous, "");
                    status.textContent = COPY.monthFull(label);
                }
                select.value = "";
            }
            if (focused)
                select.focus();
        }
        catch {
            // Keep the options we have; the next 2-second read retries.
        }
    }
}
/** Reads a WAV header's format, channels and sample rate from raw bytes. */
function readWavHeader(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12)
        return null;
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "RIFF")
        return null;
    if (String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== "WAVE")
        return null;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        const size = view.getUint32(offset + 4, true);
        if (id === "fmt ") {
            if (offset + 8 + 16 > bytes.length)
                return null;
            const format = view.getUint16(offset + 8, true);
            const channels = view.getUint16(offset + 10, true);
            const sampleRate = view.getUint32(offset + 12, true);
            let subFormat = 0;
            if (format === 0xfffe && offset + 8 + 40 <= bytes.length) {
                subFormat = view.getUint16(offset + 34, true);
            }
            return { format, subFormat, channels, sampleRate };
        }
        offset += 8 + size + (size % 2);
    }
    return null;
}
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
const page = new JourneyPage();
void page.init();
