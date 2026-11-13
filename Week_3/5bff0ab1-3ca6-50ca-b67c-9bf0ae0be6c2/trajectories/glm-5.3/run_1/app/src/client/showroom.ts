// The showroom page: the pinned stage, scroll progress, chapters, parts, the URL
// state, the lock dialog and the key-on reading. The machine holds still when
// nothing is happening; scroll and selection are the only inputs that move it.
import * as THREE from "three";
import {
  LiveClient,
  api,
  apiJson,
  formatPaise,
  istHm,
  maybe,
  pollIdentity,
  qs,
  replaceUrl,
  status,
  type LiveReading,
  type LockJson,
  type Me,
} from "./core";
import { openSignIn } from "./auth";
import {
  buildMachine,
  DESH_SPEC,
  GROUP_ORDER,
  MEGH_SPEC,
  needleAngleFor,
  paintDisplay,
  SEAT_POINTS,
  TRAVEL_STARTS,
  type BuiltMachine,
  type GroupKey,
} from "./machine";

// The one easing curve, as the published CSS text.
export const EASING_TEXT = "cubic-bezier(0.22, 1, 0.36, 1)";

export const CHAPTER_RANGES: { id: string; name: string; from: number; to: number; jump: number; statement: string }[] = [
  { id: "frame", name: "Frame", from: 0, to: 0.14, jump: 0.07, statement: "It starts as a frame." },
  { id: "engine", name: "Engine", from: 0.14, to: 0.28, jump: 0.21, statement: "Then the heart goes in." },
  { id: "tank", name: "Tank", from: 0.28, to: 0.42, jump: 0.35, statement: "The tank takes your colour." },
  { id: "wheels", name: "Wheels", from: 0.42, to: 0.56, jump: 0.49, statement: "Nineteen in front, seventeen behind." },
  { id: "exhaust", name: "Exhaust", from: 0.56, to: 0.7, jump: 0.63, statement: "The pipe runs on the right." },
  { id: "seat", name: "Seat", from: 0.7, to: 0.84, jump: 0.77, statement: "A seat for your road." },
  { id: "cluster", name: "Cluster", from: 0.84, to: 1.01, jump: 0.92, statement: "Now it reads the truth." },
];

const PART_SENTENCES: Record<string, string> = {
  "steering-head": "The steering head sets the rake that everything else answers to.",
  "swingarm": "The swingarm holds the rear wheel to the frame with no fuss.",
  "side-stand": "The side stand parks the machine on its left.",
  "cylinder": "The cylinder is the heart the whole machine beats around.",
  "primary-cover": "The primary cover hides the drive that never needs a look.",
  "filler-cap": "The filler cap takes fuel without a spill.",
  "knee-recess": "The knee recess is shaped for long days in the saddle.",
  "front-rim": "The front rim turns nineteen inches of road into feel.",
  "rear-rim": "The rear rim carries the drive and the load.",
  "chain": "The chain runs on the rider's left, in the open.",
  "header": "The header leaves the cylinder and heads right.",
  "silencer": "The silencer ends the run on the right side.",
  "rider-seat": "The rider seat is flat and honest for a full day.",
  "pillion-seat": "The pillion seat takes a second without complaint.",
  "needle": "The needle settles on the hours your lock has left.",
  "tell-tale": "The tell-tale lights only when the truth is delayed.",
  "display": "The display reads units left and the next free ride.",
};

const FINISH_PAINTS: Record<string, { r: number; g: number; b: number }> = {
  "monsoon-slate": { r: 47, g: 63, b: 92 },
  "kesar": { r: 232, g: 163, b: 23 },
  "raat-black": { r: 13, g: 13, b: 15 },
};
const MUTED_RGB = { r: 156, g: 158, b: 163 };
const ACCENT_RGB = { r: 255, g: 74, b: 31 };

const KEY_ON_AT = 0.86;
const NEEDLE_SWEEP_MS = 420;
const NEEDLE_SETTLE_MS = 560;
const LAMP_MS = 180;
const PAINT_MS = 320;
const PART_LIFT_MS = 480;
const CAMERA_TO_PART_MS = 640;
const LABEL_MASK_MS = 320;
const DISSOLVE_MS = 120;

interface StepRecord {
  name: string;
  ms: number;
  easing: string;
  startedAt: number;
  endedAt: number | null;
}

interface DrawnReading {
  seq: number;
  unitsLeft: number | null;
  onRoadPaise: number | null;
  lockExpiresAt: string | null;
  nextSlot: string | null;
  finish: string;
  display: string;
}

class Showroom {
  canvas!: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer | null = null;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
  machine: BuiltMachine | null = null;
  mode: "webgl" | "fallback" | "reduced" = "webgl";
  paused = false;
  reduced = false;

  // progress, clamped outside the stage range
  targetProgress = 0;
  progress = 0;
  chapterIdx = 0;
  part: string | null = null;

  // selection
  hub = "pune";
  model = "megh-349";
  finish = "monsoon-slate";
  me: Me = { user: null, signedIn: false };

  // the reading
  live: LiveReading | null = null;
  drawn: DrawnReading = {
    seq: 0,
    unitsLeft: null,
    onRoadPaise: null,
    lockExpiresAt: null,
    nextSlot: null,
    finish: "monsoon-slate",
    display: "",
  };
  keyedOn = false;
  needleDeg = -135;
  lampLit = false;
  primer = false;

  steps: StepRecord[] = [];
  seatOffsets: Record<GroupKey, number> = { frame: 1, engine: 1, tank: 1, wheels: 1, exhaust: 1, seat: 1, cluster: 1 };

