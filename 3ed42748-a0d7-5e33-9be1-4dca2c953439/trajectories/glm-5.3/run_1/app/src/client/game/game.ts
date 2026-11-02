// The game screen: world, courier, cameras, thread, presence, cards and dialogs, wired
// together with the honest state machine the brief requires.

import * as THREE from "three";
import {
  arcM, bearingDeg, DOOR_DISTANCE_M, WALK_SPEED_MPS, TURN_RATE_DEG, type LatLon,
} from "../../shared/geometry.js";
import { RESIDENTS, SATCHELS, EMOTES, type Emote } from "../../shared/seed.js";
import { api, apiRaw, ApiCallError, holdLapsed, randomStream, randomTicket, serverNow } from "../api.js";
import { clamp, h, icon, MotionPreference } from "../dom.js";
import { buildWorld, buildFigure, drawRibbon, latLonToVec, poseFor, recolourFigure, renameFigure, styleParcel, walkStep, type WorldObjects } from "./world.js";
import { applyRig, createRig, followPose, introStartPose, orbitPose, photoPose, PHOTO_FOV_MAX, PHOTO_FOV_MIN, type CameraRig } from "./cameras.js";
import { newThreadState, phaseAtElapsed, rewindFraction, unspoolFraction } from "./thread.js";
import { GLIDE_MS, FADE_MS, matchFigures, type Figure, type PresenceEntry } from "./figures.js";
import { createNotices } from "../ui/notices.js";
import { createStampBalance } from "../ui/stamp.js";
import { createCompass } from "../ui/compass.js";
import { createCards, satchelName, type DepotRead, type Me, type RushRow } from "../ui/cards.js";
import {
  createLetter, openClaimSave, openMailDialog, openOutfitter, openRenameConfirm, openRevokeConfirm,
  openStampHistory, createModerationDrawer, createPhotoMode, Dialog,
  type LetterHandle, type ModerationHandle, type PhotoHandle, type StaffCourier, type AuditEntry, type Movement, type OutfitterSatchel,
} from "../ui/dialogs.js";

const DEPOT_SPAWN: LatLon = { lat: 0, lon: 0 };
const HEADING_NORTH = 0;
const JUMP_SPEED = 4.2; // leaves the ground for under a second
const GRAVITY = 9.8;
const INTRO_MS = 1500; // 1.2–1.8 s
const CLOUD_PERIOD_MS = 90_000; // one orbit every 60–120 s
const TURN_RAMP_MS = 200; // 0.15–0.25 s

export type OpenParcelInfo = {
  acceptance_id: string;
  mission_id: string;
  version: number;
  title: string;
  reward_stamps: number;
  resident: { resident_id: string; name: string; home: string };
  rush_id: string | null;
  hold_expires_at: string | null;
  route: { route_id: string; door: { lat: number; lon: number }; total_arc_m: number; initial_bearing_deg: number };
  dialogue: { offer: string[] };
};

type Me0 = Me & { satchel_colour: string };