  liveClient!: LiveClient;
  rendered = false;
  raf = 0;
  needleAnim: { from: number; to: number; started: number; ms: number; name: string } | null = null;
  liftAnim: { partId: string; from: number; to: number; started: number; ms: number } | null = null;
  cameraAnim: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; started: number; ms: number } | null = null;
  paintAnim: { from: THREE.Color; to: THREE.Color; started: number; ms: number } | null = null;
  lampAnim: { from: THREE.Color; to: THREE.Color; started: number; ms: number } | null = null;
  tankPaintColor = new THREE.Color("#2f3f5c");
  selectedPart: string | null = null;
  labelMask = 0;
  partLabelEl: HTMLDivElement | null = null;

  // stage geometry
  stageTop = 0;
  stageHeight = 1;

  init(): void {
    this.canvas = qs<HTMLCanvasElement>("#stage-canvas");
    this.partLabelEl = document.createElement("div");
    this.partLabelEl.className = "part-label";
    document.querySelector(".stage")?.appendChild(this.partLabelEl);
    this.readUrlState();
    this.setupScene();
    this.bindControls();
    this.bindScroll();
    this.bindStream();
    void this.bindIdentity();
    this.renderLoop();
  }

  // ---------- scene ----------

  private setupScene(): void {
    this.scene.background = new THREE.Color(24 / 255, 25 / 255, 27 / 255);
    this.scene.add(new THREE.AmbientLight(0xffffff, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.1);
    fill.position.set(-2, 2, -3);
    this.scene.add(fill);

    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = reducedQuery.matches;
    if (this.reduced) {
      maybe<HTMLElement>("#stage-space")?.style.setProperty("height", "0vh");
      maybe<HTMLElement>(".stage")?.classList.add("reduced-stage");
    }
    reducedQuery.addEventListener("change", (e) => this.setReduced(e.matches));

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, preserveDrawingBuffer: true, antialias: true });
    } catch {
      renderer = null;
    }
    if (renderer === null) {
      this.enterFallback();
      return;
    }
    this.renderer = renderer;
    this.rebuildMachine();
    this.applyCameraForProgress();
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.pauseScene();
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.restoreScene();
    });
  }

  private enterFallback(): void {
    this.mode = "fallback";
    document.body.classList.add("elevation-visible");
    // the elevations move inside the stage so the controls stay reachable
    const root = qs<HTMLElement>("#elevation-root");
    const stage = maybe<HTMLElement>(".stage");
    if (stage && root.parentElement !== stage) {
      stage.appendChild(root);
    }
    this.applyElevationReading();
    this.updateFallbackChapter();
    status.announce("This device can't draw the 3D showroom. Everything here is live.");
  }

  private rebuildMachine(): void {
    if (this.machine) {
      this.scene.remove(this.machine.root);
      this.machine.dispose();
    }
    const spec = this.model === "megh-349" ? MEGH_SPEC : DESH_SPEC;
    const paint = this.paintHexFor(this.finish);
    this.machine = buildMachine(spec, paint);
    this.tankPaintColor = new THREE.Color(paint);
    this.scene.add(this.machine.root);
    this.canvas.setAttribute("aria-label", `Malhar ${this.model === "megh-349" ? "Megh 349" : "Desh 648"} showroom`);
    this.paintTank(this.primer ? this.mutedHex() : paint, false);
    this.applyCameraForProgress();
  }

  private mutedHex(): string {
    return `#${[MUTED_RGB.r, MUTED_RGB.g, MUTED_RGB.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }

  private paintHexFor(finish: string): string {
    const p = FINISH_PAINTS[finish] ?? FINISH_PAINTS["monsoon-slate"];
    return `#${[p.r, p.g, p.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }

  // ---------- URL state ----------

  private readUrlState(): void {
    const url = new URL(location.href);
    const at = url.searchParams.get("at");
    const parsedAt = at !== null && /^\d+(\.\d+)?$/.test(at) ? Number(at) : NaN;
    const hasAt = Number.isFinite(parsedAt) && parsedAt >= 0 && parsedAt <= 1;
    const ch = url.searchParams.get("ch");
    const chapterInfo = CHAPTER_RANGES.find((c) => c.id === ch);
    let progress = 0;
    if (hasAt) progress = parsedAt;
    else if (chapterInfo) progress = chapterInfo.jump;
    else if (location.pathname === "/showroom") progress = 0;
    this.progress = progress;
    this.targetProgress = progress;

    // model, hub, finish fall back to defaults and correct the URL
    const model = url.searchParams.get("model");
    this.model = model === "desh-648" || model === "megh-349" ? model : "megh-349";
    const hub = url.searchParams.get("hub");
    this.hub = ["pune", "bengaluru", "gurugram", "kochi"].includes(hub ?? "") ? (hub as string) : "pune";
    const finish = url.searchParams.get("finish");
    this.finish = FINISH_PAINTS[finish ?? ""] ? (finish as string) : "monsoon-slate";

    this.chapterIdx = this.chapterForProgress(this.progress);
    const part = url.searchParams.get("part");
    const chapter = CHAPTER_RANGES[this.chapterIdx];
    this.part = part !== null && chapter && this.partBelongsTo(part, chapter.id) ? part : null;
    if (this.part) this.selectedPart = this.part;
    this.syncControls();
    this.writeUrl(true);
  }

  private partBelongsTo(part: string, chapterId: string): boolean {
    return PART_SENTENCES[part] !== undefined && partChapter(part) === chapterId;
  }

  private writeUrl(immediate = false): void {
    const chapter = CHAPTER_RANGES[this.chapterIdx];
    const params = new URLSearchParams();
    params.set("model", this.model);
    params.set("hub", this.hub);
    params.set("finish", this.finish);
    if (chapter) params.set("ch", chapter.id);
    if (this.part) params.set("part", this.part);
    params.set("at", this.progress.toFixed(3));
    const path = `${location.pathname.split("?")[0]}?${params.toString()}`;
    if (immediate) {
      try {
        history.replaceState(null, "", path);
      } catch {
        /* ignore */
      }
    } else {
      replaceUrl(path);
    }
  }

  // ---------- controls ----------

  private syncControls(): void {
    document.querySelectorAll<HTMLInputElement>('input[name="model"]').forEach((el) => {
      el.checked = el.value === this.model;
    });
    const hubSelect = maybe<HTMLSelectElement>("#hub-select");
    if (hubSelect) hubSelect.value = this.hub;
    document.querySelectorAll<HTMLInputElement>('input[name="finish"]').forEach((el) => {
      el.checked = el.value === this.finish;
    });
    this.updatePartsList();
    this.updateChapterToolbar();
    this.updateStatement();
  }

  private bindControls(): void {
    document.querySelectorAll<HTMLInputElement>('input[name="model"]').forEach((el) => {
      el.addEventListener("change", () => {
        if (el.checked) {
          this.model = el.value;
          this.onSelectionChange();
        }
      });
    });
    const hubSelect = maybe<HTMLSelectElement>("#hub-select");
    hubSelect?.addEventListener("change", () => {
      this.hub = hubSelect.value;
      this.onSelectionChange();
    });
    document.querySelectorAll<HTMLInputElement>('input[name="finish"]').forEach((el) => {
      el.addEventListener("change", () => {
        if (el.checked) {
          this.finish = el.value;
          this.onSelectionChange();
        }
      });
    });

    // chapters: one tab stop, roving tabindex, arrows wrap, Home and End
    const toolbar = qs<HTMLElement>("#chapters-toolbar");
    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
    const setRoving = () => {
      buttons.forEach((b, i) => {
        b.tabIndex = i === this.chapterIdx ? 0 : -1;
        b.setAttribute("aria-pressed", i === this.chapterIdx ? "true" : "false");
      });
    };
    setRoving();
    buttons.forEach((btn, i) => {
      btn.addEventListener("click", () => this.jumpToChapter(i));
      btn.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
          ev.preventDefault();
          const next = ev.key === "ArrowRight" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
          this.chapterIdx = next;
          setRoving();
          buttons[next].focus();
        } else if (ev.key === "Home") {
          ev.preventDefault();
          this.chapterIdx = 0;
          setRoving();
          buttons[0].focus();
        } else if (ev.key === "End") {
          ev.preventDefault();
          this.chapterIdx = buttons.length - 1;
          setRoving();
          buttons[buttons.length - 1].focus();
        } else if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          this.jumpToChapter(this.chapterIdx);
        }
      });
    });

    // Menu button on phones
    const menuBtn = maybe<HTMLButtonElement>("#menu-btn");
    menuBtn?.addEventListener("click", () => {
      const links = qs(".toplinks");
      const open = links.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
    });

    // the lock button
    const lockBtn = maybe<HTMLButtonElement>("#lock-price");
    lockBtn?.addEventListener("click", () => {
      if (lockBtn.getAttribute("aria-disabled") === "true") return;
      void this.openLockDialog();
    });

    // parts sheet on phones
    const partsBtn = maybe<HTMLButtonElement>("#parts-btn");
    const sheet = maybe<HTMLDialogElement>("#parts-sheet");
    if (partsBtn && sheet) {
      partsBtn.hidden = window.innerWidth > 767;
      partsBtn.addEventListener("click", () => {
        sheet.showModal();
        partsBtn.setAttribute("aria-expanded", "true");
        const list = qs<HTMLElement>("#parts-sheet-list");
        list.focus();
      });
      sheet.addEventListener("close", () => {
        partsBtn.setAttribute("aria-expanded", "false");
        partsBtn.focus();
      });
    }

    // parts list keyboard: arrows move, Enter selects
    for (const listId of ["#parts-list", "#parts-sheet-list"]) {
      const list = maybe<HTMLElement>(listId);
      if (!list) continue;
      list.addEventListener("keydown", (ev) => {
        const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
        const idx = options.findIndex((o) => o.getAttribute("aria-selected") === "true");
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
          ev.preventDefault();
          const next = ev.key === "ArrowDown" ? Math.min(idx + 1, options.length - 1) : Math.max(idx - 1, 0);
          options.forEach((o, i) => o.setAttribute("aria-selected", i === next ? "true" : "false"));
          this.part = options[next]?.dataset.part ?? null;
          options[next]?.focus();
          this.onPartSelected(this.part);
        } else if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          this.confirmPartSelection();
        }
      });
      list.addEventListener("click", (ev) => {
        const opt = (ev.target as HTMLElement).closest<HTMLElement>('[role="option"]');
        if (!opt) return;
        optionsOf(list).forEach((o) => o.setAttribute("aria-selected", "false"));
        opt.setAttribute("aria-selected", "true");
        this.part = opt.dataset.part ?? null;
        this.confirmPartSelection();
      });
    }
  }

  private confirmPartSelection(): void {
    if (this.part && this.part === this.selectedPart) {
      // selecting the same part again deselects it
      this.clearPartSelection();
      return;
    }
    this.onPartSelected(this.part);
  }

  private clearPartSelection(): void {
    this.selectedPart = null;
    this.part = null;
    this.labelMask = 0;
    this.updatePartsList();
    this.writeUrl();
  }

  private onPartSelected(partId: string | null): void {
    if (!partId || !this.machine) return;
    this.selectedPart = partId;
    this.part = partId;
    this.startStep("part-lift", PART_LIFT_MS);
    this.moveCameraToPart(partId);
    this.logStep("label-mask", LABEL_MASK_MS, () => {
      this.labelMask = 1;
    });
    this.updatePartsList();
    this.writeUrl();
  }

  private moveCameraToPart(partId: string): void {
    const info = this.machine?.parts[partId];
    if (!info) return;
    const target = info.placement.position.clone();
    const camPos = target.clone().add(new THREE.Vector3(0.45, 0.25, 0.85));
    this.cameraAnim = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controlsTarget(),
      toPos: camPos,
      toTarget: target,
      started: performance.now(),
      ms: CAMERA_TO_PART_MS,
    };
    this.startStep("camera-to-part", CAMERA_TO_PART_MS);
  }

  private controlsTarget(): THREE.Vector3 {
    return this.lastCameraTarget.clone();
  }

  lastCameraTarget = new THREE.Vector3(0, 0.45, 0);

  // ---------- parts list ----------

  private updatePartsList(): void {
    const chapter = CHAPTER_RANGES[this.chapterIdx];
    if (!chapter) return;
    const partsFor = chapterParts(chapter.id);
    for (const listId of ["#parts-list", "#parts-sheet-list"]) {
      const list = maybe<HTMLElement>(listId);
      if (!list) continue;
      // keep the same DOM nodes: update in place
      const existing = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
      while (existing.length < partsFor.length) {
        const div = document.createElement("div");
        div.setAttribute("role", "option");
        div.tabIndex = -1;
        list.appendChild(div);
        existing.push(div);
      }
      while (existing.length > partsFor.length) {
        const el = existing.pop();
        el?.remove();
      }
      partsFor.forEach((p, i) => {
        const el = existing[i];
        el.dataset.part = p.id;
        el.textContent = p.name;
        el.setAttribute("aria-selected", this.part === p.id ? "true" : "false");
      });
    }
  }

  private updateChapterToolbar(): void {
    const toolbar = qs<HTMLElement>("#chapters-toolbar");
    toolbar.querySelectorAll<HTMLButtonElement>("button").forEach((b, i) => {
      b.setAttribute("aria-pressed", i === this.chapterIdx ? "true" : "false");
      b.tabIndex = i === this.chapterIdx ? 0 : -1;
    });
  }

  private updateStatement(): void {
    const chapter = CHAPTER_RANGES[this.chapterIdx];
    const el = maybe<HTMLElement>("#chapter-statement");
    if (chapter && el) el.textContent = chapter.statement;
    this.updateFallbackChapter();
  }

  // ---------- chapters ----------

  private chapterForProgress(p: number): number {
    for (let i = CHAPTER_RANGES.length - 1; i >= 0; i--) {
      if (p >= CHAPTER_RANGES[i].from) return i;
    }
    return 0;
  }

  private jumpToChapter(i: number): void {
    const chapter = CHAPTER_RANGES[i];
    if (!chapter) return;
    this.chapterIdx = i;
    this.targetProgress = chapter.jump;
    this.progress = chapter.jump;
    if (this.reduced) {
      // reduced mode changes pose with the dissolve, and only that step is logged
      this.startStep("dissolve", DISSOLVE_MS);
    }
    if (this.part && partChapter(this.part) !== chapter.id) {
      this.part = null;
      this.selectedPart = null;
    }
    this.scrollToProgress(chapter.jump);
    this.updateChapterToolbar();
    this.updateStatement();
    this.updatePartsList();
    this.writeUrl();
  }

  private scrollToProgress(p: number): void {
    if (this.reduced) {
      // reduced motion: the stage is one viewport tall and progress does not scroll
      this.renderPose();
      return;
    }
    const top = this.stageTop + p * this.stageHeight;
    window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
  }

  // ---------- scroll ----------

  private bindScroll(): void {
    const wrap = maybe<HTMLElement>("#stage-wrap");
    const compute = () => {
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        this.stageTop = window.scrollY + rect.top;
        this.stageHeight = rect.height - window.innerHeight;
      }
    };
    compute();
    // a URL with progress opens at that pose: place the document at the matching scroll
    const wanted = this.progressFromScroll();
    if (wanted !== null && Math.abs(wanted - this.targetProgress) < 0.005) {
      // already there
    } else if (this.targetProgress > 0) {
      const top = this.stageTop + this.targetProgress * this.stageHeight;
      window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
    }
    window.addEventListener("resize", () => {
      compute();
      this.resize();
    });
    window.addEventListener("scroll", () => {
      compute();
      if (this.reduced || this.paused) return;
      const raw = (window.scrollY - this.stageTop) / Math.max(1, this.stageHeight);
      this.targetProgress = clamp01(raw);
      // Live events never move the rider's place: progress changes only from scroll.
    });
  }

  private progressFromScroll(): number | null {
    const raw = (window.scrollY - this.stageTop) / Math.max(1, this.stageHeight);
    return clamp01(raw);
  }

  private resize(): void {
    if (this.renderer) {
      const w = this.canvas.clientWidth || window.innerWidth;
      const h = this.canvas.clientHeight || window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.updatePartsBtn();
    }
  }

  private updatePartsBtn(): void {
    const partsBtn = maybe<HTMLButtonElement>("#parts-btn");
    if (partsBtn) partsBtn.hidden = window.innerWidth > 767;
  }

  // ---------- the live stream ----------

  private selectionQuery(): string {
    return `?hub=${this.hub}&model=${this.model}&finish=${this.finish}`;
  }

  private bindStream(): void {
    this.liveClient = new LiveClient(this.selectionQuery(), {
      onLive: (reading) => this.onReading(reading),
      onMine: () => void this.reRead(),
      onSession: (state) => this.onSessionEvent(state),
    });
  }

  private async bindIdentity(): Promise<void> {
    pollIdentity((me) => {
      this.me = me;
      this.updateLockButton();
    });
  }

  private onSessionEvent(state: "ended" | "signed_out"): void {
    if (state === "ended") {
      status.announce("Your session has ended. Sign in to continue. Your choices are kept.", "session");
      this.me = { user: null, signedIn: false };
      this.updateLockButton();
    }
  }

  // A change of hub, model or finish starts a new reading: the first reply to the
  // newest selection is drawn whatever its seq, and replies for older selections drop.
  private selectionToken = 0;

  private onSelectionChange(): void {
    this.selectionToken += 1;
    this.drawn = { ...this.drawn, unitsLeft: null, onRoadPaise: null, seq: 0 };
    this.liveClient.setQuery(this.selectionQuery());
    this.updatePartsList();
    this.updatePriceSection(true);
    this.writeUrl();
    if (this.model === "desh-648" || this.model === "megh-349") {
      this.rebuildMachine();
    }
    this.applyElevationReading();
    const token = this.selectionToken;
    void api<LiveReading>(`/api/live/now${this.selectionQuery()}`).then((res) => {
      if (!res.ok || token !== this.selectionToken) return;
      this.onReading(res.data, true);
    });
  }

  private onReading(reading: LiveReading, force = false): void {
    // Newest reading wins: a reply or event at or below drawn.seq is dropped.
    if (!force && reading.seq <= this.drawn.seq && reading.hub === this.hub && reading.model === this.model && reading.finish === this.finish) {
      return;
    }
    if (reading.hub !== this.hub || reading.model !== this.model || reading.finish !== this.finish) return;
    const hadPrice = this.drawn.onRoadPaise;
    this.live = reading;
    this.drawn = {
      seq: reading.seq,
      unitsLeft: reading.unitsLeft,
      onRoadPaise: reading.quote.onRoadPaise,
      lockExpiresAt: reading.lock !== null && reading.lock.state === "locked" ? reading.lock.expiresAt : null,
      nextSlot: reading.nextSlot !== null ? reading.nextSlot.startsAt : null,
      finish: this.finish,
      display: this.displayText(reading),
    };
    // a local action never changes a drawn count; only the server's reply arrives here
    this.updatePriceSection(false);
    this.updateLockButton();
    this.updateElevations(reading);
    if (hadPrice !== null && hadPrice !== reading.quote.onRoadPaise && hadPrice !== 0) {
      status.announce(`Price updated for today. New on-road price ${formatPaise(reading.quote.onRoadPaise)}.`, "price");
    }
    this.applyHubStaleness(reading);
    this.repaintKeyOn(force);
  }

  private displayText(reading: LiveReading): string {
    const units = String(Math.max(0, Math.min(99, reading.unitsLeft))).padStart(2, "0");
    const ride = reading.nextSlot !== null ? istHm(reading.nextSlot.startsAt).replace(/^0/, "") || "12:00" : "--:--";
    const ride12 = reading.nextSlot !== null ? to12h(reading.nextSlot.startsAt) : "--:--";
    void ride;
    return `UNITS ${units} RIDE ${ride12}`;
  }

  private applyHubStaleness(reading: LiveReading): void {
    const lit = reading.stale;
    if (this.lampLit !== lit) {
      this.lampLit = lit;
      if (!this.keyedOn) return;
      this.startStep("lamp", LAMP_MS);
      const target = lit ? new THREE.Color(ACCENT_RGB.r / 255, ACCENT_RGB.g / 255, ACCENT_RGB.b / 255) : new THREE.Color(0x181920);
      if (this.machine) {
        (this.machine.lamp.material as THREE.MeshBasicMaterial).color.copy(target);
      }
      // the hub stale string follows the selected hub
      status.announce(hubStaleString(reading), "hub-stale");
      this.updateOutageField(reading);
    } else {
      this.updateOutageField(reading);
    }
  }

  private updateOutageField(reading: LiveReading): void {
    const field = maybe<HTMLElement>("#hub-outage");
    if (!field) return;
    if (reading.stale) {
      field.textContent = hubStaleString(reading);
      field.hidden = false;
    } else {
      field.hidden = true;
    }
  }

  // ---------- key-on ----------

  private repaintKeyOn(force = false): void {
    if (!this.machine) return;
    const reading = this.live;
    if (reading === null) return;
    const keyNow = this.progress >= KEY_ON_AT;
    const hoursLeft = reading.lock !== null && reading.lock.state === "locked" ? reading.lock.hoursLeft : reading.hoursLeft;

    if (keyNow && !this.keyedOn) {
      this.keyedOn = true;
      // the needle sweeps up to full scale and settles on its angle
      this.needleAnim = { from: this.needleDeg, to: needleAngleFor(hoursLeft), started: performance.now(), ms: NEEDLE_SWEEP_MS, name: "needle-sweep" };
      this.startStep("needle-sweep", NEEDLE_SWEEP_MS);
    } else if (keyNow && this.keyedOn) {
      // a newer sequence during a sweep restarts it and ends on the newest value
      const to = needleAngleFor(hoursLeft);
      if (Math.abs(to - this.needleDeg) > 0.01) {
        const duringSweep = this.needleAnim !== null;
        this.needleAnim = { from: this.needleDeg, to, started: performance.now(), ms: duringSweep ? NEEDLE_SETTLE_MS : NEEDLE_SETTLE_MS, name: "needle-settle" };
        this.startStep("needle-settle", NEEDLE_SETTLE_MS);
      }
    } else if (!keyNow && this.keyedOn) {
      this.keyedOn = false;
      this.needleDeg = -135;
      this.needleAnim = null;
    }

    // below 0.86 the display and lamp are dark, the needle rests at -135
    if (!keyNow) {
      paintDisplay(this.machine.displayCanvas, 0, "--:--");
      this.machine.displayTexture.needsUpdate = true;
      this.setLampLit(false, false);
      this.paintTank(this.paintHexFor(this.finish), false);
      this.primer = false;
    } else {
      paintDisplay(this.machine.displayCanvas, reading.unitsLeft, to12h(reading.nextSlot?.startsAt ?? null));
      this.machine.displayTexture.needsUpdate = true;
      this.setLampLit(reading.stale, true);
      // the tank repaints in the chosen finish, or primer when the finish is sold out
      // and the caller holds no active lock on this hub, model and finish
      const mine = reading.lock !== null;
      const showPrimer = reading.unitsLeft === 0 && !mine;
      if (showPrimer !== this.primer) {
        this.primer = showPrimer;
        this.paintTank(showPrimer ? this.mutedHex() : this.paintHexFor(this.finish), true);
      }
    }
  }

  private setLampLit(lit: boolean, animated: boolean): void {
    if (!this.machine) return;
    if (this.lampLit === lit && animated) return;
    this.lampLit = lit;
    const mat = this.machine.lamp.material as THREE.MeshBasicMaterial;
    const target = lit ? new THREE.Color(ACCENT_RGB.r / 255, ACCENT_RGB.g / 255, ACCENT_RGB.b / 255) : new THREE.Color(0x181920);
    if (animated) {
      this.startStep("lamp", LAMP_MS);
      this.lampAnim = { from: mat.color.clone(), to: target, started: performance.now(), ms: LAMP_MS };
    } else {
      mat.color.copy(target);
    }
  }

  private paintTank(hex: string, animated: boolean): void {
    if (!this.machine) return;
    const mat = this.machine.tank.material as THREE.MeshStandardMaterial;
    const target = new THREE.Color(hex);
    if (animated) {
      this.startStep("paint", PAINT_MS);
      this.paintAnim = { from: mat.color.clone(), to: target, started: performance.now(), ms: PAINT_MS };
    } else {
      mat.color.copy(target);
    }
    this.tankPaintColor.copy(target);
  }

  // ---------- price section ----------

  private updatePriceSection(loading: boolean): void {
    const ex = maybe<HTMLElement>("#ex-showroom");
    const on = maybe<HTMLElement>("#on-road");
    const stock = maybe<HTMLElement>("#stock-line");
    const asOf = maybe<HTMLElement>("#as-of");
    const reading = this.live;
    if (loading || reading === null || this.drawn.onRoadPaise === null) {
      if (ex) ex.textContent = "Reading price…";
      if (on) on.textContent = "Reading price…";
      if (stock) stock.textContent = "Reading price…";
      return;
    }
    if (ex) ex.textContent = formatPaise(reading.quote.exShowroomPaise);
    if (on) on.textContent = formatPaise(reading.quote.onRoadPaise);
    if (stock) {
      const n = reading.unitsLeft;
      const finishName = finishNameFor(this.finish);
      const hubName = hubNameFor(this.hub);
      stock.textContent = n === 1 ? `1 unit left in ${finishName} at ${hubName}.` : `${n} units left in ${finishName} at ${hubName}.`;
    }
    if (asOf) {
      if (reading.stale) {
        asOf.textContent = `Stock as of ${reading.stockAsOfLabel}`;
        asOf.hidden = false;
      } else {
        asOf.hidden = true;
      }
    }
  }

  private updateLockButton(): void {
    const btn = maybe<HTMLButtonElement>("#lock-price");
    if (!btn) return;
    const reading = this.live;
    let disabled = true;
    if (reading !== null && this.drawn.onRoadPaise !== null) {
      disabled = false;
      if (reading.stale) disabled = true;
      const finishLeft = reading.finishes.find((f) => f.finish === this.finish)?.unitsLeft ?? 0;
      if (finishLeft === 0) disabled = true;
      if (reading.lock !== null) disabled = true;
    }
    btn.setAttribute("aria-disabled", String(disabled));
  }

  private async openLockDialog(): Promise<void> {
    if (!this.me.signedIn) {
      // the sign-in dialog comes first and the lock dialog follows
      const ok = await openSignIn(this.canvas);
      if (!ok) return;
      await this.reRead();
    }
    const reading = this.live;
    if (reading === null) return;
    await openLockDialogWithReading(reading, this.finish, this.hub, this.model, this, async (result) => {
      if (result.kind === "closed") return;
      if (result.kind === "requested") {
        status.announce("Checking with the hub.", "lock-result");
      } else if (result.kind === "locked") {
        const l = result.lock;
        status.announce(`Price locked until ${l.expiresLabel ?? ""}.`, "lock-result");
      } else if (result.kind === "refused") {
        status.announce("That finish has just gone. Nothing was locked.", "lock-result");
      } else if (result.kind === "already") {
        status.announce("You already hold a different lock on this model. Release it first.", "lock-result");
      } else if (result.kind === "stale") {
        status.announce("Hub system unreachable. Showing stock from " + (this.live?.stockAsOfLabel ?? "") + ". Locks are paused.", "hub-stale");
      }
      void this.reRead();
    });
  }

  async reRead(): Promise<void> {
    const res = await api<LiveReading>(`/api/live/now${this.selectionQuery()}`);
    if (res.ok) this.onReading(res.data, true);
  }

  // ---------- elevation fallback ----------

  private applyElevationReading(): void {
    this.updateElevations(this.live);
  }

  private updateElevations(reading: LiveReading | null): void {
    if (this.mode !== "fallback") return;
    const root = maybe<HTMLElement>("#elevation-root");
    if (!root) return;
    const hoursLeft = reading !== null && reading.lock !== null && reading.lock.state === "locked" ? reading.lock.hoursLeft : reading?.hoursLeft ?? 0;
    const needle = reading !== null ? needleAngleFor(hoursLeft) : -135;
    const primer = reading !== null && reading.unitsLeft === 0 && reading.lock === null;
    const tankHex = primer ? this.mutedHex() : this.paintHexFor(this.finish);
    root.querySelectorAll<HTMLImageElement>("img.elevation").forEach((img) => {
      img.dataset.needleDeg = String(needle);
      img.dataset.lamp = String(reading?.stale ?? false);
      img.dataset.units = String(Math.max(0, Math.min(99, reading?.unitsLeft ?? 0))).padStart(2, "0");
      img.dataset.ride = reading?.nextSlot ? to12h(reading.nextSlot.startsAt) : "--:--";
      img.dataset.tank = tankHex;
    });
  }

  private updateFallbackChapter(): void {
    if (this.mode !== "fallback") return;
    const root = maybe<HTMLElement>("#elevation-root");
    if (!root) return;
    root.querySelectorAll<HTMLImageElement>("img.elevation").forEach((img) => {
      img.classList.toggle("current", img.dataset.chapter === CHAPTER_RANGES[this.chapterIdx].id);
    });
  }

  // ---------- reduced motion ----------

  private setReduced(on: boolean): void {
    this.reduced = on;
    this.mode = on && this.renderer !== null ? "reduced" : this.renderer !== null ? "webgl" : "fallback";
    const wrap = maybe<HTMLElement>("#stage-space");
    const stage = maybe<HTMLElement>(".stage");
    if (wrap && stage) {
      if (on) {
        wrap.style.height = "0vh";
        stage.classList.add("reduced-stage");
      } else {
        wrap.style.height = "700vh";
        stage.classList.remove("reduced-stage");
        this.scrollToProgress(this.progress);
      }
    }
    if (on) {
      this.startStep("dissolve", DISSOLVE_MS);
      this.renderPose();
    }
  }

  // ---------- steps ----------

  private startStep(name: string, ms: number): void {
    this.steps.push({ name, ms, easing: EASING_TEXT, startedAt: performance.now(), endedAt: null });
    if (this.steps.length > 64) this.steps.shift();
  }

  private logStep(name: string, ms: number, apply: () => void): void {
    this.startStep(name, ms);
    apply();
    const last = this.steps[this.steps.length - 1];
    if (last) last.endedAt = performance.now();
  }

  private finishLastStepOf(name: string): void {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].name === name && this.steps[i].endedAt === null) {
        this.steps[i].endedAt = performance.now();
        break;
      }
    }
  }

  // ---------- render loop ----------

  private renderLoop(): void {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      // wheel damping: close 12% of the remaining gap per frame at 60fps
      if (!this.reduced && !this.paused) {
        const gap = this.targetProgress - this.progress;
        if (Math.abs(gap) > 1e-5) {
          const dt = this.lastFrame === 0 ? 16.7 : now - this.lastFrame;
          const close = 1 - Math.pow(1 - 0.12, dt / 16.7);
          this.progress += gap * close;
          if (Math.abs(this.targetProgress - this.progress) < 1e-5) this.progress = this.targetProgress;
        }
      }
      this.lastFrame = now;
      this.renderPose();
    };
    this.lastFrame = 0;
    this.raf = requestAnimationFrame(loop);
  }

  private lastFrame = 0;

  private renderPose(): void {
    if (this.renderer && this.machine) {
      this.applySeating();
      this.applyCameraForProgress();
      this.animateStepEffects();
      this.renderer.render(this.scene, this.camera);
    }
  }

  private animateStepEffects(): void {
    const now = performance.now();
    if (this.machine) {
      if (this.needleAnim !== null) {
        const t = clamp01((now - this.needleAnim.started) / this.needleAnim.ms);
        const eased = easeOutQuart(t);
        const deg = this.needleAnim.from + (this.needleAnim.to - this.needleAnim.from) * eased;
        this.setNeedle(deg);
        if (t >= 1) {
          this.setNeedle(this.needleAnim.to);
          this.finishLastStepOf(this.needleAnim.name);
          this.needleAnim = null;
        }
      }
      if (this.paintAnim !== null) {
        const mat = this.machine.tank.material as THREE.MeshStandardMaterial;
        const t = clamp01((now - this.paintAnim.started) / this.paintAnim.ms);
        const eased = easeOutQuart(t);
        mat.color.copy(this.paintAnim.from).lerp(this.paintAnim.to, eased);
        if (t >= 1) {
          mat.color.copy(this.paintAnim.to);
          this.finishLastStepOf("paint");
          this.paintAnim = null;
        }
      }
      if (this.lampAnim !== null) {
        const mat = this.machine.lamp.material as THREE.MeshBasicMaterial;
        const t = clamp01((now - this.lampAnim.started) / this.lampAnim.ms);
        const eased = easeOutQuart(t);
        mat.color.copy(this.lampAnim.from).lerp(this.lampAnim.to, eased);
        if (t >= 1) {
          mat.color.copy(this.lampAnim.to);
          this.finishLastStepOf("lamp");
          this.lampAnim = null;
        }
      }
    }
    if (this.cameraAnim !== null) {
      const t = clamp01((now - this.cameraAnim.started) / this.cameraAnim.ms);
      const eased = easeOutQuart(t);
      this.camera.position.lerpVectors(this.cameraAnim.fromPos, this.cameraAnim.toPos, eased);
      this.lastCameraTarget.lerpVectors(this.cameraAnim.fromTarget, this.cameraAnim.toTarget, eased);
      this.camera.lookAt(this.lastCameraTarget);
      if (t >= 1) {
        this.finishLastStepOf("camera-to-part");
        this.cameraAnim = null;
      }
    }
  }

  private setNeedle(deg: number): void {
    this.needleDeg = deg;
    if (this.machine) {
      this.machine.needle.rotation.z = (deg * Math.PI) / 180;
    }
  }

  // each group's offset moves monotonically with progress in both scroll directions;
  // the offset is above 0 before its seat point and exactly 0 from then on.
  private applySeating(): void {
    if (!this.machine) return;
    for (const g of GROUP_ORDER) {
      const seat = SEAT_POINTS[g];
      const start = TRAVEL_STARTS[g];
      let t: number;
      if (this.progress >= seat) {
        t = 1;
      } else if (this.progress <= start) {
        t = 0;
      } else {
        t = (this.progress - start) / Math.max(seat - start, 0.0001);
      }
      const offset = 1 - t;
      this.seatOffsets[g] = offset;
      this.machine.groups[g].position.y = offset * 0.5;
      this.machine.groups[g].visible = this.progress > start || this.progress === 0 && g === "frame";
    }
  }

  // the camera follows one continuous path as a function of progress, so scrolling
  // back retraces it. camera.z is below 0 at at=0.49 (chain side) and above 0 at
  // at=0.63 (exhaust side).
  private applyCameraForProgress(): void {
    if (this.cameraAnim !== null) return;
    const p = this.progress;
    // a continuous swing that crosses z=0 between at=0.49 (chain side, z<0) and
    // at=0.63 (exhaust side, z>0): angle = pi/2 at p = 0.56.
    const angle = Math.PI / 2 + (p - 0.56) * 3.4;
    const radius = 3.3 - p * 0.55;
    const y = 0.85 + p * 0.3;
    this.camera.position.set(
      Math.sin(angle) * radius + 0.25,
      y,
      -Math.cos(angle) * radius
    );
    this.lastCameraTarget.set(0, 0.45, 0);
    this.camera.lookAt(this.lastCameraTarget);
  }

  // ---------- context loss ----------

  private pauseScene(): void {
    this.paused = true;
    status.announce("3D showroom paused. Your place is kept.", "session");
    const toolbar = maybe<HTMLElement>("#chapters-toolbar");
    toolbar?.setAttribute("aria-disabled", "true");
    for (const id of ["#parts-list", "#parts-sheet-list"]) {
      maybe<HTMLElement>(id)?.setAttribute("aria-disabled", "true");
    }
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.needleAnim = null;
    this.cameraAnim = null;
    this.paintAnim = null;
    this.lampAnim = null;
  }

  private restoreScene(): void {
    // GPU resources and the display texture are rebuilt, and the pose returns.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, preserveDrawingBuffer: true, antialias: true });
    this.rebuildMachine();
    this.paused = false;
    status.announce("3D showroom is back.", "session");
    const toolbar = maybe<HTMLElement>("#chapters-toolbar");
    toolbar?.removeAttribute("aria-disabled");
    for (const id of ["#parts-list", "#parts-sheet-list"]) {
      maybe<HTMLElement>(id)?.removeAttribute("aria-disabled");
    }
    this.renderLoop();
    // the scene draws the newest sequence that arrived while paused
    void this.reRead();
  }

  // ---------- probe ----------

  snapshot(): Record<string, unknown> {
    const probes = this.computeProbes();
    const geometry = this.machine
      ? {
          wheelbaseMm: this.machine.spec.wheelbaseMm,
          cylinders: this.machine.spec.cylinders,
          silencers: this.machine.spec.silencers,
          rakeDeg: this.machine.spec.rakeDeg,
          frontRimIn: this.machine.spec.frontRimIn,
          rearRimIn: this.machine.spec.rearRimIn,
          sideStandSide: this.machine.spec.sideStandSide,
          chainSide: this.machine.spec.chainSide,
          exhaustSide: this.machine.spec.exhaustSide,
          leanDeg: this.machine.spec.leanDeg,
          leanSide: this.machine.spec.leanSide,
        }
      : null;
    return {
      mode: this.mode === "webgl" && this.reduced ? "reduced" : this.mode,
      paused: this.paused,
      progress: Number(this.progress.toFixed(3)),
      chapter: CHAPTER_RANGES[this.chapterIdx]?.id ?? "frame",
      part: this.part,
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      seatOffsets: this.seatOffsets,
      keyedOn: this.keyedOn,
      needleDeg: this.needleDeg,
      lamp: this.lampLit,
      drawn: {
        seq: this.drawn.seq,
        unitsLeft: this.drawn.unitsLeft,
        onRoadPaise: this.drawn.onRoadPaise,
        lockExpiresAt: this.drawn.lockExpiresAt,
        nextSlot: this.drawn.nextSlot,
        finish: this.drawn.finish,
        display: this.drawn.display,
      },
      probes,
      geometry,
      steps: this.steps.slice(-32),
    };
  }

  private computeProbes(): Record<string, { x: number; y: number; w?: number; h?: number }> {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const project = (obj: THREE.Object3D | null): { x: number; y: number } => {
      if (!obj) return { x: 0, y: 0 };
      const v = new THREE.Vector3();
      obj.getWorldPosition(v);
      v.project(this.camera);
      return { x: Math.round(((v.x + 1) / 2) * w), y: Math.round(((1 - v.y) / 2) * h) };
    };
    if (!this.machine) {
      return { tank: { x: 0, y: 0 }, lamp: { x: 0, y: 0 }, needleTip: { x: 0, y: 0 }, display: { x: 0, y: 0, w: 0, h: 0 } };
    }
    const disp = project(this.machine.display);
    const dispScale = new THREE.Vector3();
    this.machine.display.getWorldScale(dispScale);
    const dispCorners = [
      project(this.machine.display),
      project(this.machine.display),
    ];
    void dispCorners;
    const widthPx = Math.round(0.1 * (w / (2 * Math.tan((this.camera.fov * Math.PI) / 360))) / Math.max(0.5, this.camera.position.distanceTo(this.machine.display.getWorldPosition(new THREE.Vector3()))));
    return {
      tank: project(this.machine.tank),
      lamp: project(this.machine.lamp),
      needleTip: project(this.machine.needleTip),
      display: { x: disp.x, y: disp.y, w: Math.max(1, widthPx), h: Math.max(1, Math.round(widthPx * 0.28)) },
    };
  }
}

function hubNameFor(hub: string): string {
  const map: Record<string, string> = { pune: "Pune", bengaluru: "Bengaluru", gurugram: "Gurugram", kochi: "Kochi" };
  return map[hub] ?? hub;
}

function finishNameFor(finish: string): string {
  const map: Record<string, string> = { "monsoon-slate": "Monsoon Slate", kesar: "Kesar", "raat-black": "Raat Black" };
  return map[finish] ?? finish;
}

// ---------- helpers used by the module ----------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOutQuart(t: number): number {
  // matches cubic-bezier(0.22, 1, 0.36, 1): 96% complete at half its duration
  return 1 - Math.pow(1 - t, 4.2);
}

function partChapter(partId: string): string {
  const map: Record<string, string> = {
    "steering-head": "frame",
    "swingarm": "frame",
    "side-stand": "frame",
    "cylinder": "engine",
    "primary-cover": "engine",
    "filler-cap": "tank",
    "knee-recess": "tank",
    "front-rim": "wheels",
    "rear-rim": "wheels",
    "chain": "wheels",
    "header": "exhaust",
    "silencer": "exhaust",
    "rider-seat": "seat",
    "pillion-seat": "seat",
    "needle": "cluster",
    "tell-tale": "cluster",
    "display": "cluster",
  };
  return map[partId] ?? "";
}