export function startGame(root: HTMLElement, motion: MotionPreference): { dispose(): void } {
  const disposers: Array<() => void> = [];

  // --- regions and overlays -------------------------------------------------
  const notices = createNotices(root);
  const canvas = h("canvas", { class: "world-canvas" }) as HTMLCanvasElement;
  const regionWrap = h("div", { class: "region-wrap", role: "region", "aria-label": "Bramble", tabindex: "0" });
  regionWrap.append(canvas);
  const figureList = h("ul", { role: "list", "aria-label": "Couriers nearby", class: "figure-list" });
  const worldHost = h("div", { class: "world-host" });
  worldHost.append(regionWrap, figureList);
  root.append(worldHost);

  const compassHost = h("div", { class: "overlay-host" });
  root.append(compassHost);
  const stamp = createStampBalance(compassHost);
  const compass = createCompass(compassHost);

  const uiHost = h("div", { class: "ui-host" });
  root.append(uiHost);
  const letter: LetterHandle = createLetter(root);
  const photoMode: PhotoHandle = createPhotoMode(root, () => void takePostcard(), () => leavePhotoMode());
  const cards = createCards(uiHost, {
    onReadMission: (m) => void readMission(m),
    onClaim: (r) => void claimRush(r),
    onOutfitter: () => openOutfitterNow(),
    onHistory: () => openHistoryNow(),
    onClaimSave: () => openClaimSaveNow(),
    onSaveName: (name) => void saveName(name),
    onSignOut: () => void signOut(),
    onDrop: () => void dropParcel(),
  });

  let moderation: ModerationHandle | null = null;

  // --- state ----------------------------------------------------------------
  let me: Me0 | null = null;
  let depotRead: DepotRead | null = null;
  let hasWebGl = true;
  const world: WorldObjects | null = buildWorld(canvas);
  if (!world) {
    hasWebGl = false;
    regionWrap.append(h("p", { class: "no-webgl" }, "Bramble needs WebGL to draw the planet."));
  }

  let position: LatLon = { ...DEPOT_SPAWN };
  let headingDeg = HEADING_NORTH;
  let verticalSpeed = 0;
  let airborneM = 0;
  let grounded = true;
  let turnInput = 0;
  let walkInput = 0;
  let turnRampStart: number | null = null;
  let turnRampStop: number | null = null;
  let lastTurnDirection = 0;

  let introState: "playing" | "done" | "skipped" | "off" = motion.reduced ? "off" : "playing";
  const introStartedAt = performance.now();
  let ambientState: "running" | "paused" | "off" = "running";
  let cloudDeg = 0;
  let cloudFrozenAt: number | null = null;
  let pageVisible = !document.hidden;
  let photoModeOpen = false;
  let photoYawDeg = 0;
  let photoFov = 50;
  let pinchStart: { dist: number; fov: number } | null = null;
  let dragStart: { x: number; yaw: number } | null = null;
  let darkroomOpen = true;

  const thread = newThreadState();
  let notchMode: "idle" | "bearing" | "stamp" = "idle";
  let openParcel: OpenParcelInfo | null = null;
  let delivering = false;
  let handoverTicket: string | null = null;
  let handoverPosition: LatLon | null = null;
  let pendingClaims = new Set<string>();
  let lapApplied = false;
  let arrivalAnnounced = false;

  const stream = randomStream();
  let seq = 0;
  const figures = new Map<string, Figure>();
  let figureSeq = 0;
  let emotePending: Emote | null = null;
  let myEmote: Emote | null = null;
  let myEmoteUntil = 0;

  const rig: CameraRig | null = world ? createRig(world.camera, introStartPose({ position, headingDeg, airborneM })) : null;
  if (rig) {
    rig.mode = introState === "off" ? "over-shoulder" : "intro";
    rig.retarget(introState === "off" ? followPose({ position, headingDeg, airborneM }) : introStartPose({ position, headingDeg, airborneM }), motion.reduced);
  }

  const isTouch = matchMedia("(pointer: coarse)").matches;
  let outfitterSatchels: OutfitterSatchel[] = [];
  let postcards: Array<{ postcard_id: string; share_url: string; width: number; height: number; bytes: number; created_at: string }> = [];
  let outfitlerOpen = false;

  // --- boot: session --------------------------------------------------------
  let booted = false;
  async function boot(): Promise<void> {
    notices.show("Packing your satchel…", performance.now(), motion.reduced);
    for (;;) {
      try {
        me = (await api<Me0>("GET", "/api/me")).data;
        break;
      } catch (err) {
        if (err instanceof ApiCallError && err.status === 401) {
          me = (await api<Me0>("POST", "/api/guest", {})).data;
          break;
        }
        notices.show("Couldn't reach the depot. Retrying…", performance.now(), motion.reduced);
        await delay(3000);
      }
    }
    notices.clear(performance.now(), motion.reduced);
    booted = true;
    if (me?.open_parcel) handleParcelAnswer(me.open_parcel as OpenParcelInfo, true);
    refreshCards();
    void refreshDepot();
    void refreshOutfitter();
    void syncPostcardsList();
  }
  void boot();

  async function refreshMe(): Promise<void> {
    me = (await api<Me0>("GET", "/api/me")).data;
    refreshCards();
  }

  async function refreshDepot(): Promise<void> {
    depotRead = (await api<DepotRead>("GET", "/api/depot")).data;
    if (!photoModeOpen) cards.refreshDepot(depotRead, pendingClaims);
    maybeApplyLapse();
  }

  async function refreshOutfitter(): Promise<void> {
    outfitterSatchels = (await api<{ satchels: OutfitterSatchel[] }>("GET", "/api/outfitter")).data.satchels;
  }

  function refreshCards(): void {
    if (!me) return;
    cards.refreshPostbox(me);
    cards.refreshSatchel(me, satchelName(me.satchel_colour, SATCHELS));
    if (depotRead && !photoModeOpen) cards.refreshDepot(depotRead, pendingClaims);
    if (world) recolourFigure(world.courierSatchel, me.satchel_colour);
    syncModerationButton();
    renderPostcards();
  }

  // --- region attributes ------------------------------------------------------
  function cameraDistance(): number {
    if (!world) return 0;
    return world.camera.position.distanceTo(latLonToVec(position, airborneM));
  }

  function tiltDeg(): number {
    if (!world) return 0;
    const up = latLonToVec(position).normalize();
    const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(world.courier.quaternion);
    return (Math.acos(clamp(bodyUp.dot(up), -1, 1)) * 180) / Math.PI;
  }

  function updateRegion(): void {
    const set = (k: string, v: string): void => regionWrap.setAttribute(k, v);
    set("data-scene", hasWebGl ? "ready" : "no-webgl");
    set("data-camera", rig?.mode ?? "over-shoulder");
    set("data-camera-dist-m", cameraDistance().toFixed(1));
    set("data-camera-fov", rig ? String(Math.round(rig.current.fov)) : "");
    set("data-camera-alt-m", rig ? Math.max(1.5, rig.altitudeM()).toFixed(1) : "");
    set("data-camera-settled", rig?.settled ? "true" : "false");
    set("data-photo-yaw-deg", photoModeOpen ? String(Math.round(((photoYawDeg % 360) + 360) % 360)) : "");
    const projected = projectPoint(latLonToVec(position, airborneM));
    set("data-courier-screen", projected ? `${projected[0]},${projected[1]}` : "");
    set("data-lat", position.lat.toFixed(2));
    set("data-lon", position.lon.toFixed(2));
    set("data-grounded", grounded ? "true" : "false");
    set("data-heading-deg", String(Math.round(((headingDeg % 360) + 360) % 360)));
    set("data-courier-tilt-deg", tiltDeg().toFixed(1));
    set("data-carrying", openParcel ? (openParcel.rush_id ? "rush" : "standard") : "none");
    set("data-intro", introState);
    set("data-ambient", ambientState);
    set("data-cloud-deg", String(Math.round(cloudDeg) % 360));
  }

  function projectPoint(v: THREE.Vector3): [number, number] | null {
    if (!world) return null;
    const p = v.clone().project(world.camera);
    if (p.z > 1 || p.z < -1) return null;
    return [Math.round(((p.x + 1) / 2) * window.innerWidth), Math.round(((-p.y + 1) / 2) * window.innerHeight)];
  }

  function doorScreenPoint(): [number, number] | null {
    if (!openParcel || !world) return null;
    return projectPoint(latLonToVec(openParcel.route.door, 1.2));
  }

  function projectClamped(p: LatLon): { x: number; y: number } {
    if (!world) return { x: 0, y: 0 };
    const raw = projectPoint(latLonToVec(p, 1.2));
    const x = raw ? raw[0] : 0;
    const y = raw ? raw[1] : 0;
    return { x: clamp(x, 0, window.innerWidth), y: clamp(y, 0, window.innerHeight) };
  }

  // --- controls --------------------------------------------------------------
  const keydown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (photoModeOpen) {
      if (e.key === "ArrowRight") { photoYawDeg = (photoYawDeg + 15 + 360) % 360; syncPhotoTarget(); }
      else if (e.key === "ArrowLeft") { photoYawDeg = (photoYawDeg - 15 + 360) % 360; syncPhotoTarget(); }
      else if (e.key === "ArrowUp") { photoFov = clamp(photoFov - 5, PHOTO_FOV_MIN, PHOTO_FOV_MAX); syncPhotoTarget(); }
      else if (e.key === "ArrowDown") { photoFov = clamp(photoFov + 5, PHOTO_FOV_MIN, PHOTO_FOV_MAX); syncPhotoTarget(); }
      return;
    }
    if (introState === "playing") {
      skipIntro();
      return;
    }
    const onWorld = document.activeElement === document.body || document.activeElement === regionWrap;
    if (!onWorld) return;
    switch (e.key.toLowerCase()) {
      case "w": case "arrowup": walkInput = 1; break;
      case "s": case "arrowdown": walkInput = -1; break;
      case "a": case "arrowleft": turnInput = -1; startTurnRamp(); break;
      case "d": case "arrowright": turnInput = 1; startTurnRamp(); break;
      case " ":
        if (grounded) { grounded = false; verticalSpeed = JUMP_SPEED; }
        break;
      case "enter":
        if (thread.phase === "arrived" && !delivering) void sendHandover();
        break;
    }
  };
  const keyup = (e: KeyboardEvent): void => {
    switch (e.key.toLowerCase()) {
      case "w": case "arrowup": if (walkInput === 1) walkInput = 0; break;
      case "s": case "arrowdown": if (walkInput === -1) walkInput = 0; break;
      case "a": case "arrowleft": if (turnInput === -1) { turnInput = 0; stopTurnRamp(); } break;
      case "d": case "arrowright": if (turnInput === 1) { turnInput = 0; stopTurnRamp(); } break;
    }
  };
  // Escape closes the top-most open dialog even if focus slipped to the page.
  const escapeDelegate = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    const openDialogs = Array.from(document.querySelectorAll<HTMLElement>(".paper-dialog.is-open"));
    if (openDialogs.length === 0) return;
    e.stopPropagation();
    const top = openDialogs[openDialogs.length - 1];
    top.dispatchEvent(new CustomEvent("pm-close"));
  };
  window.addEventListener("keydown", escapeDelegate, true);

  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  disposers.push(() => {
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("keydown", escapeDelegate, true);
  });

  function startTurnRamp(): void { turnRampStart = performance.now(); turnRampStop = null; }
  function stopTurnRamp(): void { if (turnInput === 0) turnRampStop = performance.now(); }

  // Touch controls.
  let stickEl: HTMLElement | null = null;
  let knobEl: HTMLElement | null = null;
  let stickActive = false;
  let stickStart: { x: number; y: number } | null = null;
  if (isTouch) {
    stickEl = h("div", { role: "group", "aria-label": "Move stick", class: "move-stick" });
    knobEl = h("div", { class: "move-knob" });
    stickEl.append(knobEl);
    const jump = h("button", { class: "btn btn-touch btn-jump", "aria-label": "Jump" }, icon("arrowUp", 26));
    jump.addEventListener("click", () => { if (grounded) { grounded = false; verticalSpeed = JUMP_SPEED; } });
    root.append(stickEl, jump);

    stickEl.addEventListener("pointerdown", (e) => {
      stickActive = true;
      stickStart = { x: e.clientX, y: e.clientY };
      stickEl?.setPointerCapture(e.pointerId);
    });
    stickEl.addEventListener("pointermove", (e) => {
      if (!stickActive || !stickStart) return;
      const max = 40;
      const nx = clamp((e.clientX - stickStart.x) / max, -1, 1);
      const ny = clamp((e.clientY - stickStart.y) / max, -1, 1);
      if (knobEl) knobEl.style.transform = `translate(${nx * max}px, ${ny * max}px)`;
      walkInput = -ny;
      const newTurn = Math.abs(nx) > 0.15 ? Math.sign(nx) : 0;
      if (newTurn !== turnInput) {
        if (newTurn !== 0) startTurnRamp(); else stopTurnRamp();
        turnInput = newTurn;
      }
    });
    const stickEnd = (): void => {
      stickActive = false;
      stickStart = null;
      walkInput = 0;
      turnInput = 0;
      stopTurnRamp();
      if (knobEl) knobEl.style.transform = "";
    };
    stickEl.addEventListener("pointerup", stickEnd);
    stickEl.addEventListener("pointercancel", stickEnd);

    regionWrap.addEventListener("pointerdown", (e) => {
      if (!photoModeOpen) return;
      dragStart = { x: e.clientX, yaw: photoYawDeg };
      regionWrap.setPointerCapture(e.pointerId);
    });
    regionWrap.addEventListener("pointermove", (e) => {
      if (!photoModeOpen || !dragStart) return;
      photoYawDeg = (dragStart.yaw + (e.clientX - dragStart.x) / 4 + 720) % 360;
      syncPhotoTarget();
    });
    regionWrap.addEventListener("pointerup", () => { dragStart = null; });
    regionWrap.addEventListener("wheel", (e) => {
      if (!photoModeOpen) return;
      e.preventDefault();
      photoFov = clamp(photoFov + (e.deltaY > 0 ? 5 : -5), PHOTO_FOV_MIN, PHOTO_FOV_MAX);
      syncPhotoTarget();
    }, { passive: false });
    regionWrap.addEventListener("touchstart", (e) => {
      if (!photoModeOpen || e.touches.length !== 2) return;
      pinchStart = { dist: touchDistance(e), fov: photoFov };
    });
    regionWrap.addEventListener("touchmove", (e) => {
      if (!photoModeOpen || !pinchStart || e.touches.length !== 2) return;
      e.preventDefault();
      const dist = touchDistance(e);
      photoFov = clamp(Math.round(pinchStart.fov * (pinchStart.dist / dist)), PHOTO_FOV_MIN, PHOTO_FOV_MAX);
      syncPhotoTarget();
    }, { passive: false });
    regionWrap.addEventListener("touchend", () => { pinchStart = null; });
  }

  function touchDistance(e: TouchEvent): number {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  const introSkipPointer = (e: Event): void => {
    if (introState !== "playing") return;
    skipIntro();
    if (e.target instanceof HTMLElement) {
      const control = e.target.closest("button");
      if (control) control.click();
    }
  };
  window.addEventListener("pointerdown", introSkipPointer);
  disposers.push(() => window.removeEventListener("pointerdown", introSkipPointer));

  function skipIntro(): void {
    if (introState !== "playing") return;
    introState = "skipped";
    if (rig) {
      rig.mode = "over-shoulder";
      rig.retarget(followPose({ position, headingDeg, airborneM }), motion.reduced);
    }
  }

  // --- the frame loop --------------------------------------------------------
  let lastFrame = performance.now();
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    // The intro dive, timed by the page clock.
    if (introState === "playing" && !motion.reduced) {
      if (now - introStartedAt >= INTRO_MS) {
        introState = "done";
        if (rig) {
          rig.mode = "over-shoulder";
          rig.retarget(followPose({ position, headingDeg, airborneM }), motion.reduced);
        }
      } else if (rig) {
        const t = clamp((now - introStartedAt) / INTRO_MS, 0, 1);
        const start = introStartPose({ position, headingDeg, airborneM });
        const end = followPose({ position, headingDeg, airborneM });
        const eased = 1 - Math.pow(1 - t, 2.2);
        rig.current.pos.copy(start.pos.clone().lerp(end.pos, eased));
        rig.current.look.copy(start.look.clone().lerp(end.look, eased));
        rig.current.fov = start.fov + (end.fov - start.fov) * eased;
      }
    }

    // Walking and turning; the courier can't walk until the dive ends.
    const canWalk = introState !== "playing" && !photoModeOpen;
    if (canWalk) {
      if (motion.reduced) {
        headingDeg += TURN_RATE_DEG * dt * turnInput;
      } else {
        let factor = 0;
        if (turnInput !== 0) {
          factor = clamp((now - (turnRampStart ?? now)) / TURN_RAMP_MS, 0, 1);
          lastTurnDirection = turnInput;
        } else if (turnRampStop !== null) {
          // The rate ramps back to nothing; the heading keeps changing briefly.
          factor = clamp(1 - (now - turnRampStop) / TURN_RAMP_MS, 0, 1);
          if (factor === 0) turnRampStop = null;
        }
        headingDeg += TURN_RATE_DEG * dt * factor * lastTurnDirection;
      }
      if (walkInput !== 0) position = walkStep(position, headingDeg, WALK_SPEED_MPS * dt * walkInput);
      if (!grounded) {
        verticalSpeed -= GRAVITY * dt;
        airborneM += verticalSpeed * dt;
        if (airborneM <= 0) { airborneM = 0; verticalSpeed = 0; grounded = true; }
      }
    }

    // Courier pose: upright everywhere on the sphere.
    if (world) {
      const pose = poseFor(position, headingDeg, airborneM);
      world.courier.position.copy(pose.pos);
      world.courier.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pose.up);
      world.courierParcel.visible = openParcel !== null;
      if (openParcel) styleParcel(world.courierParcel, openParcel.rush_id !== null);
    }

    // Ambient sky.
    if (motion.reduced) {
      ambientState = "off";
      if (cloudFrozenAt === null) cloudFrozenAt = cloudDeg;
    } else if (pageVisible) {
      ambientState = "running";
      if (cloudFrozenAt !== null) { cloudDeg = cloudFrozenAt; cloudFrozenAt = null; }
      cloudDeg = (cloudDeg + (dt * 360_000) / CLOUD_PERIOD_MS) % 360;
    } else {
      ambientState = "paused";
    }
    if (world) world.cloudRing.rotation.z = (cloudDeg * Math.PI) / 180;

    // Cameras.
    if (rig && world) {
      if (photoModeOpen) {
        rig.retarget(photoPose({ position, headingDeg, airborneM }, photoYawDeg, photoFov), motion.reduced);
      } else if (rig.mode === "over-shoulder") {
        rig.retarget(followPose({ position, headingDeg, airborneM }), motion.reduced);
      } else if (rig.mode === "orbit" && openParcel) {
        rig.retarget(orbitPose(position, openParcel.route.door), motion.reduced);
      }
      rig.update(now, motion.reduced);
      applyRig(world.camera, rig);
    }

    updateThread(now);

    // Ribbon and route readout.
    if (world) {
      const pos = world.ribbonGeometry.getAttribute("position");
      const last = Math.max(0, (world.ribbonGeometry.drawRange.count > 0 ? 6 : 0));
      void last;
      const n = world.ribbonGeometry.index ? world.ribbonGeometry.index.count / 6 : 0;
      const tip = pos && n > 0 ? `${pos.getX((n) * 2 - 2).toFixed(1)},${pos.getY((n) * 2 - 2).toFixed(1)},${pos.getZ((n) * 2 - 2).toFixed(1)}` : "none";
      document.body.setAttribute("data-ribbon-debug", `${world.ribbon.visible}|${n}|${tip}`);
    }
    if (world && openParcel) {
      const door = openParcel.route.door;
      const remaining = arcM(position, door);
      const total = Math.max(0.01, openParcel.route.total_arc_m);
      const fraction = Math.min(1, remaining / total);
      let visible = 0;
      if (thread.phase === "walking" || thread.phase === "arrived" || thread.phase === "handing") visible = fraction;
      else if (thread.phase === "pullback" || thread.phase === "unspool" || thread.phase === "return") visible = unspoolFraction(thread.startedAt, now);
      else if (thread.phase === "delivered") visible = Math.max(0, 1 - (now - thread.phaseStartedAt) / 250);
      else if (thread.phase === "rewind") visible = rewindFraction(thread.rewindFromFraction, thread.phaseStartedAt, now);
      drawRibbon(world, position, door, motion.reduced ? Math.ceil(visible * 10) / 10 : visible, thread.phase !== "idle" && visible > 0.001);
      compass.setRoute(
        {
          routeId: openParcel.route.route_id,
          arcRemainingM: thread.phase === "delivered" ? 0 : remaining,
          bearingDeg: bearingDeg(position, door),
          fraction,
          visible,
        },
        now,
        motion.reduced,
      );
      const doorPoint = doorScreenPoint();
      compass.setDoorScreen(doorPoint ? doorPoint[0] : null, doorPoint ? doorPoint[1] : null);
      compass.setRing(motion.reduced ? 0 : bearingDeg(position, door), motion.reduced);
      compass.setNotch(thread.phase === "delivered" ? "stamp" : notchMode);
    } else {
      drawRibbon(world!, position, DEPOT_SPAWN, 0, false);
      compass.setRoute(null, now, motion.reduced);
      compass.setDoorScreen(null, null);
      compass.setRing(0, motion.reduced);
      compass.setNotch(notchMode);
    }
    compass.setPhase(thread.phase);

    updateFigures(now, dt);
    notices.tick(now, motion.reduced);
    stamp.tick(now, motion.reduced);
    letter.tick(now, motion.reduced);
    updateRegion();
    updateHandoverButton();

    if (world) {
      const w = regionWrap.clientWidth || window.innerWidth;
      const hgt = regionWrap.clientHeight || window.innerHeight;
      world.renderer.setSize(w, hgt, false);
      world.camera.aspect = w / hgt;
      world.camera.updateProjectionMatrix();
      world.renderer.render(world.scene, world.camera);
    }
  };
  requestAnimationFrame(frame);
  disposers.push(() => { /* raf loop stops with the page */ });

  // --- the thread phases ----------------------------------------------------
  function updateThread(now: number): void {
    if (!openParcel) return;
    if (thread.phase === "pullback" || thread.phase === "unspool" || thread.phase === "return") {
      if (motion.reduced) {
        // Reduced motion: no camera move; the phase goes straight to walking.
        thread.phase = "walking";
        thread.phaseStartedAt = now;
        if (rig) rig.mode = "over-shoulder";
      } else {
        const expected = phaseAtElapsed(thread.startedAt, now);
        if (expected === "walking") {
          thread.phase = "walking";
          thread.phaseStartedAt = now;
          if (rig) rig.mode = "over-shoulder";
        } else {
          thread.phase = expected;
        }
      }
    }
    const door = openParcel.route.door;
    const remaining = arcM(position, door);
    if ((thread.phase === "walking" || thread.phase === "return") && remaining <= DOOR_DISTANCE_M) {
      thread.phase = "arrived";
      thread.phaseStartedAt = now;
      if (!arrivalAnnounced) {
        arrivalAnnounced = true;
        if (motion.reduced) compass.announce(`Arrived at ${openParcel.resident.home}.`);
        else notices.show(`Arrived at ${openParcel.resident.home}.`, now, motion.reduced);
      }
    } else if (thread.phase === "arrived" && remaining > DOOR_DISTANCE_M) {
      thread.phase = "walking";
    }
  }

  function handleParcelAnswer(parcel: OpenParcelInfo, silent: boolean): void {
    const changed = !openParcel || openParcel.acceptance_id !== parcel.acceptance_id;
    openParcel = parcel;
    handoverTicket = null;
    handoverPosition = null;
    if (changed) notchMode = "bearing";
    if (changed) {
      thread.phase = motion.reduced ? "walking" : "pullback";
      thread.startedAt = performance.now();
      thread.phaseStartedAt = thread.startedAt;
      thread.rewindFromFraction = 1;
      arrivalAnnounced = false;
      lapApplied = false;
      if (rig && !motion.reduced) rig.mode = "orbit";
      if (!silent) {
        const copy = parcel.rush_id
          ? `It's yours! Deliver before ${holdEndLocal(parcel.hold_expires_at)}.`
          : "Parcel taken. Follow the teal thread.";
        notices.show(copy, performance.now(), motion.reduced);
      }
      scheduleHoldEndRead();
    }
  }

  function holdEndLocal(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(Date.parse(iso));
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // --- taking a parcel (DP-72, DP-67) -----------------------------------------
  async function readMission(m: DepotRead["missions"][number]): Promise<void> {
    const resident = RESIDENTS.find((r) => r.resident_id === m.resident_id)!;
    letter.showOffer(
      { residentName: resident.name, home: resident.home, mission: m },
      projectClamped(resident.door),
      (btn) => void takeParcel(m, btn),
      () => letter.closeNow(),
    );
  }

  async function takeParcel(m: DepotRead["missions"][number], btn: HTMLElement): Promise<void> {
    btn.setAttribute("aria-disabled", "true");
    const body = { position: { lat: position.lat, lon: position.lon } };
    notices.show("Taking the parcel…", performance.now(), motion.reduced);
    let sawNetworkFailure = false;
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const res = await api<OpenParcelInfo>("POST", `/api/missions/${m.mission_id}/accept`, body);
        onAcceptAnswer(res.data);
        return;
      } catch (err) {
        if (err instanceof ApiCallError) {
          const code = err.error.code;
          if (code === "mission_not_live") {
            notices.show("This errand is no longer posted.", performance.now(), motion.reduced);
            letter.closeNow();
            void refreshDepot();
            return;
          }
          if (code === "hands_full") {
            notices.show("Your hands are full — deliver or drop your parcel first.", performance.now(), motion.reduced);
            letter.closeNow();
            return;
          }
          notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
          return;
        }
        sawNetworkFailure = true;
        if (attempt < 3) notices.show("Connection wobbly — trying again…", performance.now(), motion.reduced);
        await delay(1000);
      }
    }
    // After three failed retries: read Me; an open parcel is handled as the 201 answer.
    try {
      me = (await api<Me0>("GET", "/api/me")).data;
      if (me.open_parcel) {
        onAcceptAnswer(me.open_parcel as OpenParcelInfo);
        return;
      }
    } catch { /* fall through */ }
    notices.show("Couldn't reach the depot. Try again.", performance.now(), motion.reduced);
    btn.setAttribute("aria-disabled", "false");
    void sawNetworkFailure;
  }

  function onAcceptAnswer(parcel: OpenParcelInfo): void {
    // The letter folds first; the pull-back starts once the fold has finished.
    letter.closeNow();
    handleParcelAnswer(parcel, false);
    refreshCards();
    void refreshDepot();
  }

  // --- rush claim --------------------------------------------------------------
  async function claimRush(row: RushRow): Promise<void> {
    if (pendingClaims.has(row.rush_id)) return;
    pendingClaims.add(row.rush_id);
    if (depotRead) cards.refreshDepot(depotRead, pendingClaims);
    notices.show("Claiming…", performance.now(), motion.reduced);
    const body = { position: { lat: position.lat, lon: position.lon } };
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const res = await api<OpenParcelInfo>("POST", `/api/rush/${row.rush_id}/claim`, body);
        handleParcelAnswer(res.data, false);
        pendingClaims.delete(row.rush_id);
        await refreshDepot();
        refreshCards();
        return;
      } catch (err) {
        if (err instanceof ApiCallError) {
          const code = err.error.code;
          if (code === "parcel_taken") notices.show("Another courier got there first.", performance.now(), motion.reduced);
          else if (code === "sign_in_required") notices.show("Claim your save to race for rush parcels.", performance.now(), motion.reduced);
          else if (code === "hands_full") notices.show("Your hands are full — deliver or drop your parcel first.", performance.now(), motion.reduced);
          else if (code === "board_closed") notices.show("That board has closed for the day.", performance.now(), motion.reduced);
          else if (code === "mission_not_live") notices.show("This errand is no longer posted.", performance.now(), motion.reduced);
          else notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
          pendingClaims.delete(row.rush_id);
          await refreshDepot();
          refreshCards();
          return;
        }
        if (attempt < 3) notices.show("Connection wobbly — trying again…", performance.now(), motion.reduced);
        await delay(1000);
      }
    }
    try {
      me = (await api<Me0>("GET", "/api/me")).data;
      if (me.open_parcel) {
        handleParcelAnswer(me.open_parcel as OpenParcelInfo, false);
        pendingClaims.delete(row.rush_id);
        return;
      }
    } catch { /* fall through */ }
    notices.show("Couldn't reach the depot. Try again.", performance.now(), motion.reduced);
    pendingClaims.delete(row.rush_id);
    await refreshDepot();
    refreshCards();
  }

  // --- hand-over (DP-61) -------------------------------------------------------
  function updateHandoverButton(): void {
    const wanted = (thread.phase === "arrived" || thread.phase === "handing") && !photoModeOpen;
    let btn = document.getElementById("handover-button") as HTMLButtonElement | null;
    if (wanted && !btn) {
      btn = h("button", { id: "handover-button", class: "btn btn-primary btn-handover" }, "Hand over parcel") as HTMLButtonElement;
      btn.addEventListener("click", () => void sendHandover());
      root.append(btn);
    } else if (!wanted && btn) {
      btn.remove();
      delivering = false;
    }
    if (btn) btn.setAttribute("aria-disabled", delivering ? "true" : "false");
  }

  async function sendHandover(): Promise<void> {
    if (!openParcel || delivering) return;
    delivering = true;
    thread.phase = "handing";
    thread.phaseStartedAt = performance.now();
    notices.show("Handing over…", performance.now(), motion.reduced);
    if (!handoverTicket) {
      handoverTicket = randomTicket("ho_");
      handoverPosition = { lat: position.lat, lon: position.lon };
    }
    const body = { acceptance_id: openParcel.acceptance_id, position: { lat: handoverPosition!.lat, lon: handoverPosition!.lon } };
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const res = await api<{ delivery_id: string; stamps_awarded: number; balance: number; dialogue: { thanks: string[] } }>(
          "POST", "/api/deliveries", body, { headers: { "Handover-Ticket": handoverTicket } },
        );
        onDelivered(res.data);
        return;
      } catch (err) {
        if (err instanceof ApiCallError) {
          const code = err.error.code;
          if (code === "already_delivered") {
            notices.show("That parcel was already delivered.", performance.now(), motion.reduced);
            thread.phase = "delivered";
            clearParcel();
            return;
          }
          if (code === "hold_expired") {
            applyLapse();
            return;
          }
          if (code === "too_far") {
            notices.show("Walk a little closer to the door.", performance.now(), motion.reduced);
            thread.phase = arcM(position, openParcel.route.door) <= DOOR_DISTANCE_M ? "arrived" : "walking";
            delivering = false;
            // A too_far answer keeps the ticket; the next press sends the current position.
            handoverPosition = { lat: position.lat, lon: position.lon };
            return;
          }
          notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
          delivering = false;
          return;
        }
        if (attempt < 3) {
          notices.show("Connection wobbly — trying again…", performance.now(), motion.reduced);
          await delay(1000);
        }
      }
    }
    notices.show("Couldn't hand over. Your parcel is still safe — try again.", performance.now(), motion.reduced);
    if (openParcel) thread.phase = arcM(position, openParcel.route.door) <= DOOR_DISTANCE_M ? "arrived" : "walking";
    delivering = false;
  }

  function onDelivered(data: { stamps_awarded: number; balance: number; dialogue: { thanks: string[] } }): void {
    const resident = openParcel!.resident;
    const door = openParcel!.route.door;
    notices.show(`Delivered to ${resident.name}. +${data.stamps_awarded} stamps.`, performance.now(), motion.reduced);
    thread.phase = "delivered";
    thread.phaseStartedAt = performance.now();
    notchMode = "stamp";
    clearParcel();
    stamp.setTarget(data.balance);
    letter.showThanks({ residentName: resident.name, home: resident.home, lines: data.dialogue.thanks }, projectClamped(door), () => letter.closeNow());
    refreshCards();
    void refreshDepot();
    void refreshMe();
  }

  function clearParcel(): void {
    openParcel = null;
    handoverTicket = null;
    handoverPosition = null;
    delivering = false;
  }

  // --- rush hold lapses (DP-68) -------------------------------------------------
  function maybeApplyLapse(): void {
    if (!openParcel || openParcel.rush_id === null || lapApplied) return;
    if (!openParcel.hold_expires_at || !holdLapsed(openParcel.hold_expires_at)) return;
    const mine = depotRead?.rush.find((r) => r.rush_id === openParcel!.rush_id);
    if (mine && (mine.status === "yours" || mine.status === "delivered")) return;
    applyLapse();
  }

  function applyLapse(): void {
    if (lapApplied || !openParcel || openParcel.rush_id === null) return;
    lapApplied = true;
    notchMode = "idle";
    thread.phase = "rewind";
    thread.phaseStartedAt = performance.now();
    thread.rewindFromFraction = Math.min(1, arcM(position, openParcel.route.door) / Math.max(0.01, openParcel.route.total_arc_m));
    notices.show("Your rush hold ran out. The parcel is back on the board.", performance.now(), motion.reduced);
    const finish = (): void => {
      thread.phase = "idle";
    };
    if (motion.reduced) finish();
    else setTimeout(finish, 320);
    clearParcel();
    void refreshMe();
    void refreshDepot();
    void refreshCards();
  }

  function scheduleHoldEndRead(): void {
    if (!openParcel?.rush_id || !openParcel.hold_expires_at) return;
    const until = Date.parse(openParcel.hold_expires_at) - serverNow();
    setTimeout(() => {
      if (!pageVisible) return; // reads stop while hidden; the show handler reads at once
      void refreshMe();
      void refreshDepot().then(() => maybeApplyLapse());
    }, Math.max(0, until + 20));
  }

  // --- drop ----------------------------------------------------------------------
  async function dropParcel(): Promise<void> {
    if (!openParcel) return;
    notices.show("Dropping…", performance.now(), motion.reduced);
    const door = openParcel.route.door;
    try {
      await api("POST", `/api/acceptances/${openParcel.acceptance_id}/drop`, {});
      notices.show("Parcel dropped.", performance.now(), motion.reduced);
      startRewind(door);
      clearParcel();
      void refreshDepot();
      void refreshMe();
      void refreshCards();
    } catch (err) {
      if (err instanceof ApiCallError && err.error.code === "parcel_closed") {
        notices.show("That parcel is already closed.", performance.now(), motion.reduced);
        clearParcel();
        void refreshMe();
        void refreshCards();
      } else if (err instanceof ApiCallError) {
        notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
      }
    }
  }

  function startRewind(door: LatLon): void {
    notchMode = "idle";
    thread.phase = "rewind";
    thread.phaseStartedAt = performance.now();
    thread.rewindFromFraction = Math.min(1, arcM(position, door) / Math.max(0.01, arcM(position, door)));
    const finish = (): void => { thread.phase = "idle"; };
    if (motion.reduced) finish();
    else setTimeout(finish, 320);
  }

  // --- outfitter -----------------------------------------------------------------
  let outfitterDialog: Dialog | null = null;
  function openOutfitterNow(): void {
    const opener = document.activeElement as HTMLElement;
    if (outfitlerOpen) return;
    outfitlerOpen = true;
    outfitterDialog = openOutfitter(root, opener, outfitterSatchels, {
      onBuy: (s, btn) => void buySatchel(s, btn),
      onWear: (s) => void wearSatchel(s),
      onClosed: () => { outfitterDialog = null; outfitlerOpen = false; },
    });
  }

  function closeOutfitter(): void {
    outfitterDialog?.el.remove();
    outfitterDialog = null;
    outfitlerOpen = false;
  }

  async function buySatchel(s: OutfitterSatchel, btn: HTMLElement): Promise<void> {
    btn.setAttribute("aria-disabled", "true");
    notices.show("Wrapping it up…", performance.now(), motion.reduced);
    const ticket = randomTicket("buy_");
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const res = await api<{ balance: number }>("POST", `/api/outfitter/${s.satchel_id}/buy`, {}, { headers: { "Purchase-Ticket": ticket } });
        notices.show(`${s.name} is yours.`, performance.now(), motion.reduced);
        stamp.setTarget(res.data.balance);
        await refreshMe();
        await refreshOutfitter();
        closeOutfitter();
        openOutfitterNow();
        return;
      } catch (err) {
        if (err instanceof ApiCallError) {
          const code = err.error.code;
          if (code === "insufficient_stamps") notices.show(`You need ${s.price - (me?.balance ?? 0)} more stamps.`, performance.now(), motion.reduced);
          else if (code === "already_owned") notices.show("You already own this satchel.", performance.now(), motion.reduced);
          else notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
          btn.setAttribute("aria-disabled", "false");
          return;
        }
        if (attempt < 3) notices.show("Connection wobbly — trying again…", performance.now(), motion.reduced);
        await delay(1000);
      }
    }
    notices.show("Couldn't reach the outfitter. Your stamps are safe — try again.", performance.now(), motion.reduced);
    btn.setAttribute("aria-disabled", "false");
  }

  async function wearSatchel(s: OutfitterSatchel): Promise<void> {
    notices.show("Changing satchels…", performance.now(), motion.reduced);
    try {
      await api("PATCH", "/api/me", { satchel_id: s.satchel_id });
      notices.show(`Now wearing ${s.name}.`, performance.now(), motion.reduced);
      await refreshMe();
      closeOutfitter();
      openOutfitterNow();
    } catch (err) {
      if (err instanceof ApiCallError && err.error.code === "not_owned") notices.show("Buy this satchel first.", performance.now(), motion.reduced);
      else notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
    }
  }

  // --- stamp history ---------------------------------------------------------------
  async function openHistoryNow(): Promise<void> {
    const opener = document.activeElement as HTMLElement;
    openStampHistory(root, opener, {
      loadMore: async (cursor, list, showOlder, balanceEl) => {
        // A null cursor loads the newest page; the Show older button carries the next cursor.
        if (cursor !== null) return;
        await historyPage(null, list, showOlder, balanceEl);
      },
      onClosed: () => { /* focus returns via the dialog */ },
    });
  }

  async function historyPage(cursor: string | null, list: HTMLElement, showOlder: HTMLElement, balanceEl: HTMLElement): Promise<void> {
    notices.show("Loading older stamps…", performance.now(), motion.reduced);
    try {
      const res = await api<{ balance: number; movements: Movement[]; next_cursor: string | null }>(
        "GET", `/api/me/ledger?limit=20${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
      );
      balanceEl.textContent = `${res.data.balance} stamps`;
      for (const movement of res.data.movements) {
        const entry = movement.entries[0];
        const sign = entry.amount >= 0 ? "+" : "−";
        const kind = movement.kind === "delivery" ? "Delivery" : "Outfitter";
        list.append(h("li", { class: "movement-row" }, `${sign}${Math.abs(entry.amount)} stamps · ${kind}`));
      }
      if (res.data.next_cursor) {
        const next = res.data.next_cursor;
        showOlder.onclick = () => { void historyPage(next, list, showOlder, balanceEl); };
      } else {
        showOlder.remove();
      }
      notices.clear(performance.now(), motion.reduced);
    } catch {
      notices.show("Couldn't fetch your stamp history. Try again.", performance.now(), motion.reduced);
    }
  }

  // --- claim save, name, sign-out ----------------------------------------------------
  function openClaimSaveNow(): void {
    const opener = document.activeElement as HTMLElement;
    openClaimSave(root, opener, async (email, errEl) => {
      notices.show("Sending your postbox key…", performance.now(), motion.reduced);
      try {
        await api("POST", "/api/auth/postbox-key", { email });
        notices.show("Check your inbox for a postbox key.", performance.now(), motion.reduced);
        errEl.textContent = "";
      } catch (err) {
        if (err instanceof ApiCallError) {
          const code = err.error.code;
          if (code === "validation" && err.error.fields?.email) {
            errEl.textContent = "Enter an email address like name@example.com.";
            notices.clear(performance.now(), motion.reduced);
            return;
          }
          if (code === "post_office_closed") {
            notices.show("The post office is closed right now. Try again in a few minutes.", performance.now(), motion.reduced);
            return;
          }
        }
        notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
      }
    }, () => { /* closed */ });
  }

  async function saveName(name: string): Promise<void> {
    // The length is checked in the browser first, counting code points after the same folding.
    if (shapeNameClient(name) === null) {
      notices.show("Names are 1 to 24 characters.", performance.now(), motion.reduced);
      return;
    }
    notices.show("Saving…", performance.now(), motion.reduced);
    try {
      me = (await api<Me0>("PATCH", "/api/me", { display_name: name })).data;
      notices.show("Name saved.", performance.now(), motion.reduced);
      refreshCards();
    } catch (err) {
      if (err instanceof ApiCallError) {
        const code = err.error.code;
        if (code === "name_locked") notices.show("A community helper reset your name. It can't be changed right now.", performance.now(), motion.reduced);
        else if (code === "validation") notices.show("Names are 1 to 24 characters.", performance.now(), motion.reduced);
        else notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
      }
    }
  }

  async function signOut(): Promise<void> {
    notices.show("Signing out…", performance.now(), motion.reduced);
    try {
      await api("POST", "/api/auth/sign-out", {});
      location.href = "/";
    } catch {
      notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
    }
  }

  // --- emotes --------------------------------------------------------------------------
  const emotesBar = h("div", { role: "toolbar", "aria-label": "Emotes", class: "emotes-bar" });
  for (const emote of EMOTES) {
    const btn = h("button", { class: "btn btn-icon", "aria-label": emote[0].toUpperCase() + emote.slice(1) }, emoteIcon(emote));
    btn.addEventListener("click", () => sendEmote(emote));
    emotesBar.append(btn);
  }
  const photoBtn = h("button", { class: "btn btn-icon btn-photo", "aria-label": "Photo mode" }, icon("camera", 22));
  photoBtn.addEventListener("click", () => openPhotoModeNow());
  const bottomRight = h("div", { class: "bottom-right" });
  bottomRight.append(emotesBar, photoBtn);
  root.append(bottomRight);

  let moderationBtn: HTMLButtonElement | null = null;
  function syncModerationButton(): void {
    const isStaff = me?.role === "helper" || me?.role === "founder";
    if (isStaff && !moderationBtn) {
      moderationBtn = h("button", { class: "btn btn-icon btn-moderation", "aria-label": "Moderation" }, icon("shield", 22)) as HTMLButtonElement;
      moderationBtn.addEventListener("click", () => openModerationNow());
      bottomRight.append(moderationBtn);
    } else if (!isStaff && moderationBtn) {
      moderationBtn.remove();
      moderationBtn = null;
    }
  }

  function emoteIcon(emote: Emote): ReturnType<typeof icon> {
    const map = { wave: "hand", cheer: "sparkles", sleepy: "coffee", heart: "heart" } as const;
    return icon(map[emote], 20);
  }

  async function sendEmote(emote: Emote): Promise<void> {
    emotePending = emote;
    myEmote = emote;
    myEmoteUntil = Date.now() + 4000;
    showOwnEmoteBubble(emote);
    if (me?.muted) notices.show("You're muted, so emotes are hidden from others.", performance.now(), motion.reduced);
  }

  let emoteBubble: HTMLElement | null = null;
  function showOwnEmoteBubble(emote: Emote): void {
    emoteBubble?.remove();
    emoteBubble = h("div", { class: `own-emote own-emote-${emote}`, "aria-hidden": "true" }, emoteIcon(emote));
    root.append(emoteBubble);
    setTimeout(() => { emoteBubble?.remove(); emoteBubble = null; }, 4000);
  }

  // --- photo mode -------------------------------------------------------------------------
  function openPhotoModeNow(): void {
    if (photoModeOpen) return;
    if (!me || me.role === "guest") {
      notices.show("Claim your save to keep postcards.", performance.now(), motion.reduced);
      return;
    }
    photoModeOpen = true;
    photoYawDeg = 0;
    photoFov = 50;
    photoMode.open(photoBtn, photoMode.takeBtn);
    document.body.classList.add("photo-mode-on");
    for (const card of [cards.postboxCard, cards.depotCard, cards.satchelCard, cards.tabsBar, emotesBar, compass.ringEl]) card.classList.add("is-hidden");
    void checkDarkroom();
  }

  function leavePhotoMode(): void {
    if (!photoModeOpen) return;
    photoModeOpen = false;
    photoMode.close();
    document.body.classList.remove("photo-mode-on");
    for (const card of [cards.postboxCard, cards.depotCard, cards.satchelCard, cards.tabsBar, emotesBar, compass.ringEl]) card.classList.remove("is-hidden");
    photoBtn.focus();
  }

  function syncPhotoTarget(): void {
    if (rig) rig.retarget(photoPose({ position, headingDeg, airborneM }, photoYawDeg, photoFov), motion.reduced);
  }

  async function checkDarkroom(): Promise<void> {
    try {
      const res = await api<{ darkroom: "open" | "closed"; post_office: "open" | "closed" }>("GET", "/api/status");
      darkroomOpen = res.data.darkroom === "open";
    } catch {
      return;
    }
    photoMode.darkroomStatus.textContent = darkroomOpen
      ? "Darkroom open"
      : "The darkroom is closed. Your walk isn't affected — postcards will develop again when it reopens.";
    photoMode.takeBtn.disabled = !darkroomOpen;
    photoMode.takeBtn.setAttribute("aria-disabled", darkroomOpen ? "false" : "true");
  }

  async function takePostcard(): Promise<void> {
    if (!darkroomOpen || !world) return;
    notices.show("Developing…", performance.now(), motion.reduced);
    const width = 1200;
    const height = 800;
    const prevAspect = world.camera.aspect;
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
    world.renderer.setSize(width, height, false);
    world.renderer.render(world.scene, world.camera);
    const dataUrl = world.renderer.domElement.toDataURL("image/png");
    world.camera.aspect = prevAspect;
    world.camera.updateProjectionMatrix();
    world.renderer.setSize(regionWrap.clientWidth || window.innerWidth, regionWrap.clientHeight || window.innerHeight, false);

    const canvas2d = document.createElement("canvas");
    canvas2d.width = width;
    canvas2d.height = height;
    const ctx = canvas2d.getContext("2d")!;
    const img = new Image();
    await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = dataUrl; });
    ctx.drawImage(img, 0, 0, width, height);
    drawPostcardChrome(ctx, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas2d.toBlob(resolve, "image/png"));
    if (!blob) {
      notices.show("That photo didn't develop. Try again.", performance.now(), motion.reduced);
      return;
    }
    try {
      await apiRaw("POST", "/api/postcards", await blob.arrayBuffer(), "image/png");
      notices.show("Postcard saved to your postbox.", performance.now(), motion.reduced);
      void syncPostcardsList();
    } catch (err) {
      if (err instanceof ApiCallError) {
        const code = err.error.code;
        if (code === "postbox_full") notices.show("Your postbox is full. Revoke a postcard to make room.", performance.now(), motion.reduced);
        else if (code === "darkroom_closed") notices.show("The darkroom is closed. Your walk isn't affected — postcards will develop again when it reopens.", performance.now(), motion.reduced);
        else if (code === "sign_in_required") notices.show("Claim your save to keep postcards.", performance.now(), motion.reduced);
        else notices.show("That photo didn't develop. Try again.", performance.now(), motion.reduced);
      }
    }
  }

  function drawPostcardChrome(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.strokeStyle = "#3b2a5c";
    ctx.lineWidth = 6;
    const bite = 14;
    for (let x = 20; x < width - 40; x += bite * 2) {
      ctx.beginPath();
      ctx.arc(x, height - 26, bite / 2, 0, Math.PI);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(59,42,92,0.78)";
    ctx.font = "bold 40px Fraunces, Georgia, serif";
    ctx.fillText("Bramble", width - 300, height - 110);
    ctx.strokeStyle = "rgba(59,42,92,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(width - 236, height - 124, 80, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "30px 'Atkinson Hyperlegible', sans-serif";
    const today = new Date();
    ctx.fillText(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`, width - 330, height - 70);
    ctx.restore();
  }

  // --- postcards list ------------------------------------------------------------------------
  async function syncPostcardsList(): Promise<void> {
    if (!me || me.role === "guest") return;
    try {
      postcards = (await api<{ postcards: typeof postcards }>("GET", "/api/postcards")).data.postcards;
    } catch {
      return;
    }
    renderPostcards();
  }

  function renderPostcards(): void {
    if (!me || me.role === "guest") return;
    let list = document.getElementById("postcards-list");
    if (!list) {
      list = h("ul", { role: "list", "aria-label": "Postcards", id: "postcards-list", class: "postcards-list" });
      cards.postboxCard.querySelector(".card-body")?.append(list);
    }
    list.replaceChildren();
    for (const postcard of postcards) {
      const li = h("li", { class: "postcard-row", "data-postcard": postcard.postcard_id });
      const thumb = h("span", { class: "postcard-thumb", "aria-hidden": "true" });
      if (darkroomOpen) {
        thumb.append(h("img", { src: `${postcard.share_url}/image.png`, alt: "" }));
      } else {
        thumb.append(h("span", { class: "darkroom-thumb" }, "Image in the darkroom"));
      }
      const copy = h("button", { class: "btn btn-small", "aria-label": "Copy link" }, "Copy link");
      copy.addEventListener("click", () => {
        void navigator.clipboard?.writeText(`${location.origin}${postcard.share_url}`);
        notices.show("Link copied.", performance.now(), motion.reduced);
      });
      const mail = h("button", { class: "btn btn-small", "aria-label": "Mail to a friend" }, "Mail to a friend");
      mail.addEventListener("click", () => openMailFor(postcard, mail));
      const revoke = h("button", { class: "btn btn-small", "aria-label": "Revoke postcard" }, "Revoke postcard");
      revoke.addEventListener("click", () => openRevokeFor(postcard, revoke));
      li.append(thumb, h("div", { class: "postcard-buttons" }, copy, mail, revoke));
      list.append(li);
    }
  }

  function openMailFor(postcard: { postcard_id: string }, opener: HTMLElement): void {
    let ticket = randomTicket("mail_");
    let currentTo = "";
    openMailDialog(root, opener, async (to, errEl) => {
      if (to !== currentTo) {
        ticket = randomTicket("mail_");
        currentTo = to;
      }
      notices.show("Posting…", performance.now(), motion.reduced);
      for (let attempt = 0; attempt <= 3; attempt++) {
        try {
          await api("POST", `/api/postcards/${postcard.postcard_id}/mail`, { to }, { headers: { "Mail-Ticket": ticket } });
          notices.show(`Postcard mailed to ${to}.`, performance.now(), motion.reduced);
          (opener.closest(".paper-dialog") as HTMLElement | null)?.remove();
          return;
        } catch (err) {
          if (err instanceof ApiCallError) {
            const code = err.error.code;
            if (code === "validation") {
              errEl.textContent = "Enter your friend's email address.";
              notices.clear(performance.now(), motion.reduced);
              return;
            }
            if (code === "mail_limit") {
              notices.show("You've mailed a lot of postcards. Try again in a few minutes.", performance.now(), motion.reduced);
              return;
            }
            if (code === "post_office_closed") {
              notices.show("The post office is closed right now. Try again in a few minutes.", performance.now(), motion.reduced);
              return;
            }
            notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
            return;
          }
          if (attempt < 3) notices.show("Connection wobbly — trying again…", performance.now(), motion.reduced);
          await delay(1000);
        }
      }
      notices.show("Couldn't reach the post office. Press Send postcard again — it won't send twice.", performance.now(), motion.reduced);
    }, () => { /* closed */ });
  }

  function openRevokeFor(postcard: { postcard_id: string }, opener: HTMLElement): void {
    openRevokeConfirm(root, opener, async () => {
      notices.show("Revoking…", performance.now(), motion.reduced);
      try {
        await api("DELETE", `/api/postcards/${postcard.postcard_id}`);
        notices.show("Postcard revoked. Its link no longer works.", performance.now(), motion.reduced);
        void syncPostcardsList();
      } catch (err) {
        if (err instanceof ApiCallError && err.error.code === "darkroom_closed") {
          notices.show("The darkroom is closed. Your walk isn't affected — postcards will develop again when it reopens.", performance.now(), motion.reduced);
        } else {
          notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
        }
      }
    }, () => { /* closed */ });
  }

  // --- moderation ------------------------------------------------------------------------
  function openModerationNow(): void {
    if (!moderationBtn) return;
    if (!moderation) {
      moderation = createModerationDrawer(root, {
        onMute: (ref, name) => void moderationAction("mute", ref, name),
        onUnmute: (ref, name) => void moderationAction("unmute", ref, name),
        onRename: (ref, name) => openRenameFor(ref, name),
        onClosed: () => { /* the drawer restores focus */ },
      });
    }
    moderation.open(moderationBtn);
    void refreshModeration();
  }

  async function refreshModeration(): Promise<void> {
    if (!moderation?.isOpen) return;
    try {
      const [presence, audit] = await Promise.all([
        api<{ couriers: StaffCourier[] }>("GET", "/api/moderation/presence"),
        api<{ entries: AuditEntry[] }>("GET", "/api/moderation/audit"),
      ]);
      moderation.render(presence.data.couriers, audit.data.entries);
    } catch {
      // the next refresh retries
    }
  }

  async function moderationAction(action: "mute" | "unmute", ref: string, name: string): Promise<void> {
    notices.show("Working…", performance.now(), motion.reduced);
    try {
      await api("POST", `/api/moderation/${ref}/${action}`, {});
      notices.show(action === "mute" ? `Muted ${name}.` : `Unmuted ${name}.`, performance.now(), motion.reduced);
    } catch (err) {
      if (err instanceof ApiCallError) {
        const code = err.error.code;
        if (code === "already_muted") notices.show(`${name} is already muted.`, performance.now(), motion.reduced);
        else if (code === "not_muted") notices.show(`${name} isn't muted.`, performance.now(), motion.reduced);
        else if (code === "cannot_moderate_staff") notices.show("Helpers can't moderate staff.", performance.now(), motion.reduced);
        else notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
      }
    }
    await refreshModeration();
  }

  function openRenameFor(ref: string, name: string): void {
    const opener = document.activeElement as HTMLElement;
    openRenameConfirm(root, opener, name, async (dialogEl) => {
      notices.show("Working…", performance.now(), motion.reduced);
      try {
        const res = await api<{ display_name: string }>("POST", `/api/moderation/${ref}/rename`, {});
        notices.show(`Renamed ${name} to ${res.data.display_name}.`, performance.now(), motion.reduced);
        dialogEl.remove();
      } catch (err) {
        if (err instanceof ApiCallError && err.error.code === "cannot_moderate_staff") {
          notices.show("Helpers can't moderate staff.", performance.now(), motion.reduced);
        } else {
          notices.show("Something went wrong on Bramble.", performance.now(), motion.reduced);
        }
      }
      await refreshModeration();
    }, () => { /* closed */ });
  }

  // --- presence --------------------------------------------------------------------------
  async function heartbeat(): Promise<void> {
    if (!pageVisible || !booted) return;
    seq += 1;
    try {
      const res = await api<{ accepted: boolean; last_seq: number; emote: string | null; muted: boolean }>("POST", "/api/presence", {
        stream,
        seq,
        position: { lat: position.lat, lon: position.lon, heading_deg: ((headingDeg % 360) + 360) % 360 },
        ...(emotePending ? { emote: emotePending } : {}),
      });
      if (res.data.muted) {
        if (myEmote && Date.now() < myEmoteUntil) notices.show("You're muted, so emotes are hidden from others.", performance.now(), motion.reduced);
      }
      emotePending = null;
    } catch {
      emotePending = null;
    }
  }

  async function readPresence(): Promise<void> {
    if (!pageVisible || !booted) return;
    try {
      const res = await api<{ couriers: PresenceEntry[] }>("GET", "/api/presence");
      applyPresence(res.data.couriers, performance.now());
    } catch {
      // the next read retries
    }
  }

  function applyPresence(entries: PresenceEntry[], now: number): void {
    if (!world) return;
    const { pairings, newEntries, takenOver, leaving } = matchFigures(entries, figures, now);

    for (const { entry, figure } of pairings) {
      // An in-place name or satchel change updates the tag without fading.
      if (figure.tag !== entry.display_name) {
        figure.tag = entry.display_name;
        renameFigure(figure.group, entry.display_name);
      }
      if (figure.satchelColour !== entry.satchel_colour) {
        figure.satchelColour = entry.satchel_colour;
        recolourFigure(figure.group.children.find((c) => c instanceof THREE.Mesh && (c as THREE.Mesh).geometry?.type === "BoxGeometry") as THREE.Mesh, entry.satchel_colour);
      }
      glideTo(figure, entry.position, now);
      applyEmote(figure, entry.emote, now);
    }

    for (const { entry, figure } of takenOver) {
      // A figure taken over keeps its list item and simply updates its tag.
      figure.tag = entry.display_name;
      renameFigure(figure.group, entry.display_name);
      figure.satchelColour = entry.satchel_colour;
      glideTo(figure, entry.position, now);
      applyEmote(figure, entry.emote, now);
    }

    for (const entry of newEntries) {
      const id = `figure-${++figureSeq}`;
      const { courier, satchel } = buildFigure(entry.satchel_colour, entry.display_name, false);
      world.scene.add(courier);
      const figure: Figure = {
        id,
        group: courier,
        tag: entry.display_name,
        shownLat: entry.position.lat,
        shownLon: entry.position.lon,
        targetLat: entry.position.lat,
        targetLon: entry.position.lon,
        headingDeg: entry.position.heading_deg,
        glideFrom: { lat: entry.position.lat, lon: entry.position.lon },
        glideStartedAt: now,
        glideDurationMs: motion.reduced ? 0 : GLIDE_MS,
        fade: motion.reduced ? "shown" : "in",
        fadeStartedAt: now,
        satchelColour: entry.satchel_colour,
        emote: null,
        emoteAt: null,
      };
      void satchel;
      figures.set(id, figure);
      const pose = poseFor(entry.position, entry.position.heading_deg, 0);
      courier.position.copy(pose.pos);
      courier.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pose.up);
      setFigureOpacity(courier, motion.reduced ? 1 : 0);
      applyEmote(figure, entry.emote, now);
    }

    for (const figure of leaving) {
      figure.fade = "out";
      figure.fadeStartedAt = now;
    }
  }

  function glideTo(figure: Figure, target: { lat: number; lon: number; heading_deg: number }, now: number): void {
    const from = { lat: figure.shownLat, lon: figure.shownLon };
    const dist = arcM(from, target);
    if (dist > 20) {
      // A move longer than 20 metres of arc snaps straight to the new position.
      figure.shownLat = target.lat;
      figure.shownLon = target.lon;
      figure.targetLat = target.lat;
      figure.targetLon = target.lon;
      figure.glideFrom = { lat: target.lat, lon: target.lon };
      figure.glideStartedAt = now;
      figure.glideDurationMs = 0;
    } else {
      figure.targetLat = target.lat;
      figure.targetLon = target.lon;
      figure.glideFrom = from;
      figure.glideStartedAt = now;
      figure.glideDurationMs = motion.reduced ? 0 : GLIDE_MS;
    }
    figure.headingDeg = target.heading_deg;
  }

  function applyEmote(figure: Figure, emote: string | null, now: number): void {
    if (motion.reduced) {
      figure.emote = emote;
      figure.emoteAt = emote ? now : null;
      return;
    }
    if (emote !== null && figure.emote !== emote) {
      figure.emote = emote;
      figure.emoteAt = now;
    } else if (emote === null && figure.emote !== null) {
      figure.emote = null;
      figure.emoteAt = now;
    }
  }

  function setFigureOpacity(group: THREE.Group, opacity: number): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
        const mat = obj.material as THREE.Material & { opacity: number; transparent: boolean };
        mat.transparent = true;
        mat.opacity = opacity;
      }
    });
  }

  function updateFigures(now: number, dt: number): void {
    if (!world) return;
    for (const [id, figure] of [...figures]) {
      // Glides.
      if (figure.glideDurationMs > 0) {
        const t = clamp((now - figure.glideStartedAt) / figure.glideDurationMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const lat = figure.glideFrom.lat + (figure.targetLat - figure.glideFrom.lat) * eased;
        const lon = figure.glideFrom.lon + (figure.targetLon - figure.glideFrom.lon) * eased;
        figure.shownLat = lat;
        figure.shownLon = lon;
      } else {
        figure.shownLat = figure.targetLat;
        figure.shownLon = figure.targetLon;
      }
      const pose = poseFor({ lat: figure.shownLat, lon: figure.shownLon }, figure.headingDeg, 0);
      figure.group.position.copy(pose.pos);
      figure.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pose.up);

      // Fades.
      if (!motion.reduced) {
        if (figure.fade === "in") {
          const t = clamp((now - figure.fadeStartedAt) / FADE_MS, 0, 1);
          setFigureOpacity(figure.group, t);
          if (t >= 1) figure.fade = "shown";
        } else if (figure.fade === "out") {
          const t = clamp((now - figure.fadeStartedAt) / FADE_MS, 0, 1);
          setFigureOpacity(figure.group, 1 - t);
          if (t >= 1) {
            world.scene.remove(figure.group);
            figures.delete(id);
          }
        } else {
          setFigureOpacity(figure.group, 1);
        }
      } else {
        figure.fade = "shown";
        setFigureOpacity(figure.group, 1);
      }
    }
    void dt;

    // The visually hidden list of drawn figures.
    figureList.replaceChildren(
      ...[...figures.values()].map((figure) => {
        const li = h("li", { class: "figure-list-item" }, figure.tag);
        li.setAttribute("data-shown-lat", figure.shownLat.toFixed(2));
        li.setAttribute("data-shown-lon", figure.shownLon.toFixed(2));
        li.setAttribute("data-fade", motion.reduced ? "shown" : figure.fade);
        li.setAttribute("data-emote", figure.emote ?? "");
        return li;
      }),
    );
  }

  // --- board refresh and presence cycles ---------------------------------------------------
  setInterval(() => {
    if (!pageVisible) return;
    void refreshDepot();
  }, 10_000);
  setInterval(() => {
    if (!pageVisible) return;
    void heartbeat();
    void readPresence();
    if (photoModeOpen) void checkDarkroom();
  }, 1000);
  setInterval(() => {
    if (!moderation?.isOpen || !pageVisible) return;
    void refreshModeration();
  }, 5000);

  // --- visibility (DP-56) ---------------------------------------------------------------
  const onVisibility = (): void => {
    pageVisible = !document.hidden;
    if (pageVisible) {
      // Within a tenth of a second the timed sequences have caught up (the frame loop uses
      // the same clock); a lapsed hold is applied at once, then both stores are read.
      if (openParcel?.rush_id && openParcel.hold_expires_at && holdLapsed(openParcel.hold_expires_at)) {
        maybeApplyLapse();
      }
      void refreshDepot();
      void heartbeat();
      void readPresence();
      if (photoModeOpen) void checkDarkroom();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  disposers.push(() => document.removeEventListener("visibilitychange", onVisibility));

  // --- reduced motion changing live (DP-75) ----------------------------------------------
  const syncReducedBody = (): void => {
    document.body.setAttribute("data-reduced", motion.reduced ? "true" : "false");
  };
  syncReducedBody();

  const onMotionChange = (reduced: boolean): void => {
    syncReducedBody();
    if (reduced) {
      if (introState === "playing") skipIntro();
      cloudFrozenAt = cloudDeg;
      if (rig) {
        rig.settled = true;
        rig.mode = thread.phase === "pullback" || thread.phase === "unspool" || thread.phase === "return" ? "over-shoulder" : rig.mode;
      }
      if (thread.phase === "pullback" || thread.phase === "unspool" || thread.phase === "return") {
        thread.phase = "walking";
        thread.phaseStartedAt = performance.now();
      }
      for (const figure of figures.values()) {
        figure.shownLat = figure.targetLat;
        figure.shownLon = figure.targetLon;
        figure.fade = "shown";
        figure.glideDurationMs = 0;
      }
    } else {
      cloudFrozenAt = null;
    }
  };
  motion.onChange(onMotionChange);

  function shapeNameClient(name: string): string | null {
    const folded = name.replace(/[\s\u0080-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, " ").trim().normalize("NFC");
    if ([...folded].length === 0 || [...folded].length > 24) return null;
    return folded;
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- responsive tabs at 375 wide ---------------------------------------------------------
  function syncTabs(): void {
    const narrow = window.innerWidth <= 480;
    cards.tabsBar.classList.toggle("is-visible", narrow);
    if (narrow && cards.tabsBar.children.length === 0) {
      for (const [key, label] of [["postbox", "Postbox"], ["depot", "Depot board"], ["satchel", "Satchel"]] as const) {
        const btn = h("button", { class: "btn btn-tab", "data-tab": key, "aria-expanded": "false" }, label);
        btn.addEventListener("click", () => {
          const target = cards.openTab === null ? key : cards.openTab === (key as never) ? null : key;
          cards.setOpenTab(target as "postbox" | "depot" | "satchel" | null);
          for (const other of cards.tabsBar.querySelectorAll("button")) {
            other.setAttribute("aria-expanded", String(other === btn && target !== null));
          }
        });
        cards.tabsBar.append(btn);
      }
    }
  }
  syncTabs();
  const onResize = (): void => syncTabs();
  window.addEventListener("resize", onResize);
  disposers.push(() => window.removeEventListener("resize", onResize));

  return {
    dispose() {
      for (const dispose of disposers) dispose();
    },
  };
}