function chapterParts(chapterId: string): { id: string; name: string }[] {
  const map: Record<string, { id: string; name: string }[]> = {
    frame: [
      { id: "steering-head", name: "Steering head" },
      { id: "swingarm", name: "Swingarm" },
      { id: "side-stand", name: "Side stand" },
    ],
    engine: [
      { id: "cylinder", name: "Cylinder" },
      { id: "primary-cover", name: "Primary cover" },
    ],
    tank: [
      { id: "filler-cap", name: "Filler cap" },
      { id: "knee-recess", name: "Knee recess" },
    ],
    wheels: [
      { id: "front-rim", name: "Front rim" },
      { id: "rear-rim", name: "Rear rim" },
      { id: "chain", name: "Chain" },
    ],
    exhaust: [
      { id: "header", name: "Header" },
      { id: "silencer", name: "Silencer" },
    ],
    seat: [
      { id: "rider-seat", name: "Rider seat" },
      { id: "pillion-seat", name: "Pillion seat" },
    ],
    cluster: [
      { id: "needle", name: "Needle" },
      { id: "tell-tale", name: "Tell-tale" },
      { id: "display", name: "Display" },
    ],
  };
  return map[chapterId] ?? [];
}

function optionsOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
}

function to12h(iso: string | null): string {
  if (iso === null) return "--:--";
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return "--:--";
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}`;
}

function hubStaleString(reading: LiveReading): string {
  // the counting strings come from staleReason count; the unreachable ones from system
  if (reading.staleReason === "count") {
    return `Hub is counting stock. Showing stock from ${reading.stockAsOfLabel}. Locks are paused.`;
  }
  return `Hub system unreachable. Showing stock from ${reading.stockAsOfLabel}. Locks are paused.`;
}

// ---------- the lock dialog ----------

type LockDialogOutcome =
  | { kind: "closed" }
  | { kind: "locked"; lock: LockJson }
  | { kind: "requested" }
  | { kind: "refused" }
  | { kind: "already" }
  | { kind: "stale" }
  | { kind: "price_moved" };

async function openLockDialogWithReading(
  reading: LiveReading,
  finish: string,
  hub: string,
  model: string,
  showroom: Showroom,
  onOutcome: (r: LockDialogOutcome) => void
): Promise<void> {
  let dlg = maybe<HTMLDialogElement>("dialog#lock-confirm");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "lock-confirm";
    dlg.setAttribute("aria-label", "Confirm your lock");
    dlg.innerHTML = `
      <h2>Confirm your lock</h2>
      <div class="dlg-body">
        <div class="dlg-row"><span class="label">Machine</span><span id="lc-model"></span></div>
        <div class="dlg-row"><span class="label">Finish</span><span id="lc-finish"></span></div>
        <div class="dlg-row"><span class="label">Hub</span><span id="lc-hub"></span></div>
        <div class="dlg-row"><span class="label">On-road price</span><span id="lc-price"></span></div>
        <div class="dlg-row"><span class="label">Lock until</span><span id="lc-expiry"></span></div>
        <p class="dlg-error" id="lc-error" hidden></p>
      </div>
      <div class="dlg-actions">
        <button class="primary" id="lc-confirm">Confirm lock</button>
        <button class="secondary" id="lc-keep">Keep looking</button>
      </div>`;
    document.body.appendChild(dlg);
  }
  const modelEl = qs<HTMLElement>("#lc-model", dlg);
  const finishEl = qs<HTMLElement>("#lc-finish", dlg);
  const hubEl = qs<HTMLElement>("#lc-hub", dlg);
  const priceEl = qs<HTMLElement>("#lc-price", dlg);
  const expiryEl = qs<HTMLElement>("#lc-expiry", dlg);
  const confirmBtn = qs<HTMLButtonElement>("#lc-confirm", dlg);
  const keepBtn = qs<HTMLButtonElement>("#lc-keep", dlg);
  const errorEl = qs<HTMLElement>("#lc-error", dlg);

  const paintDialog = (r: LiveReading) => {
    modelEl.textContent = model === "megh-349" ? "Megh 349" : "Desh 648";
    finishEl.textContent = finishNameFor(finish);
    hubEl.textContent = hubNameFor(hub);
    priceEl.textContent = formatPaise(r.quote.onRoadPaise);
    expiryEl.textContent = r.lockPreview !== null ? r.lockPreview.expiresLabel : "";
    const finishLeft = r.finishes.find((f) => f.finish === finish)?.unitsLeft ?? 0;
    const disable = r.stale || finishLeft === 0;
    confirmBtn.setAttribute("aria-disabled", String(disable));
    if (disable && r.stale) {
      errorEl.textContent = hubStaleString(r);
      errorEl.hidden = false;
    } else if (disable) {
      errorEl.textContent = "That finish has just gone. Nothing was locked.";
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
    }
  };
  paintDialog(reading);

  // while open it repaints amounts and expiry in place from each reading
  const onLive = (r: LiveReading) => {
    if (dlg.open) paintDialog(r);
  };
  showroom.liveClient["events"] = { ...showroom.liveClient["events"], onLive: (r: LiveReading) => onLive(r) } as never;

  return new Promise<void>((resolve) => {
    let done = false;
    const settle = (outcome: LockDialogOutcome) => {
      if (done) return;
      done = true;
      dlg.close();
      onOutcome(outcome);
      resolve();
    };
    keepBtn.onclick = () => settle({ kind: "closed" });
    dlg.oncancel = () => settle({ kind: "closed" });
    confirmBtn.onclick = async () => {
      if (confirmBtn.getAttribute("aria-disabled") === "true") return;
      confirmBtn.setAttribute("aria-disabled", "true");
      status.announce("Checking with the hub.", "lock-result");
      const res = await apiJson<{ lock: LockJson }>("/api/locks", "POST", {
        hub,
        model,
        finish,
        stepEffectiveFrom: reading.quote.stepEffectiveFrom,
      });
      if (res.ok) {
        if (res.data.lock.state === "requested") settle({ kind: "requested" });
        else settle({ kind: "locked", lock: res.data.lock });
        return;
      }
      confirmBtn.removeAttribute("aria-disabled");
      if (res.fail.code === "price_moved") {
        // the dialog stays open with the new amount, and focus stays where it was
        status.announce(`Price updated for today. New on-road price ${formatPaise(showroom.live?.quote.onRoadPaise ?? 0)}.`, "price");
        void showroom.reRead();
        return;
      }
      if (res.fail.code === "none_left") settle({ kind: "refused" });
      else if (res.fail.code === "lock_exists_other_finish") settle({ kind: "already" });
      else if (res.fail.status === 503) settle({ kind: "stale" });
      else {
        errorEl.textContent = res.fail.message;
        errorEl.hidden = false;
      }
    };
    dlg.showModal();
    confirmBtn.focus();
  });
}

// ---------- boot ----------

const showroom = new Showroom();
declare global {
  interface Window {
    __showroom?: { snapshot: () => Record<string, unknown> };
  }
}

function boot(): void {
  showroom.init();
  window.__showroom = { snapshot: () => showroom.snapshot() };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
