import { arcMetres, compassLabel, initialBearingDeg, travel, type LatLon } from '../../shared/geo.js';
import { toUnitVector } from '../../shared/geo.js';
import { el, oneDecimal, twoDecimals, whole } from '../shared/dom.js';
import { AmbientClock, Tween, ease, motion, onFrame, page, upToTenth } from '../shared/motion.js';
import { css, palette } from './palette.js';
import { CourierFigures, type PresenceEntry } from './figures.js';
import { Renderer, type Figure } from './world/renderer.js';
import {
  FOLLOW_FOV_DEG,
  PHOTO_START_FOV_DEG,
  altitudeAbove,
  clearPose,
  followPose,
  introStartPose,
  mixPose,
  orbitPose,
  photoPose,
  type CameraKind,
  type CameraPose,
} from './world/cameras.js';
import { hiddenByPlanet, length as vecLength, project, scale as vecScale, sub } from './world/glmath.js';

export type ThreadPhase =
  | 'idle'
  | 'pullback'
  | 'unspool'
  | 'return'
  | 'walking'
  | 'arrived'
  | 'handing'
  | 'delivered'
  | 'rewind';

export interface WorldInfo {
  radius_m: number;
  depot: LatLon;
  residents: Array<{ resident_id: string; name: string; home: string; door: LatLon }>;
}

export interface OpenRoute {
  routeId: string;
  door: LatLon;
  totalArcM: number;
  home: string;
  carrying: 'standard' | 'rush';
}

const INTRO_MS = 1450;
const PULLBACK_MS = 450;
const UNSPOOL_MS = 620;
const RETURN_MS = 350;
const DELIVERED_FADE_MS = 250;
const REWIND_MS = 320;
const PHOTO_EASE_MS = 220;
const FOLLOW_SETTLE_MS = 400;
const WALK_SPEED_MPS = 4;
const TURN_RATE_DPS = 120;
const TURN_RAMP_MS = 200;
const JUMP_MS = 700;
const JUMP_HEIGHT_M = 0.4;
const ARRIVED_ARC_M = 4;
const CLOUD_ORBIT_SECONDS = 90;

export interface SceneHooks {
  onPhase: (phase: ThreadPhase) => void;
  onArrived: (home: string) => void;
}

export class Scene {
  readonly region: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly couriersList: HTMLElement;
  readonly routeStatus: HTMLElement;
  readonly compass: HTMLElement;
  readonly metresNumeral: HTMLElement;

  private readonly renderer: Renderer;
  private readonly figures: CourierFigures;
  private readonly ambient = new AmbientClock();
  private readonly hooks: SceneHooks;

  private position: LatLon;
  private headingDeg = 0;
  private turnRamp = 0;
  private turnSign = 0;
  private walkSign = 0;
  private jump = new Tween();
  private jumping = false;

  private cameraKind: CameraKind = 'intro';
  private pose: CameraPose;
  private blendFrom: CameraPose | null = null;
  private readonly blend = new Tween();
  private readonly introTween = new Tween();
  private readonly settleTween = new Tween();
  private settled = true;
  private introState: 'playing' | 'done' | 'skipped' | 'off' = 'off';
  private orbit: CameraPose | null = null;
  private pullbackFrom: CameraPose | null = null;
  private settleFrom: CameraPose | null = null;
  private photoMode = false;

  private photoYawDeg = 0;
  private photoFovDeg = PHOTO_START_FOV_DEG;

  private route: OpenRoute | null = null;
  private phase: ThreadPhase = 'idle';
  private threadStartedAt: number | null = null;
  private deliveredAt: number | null = null;
  private readonly rewindTween = new Tween();
  private rewindFrom = 0;
  private ribbonVisible = 0;
  private notch: 'idle' | 'bearing' | 'stamp' = 'idle';
  private selfEmote: string | null = null;
  private selfEmoteUntil = 0;
  private lastDoorScreen = '';
  private lastViewProjection: Float32Array | null = null;
  private lastWidth = 1280;
  private lastHeight = 800;
  private lastRouteText = '';
  private routeTextAt = 0;
  private announcedArrival = false;

  constructor(
    private readonly world: WorldInfo,
    hooks: SceneHooks,
  ) {
    this.hooks = hooks;
    this.position = { ...world.depot };
    this.canvas = el('canvas', { class: 'bramble-canvas' });
    this.region = el(
      'div',
      {
        role: 'region',
        'aria-label': 'Bramble',
        tabindex: '0',
        class: 'bramble-region',
        'data-scene': 'loading',
        'data-camera': 'intro',
      },
      [this.canvas],
    );
    this.couriersList = el('ul', {
      role: 'list',
      'aria-label': 'Couriers nearby',
      class: 'visually-hidden',
    });
    this.routeStatus = el('div', {
      role: 'status',
      'aria-label': 'Route',
      'aria-live': 'polite',
      class: 'route-status',
      'data-route-id': '',
      'data-arc-remaining-m': '0.0',
      'data-bearing-deg': '0',
      'data-ribbon-fraction': '0.00',
      'data-ribbon-visible': '0.00',
      'data-thread-phase': 'idle',
      'data-door-screen': '',
    });
    this.compass = el('div', {
      role: 'img',
      'aria-label': 'Horizon compass',
      class: 'compass-ring',
      'data-ring-deg': '0',
      'data-notch': 'idle',
    });
    this.metresNumeral = el('span', { class: 'metres-numeral', 'aria-hidden': 'true' });
    this.renderer = new Renderer(this.canvas);
    this.pose = followPose(this.stance());
    this.figures = new CourierFigures(this.couriersList, world.radius_m);
    this.drawCompassFace();
  }

  /** The courier's stance on the sphere: where they stand and which way they face. */
  private stance(): { unit: [number, number, number]; headingDeg: number; radiusM: number } {
    return {
      unit: toUnitVector(this.position),
      headingDeg: this.headingDeg,
      radiusM: this.world.radius_m,
    };
  }

  begin(): void {
    if (!this.renderer.available) {
      this.region.setAttribute('data-scene', 'no-webgl');
      this.region.setAttribute('data-intro', 'off');
      this.region.setAttribute('data-ambient', 'off');
      this.region.setAttribute('data-camera', 'over-shoulder');
      this.region.append(
        el('p', { class: 'no-webgl' }, ['Bramble needs WebGL to draw the planet.']),
      );
      onFrame(() => this.writeAttributes(null, 0, 0));
      return;
    }
    this.renderer.start(
      this.world.radius_m,
      this.world.residents.map((resident) => toUnitVector(resident.door)),
      toUnitVector(this.world.depot),
    );
    if (motion.reduced) {
      this.introState = 'off';
      this.cameraKind = 'over-shoulder';
    } else {
      this.introState = 'playing';
      this.cameraKind = 'intro';
      this.introTween.start(INTRO_MS);
    }
    this.pose = this.wantedPose(performance.now());
    this.region.setAttribute('data-scene', 'ready');
    this.region.setAttribute('data-intro', this.introState);
    this.region.setAttribute('data-camera', this.cameraKind);
    motion.subscribe(() => this.followPreference());
    let previous = performance.now();
    onFrame((now) => {
      const step = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      this.advance(step, now);
    });
  }

  /** The reduced-motion preference applies at once, in either direction. */
  private followPreference(): void {
    if (motion.reduced) {
      if (this.introState === 'playing') {
        this.introState = 'skipped';
        this.introTween.stop();
        this.cameraKind = 'over-shoulder';
      }
      if (this.phase === 'pullback' || this.phase === 'unspool' || this.phase === 'return') {
        this.threadStartedAt = null;
        this.orbit = null;
        this.pullbackFrom = null;
        this.ribbonVisible = 1;
        this.setPhase(this.arcRemaining() <= ARRIVED_ARC_M ? 'arrived' : 'walking');
      }
      this.blend.stop();
      this.blendFrom = null;
      this.settleTween.stop();
      this.settled = true;
    }
  }

  skipIntro(): void {
    if (this.introState !== 'playing') return;
    this.introState = 'skipped';
    this.introTween.stop();
    this.cameraKind = 'over-shoulder';
    this.settled = true;
  }

  get introPlaying(): boolean {
    return this.introState === 'playing';
  }

  get threadPhase(): ThreadPhase {
    return this.phase;
  }

  get carrying(): 'none' | 'standard' | 'rush' {
    if (this.route === null || this.phase === 'delivered') return 'none';
    return this.route.carrying;
  }

  get here(): LatLon {
    return { ...this.position };
  }

  get satchelColour(): string {
    return this.wornColour;
  }

  private wornColour = 'canvas';

  wear(colour: string): void {
    this.wornColour = colour;
  }

  showEmote(emote: string): void {
    this.selfEmote = emote;
    this.selfEmoteUntil = performance.now() + 4000;
  }

  clearEmote(): void {
    this.selfEmote = null;
  }

  presence(entries: PresenceEntry[], first: boolean): void {
    this.figures.read(entries, first);
  }

  // --- the horizon thread ---

  /** Opens a parcel's route. Only a confirmed answer starts the thread. */
  openRoute(route: OpenRoute, options: { animate: boolean }): void {
    this.route = route;
    this.notch = 'bearing';
    this.announcedArrival = false;
    this.deliveredAt = null;
    this.rewindTween.stop();
    if (options.animate && !motion.reduced) {
      this.threadStartedAt = performance.now();
      this.orbit = null;
      this.pullbackFrom = this.pose;
      this.setPhase('pullback');
    } else {
      this.threadStartedAt = null;
      this.ribbonVisible = 1;
      this.setPhase(this.arcRemaining() <= ARRIVED_ARC_M ? 'arrived' : 'walking');
    }
  }

  markHanding(): void {
    if (this.route !== null) this.setPhase('handing');
  }

  /** A refused hand-over puts the thread back where the live arc says it belongs. */
  markArrivedAgain(): void {
    if (this.route === null) return;
    this.setPhase(this.arcRemaining() <= ARRIVED_ARC_M ? 'arrived' : 'walking');
  }

  markDelivered(): void {
    if (this.route === null) return;
    this.deliveredAt = performance.now();
    this.notch = 'stamp';
    this.setPhase('delivered');
  }

  /** A drop or a lapsed hold rewinds the ribbon toward the door from where it is. */
  rewind(): void {
    if (this.route === null) {
      this.setPhase('idle');
      return;
    }
    this.rewindFrom = this.ribbonVisible;
    if (this.threadStartedAt !== null) this.retarget(350);
    this.threadStartedAt = null;
    this.orbit = null;
    this.pullbackFrom = null;
    if (motion.reduced) {
      this.ribbonVisible = 0;
      this.route = null;
      this.notch = 'idle';
      this.setPhase('idle');
      return;
    }
    this.rewindTween.start(REWIND_MS);
    this.setPhase('rewind');
  }

  closeRoute(): void {
    this.route = null;
    this.ribbonVisible = 0;
    this.setPhase('idle');
  }

  private setPhase(phase: ThreadPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.hooks.onPhase(phase);
  }

  arcRemaining(): number {
    if (this.route === null) return 0;
    return arcMetres(this.position, this.route.door, this.world.radius_m);
  }

  bearingToDoor(): number {
    if (this.route === null) return 0;
    return initialBearingDeg(this.position, this.route.door);
  }

  ribbonFraction(): number {
    if (this.route === null) return 0;
    const raw = Math.min(1, this.arcRemaining() / Math.max(0.001, this.route.totalArcM));
    return motion.reduced ? upToTenth(raw) : raw;
  }

  // --- walking ---

  setWalk(sign: number): void {
    this.walkSign = sign;
  }

  setTurn(sign: number): void {
    this.turnSign = sign;
  }

  hop(): void {
    if (this.jumping || this.introPlaying) return;
    this.jumping = true;
    this.jump.start(JUMP_MS);
  }

  private moveCourier(step: number): void {
    if (this.introPlaying) return;
    const wantedRamp = this.turnSign === 0 ? 0 : 1;
    if (motion.reduced) {
      this.turnRamp = wantedRamp;
    } else {
      const rate = step / (TURN_RAMP_MS / 1000);
      this.turnRamp += Math.sign(wantedRamp - this.turnRamp) * Math.min(rate, Math.abs(wantedRamp - this.turnRamp));
    }
    if (this.turnRamp > 0.001) {
      const direction = this.turnSign !== 0 ? this.turnSign : this.lastTurnSign;
      this.headingDeg = (this.headingDeg + direction * TURN_RATE_DPS * this.turnRamp * step + 360) % 360;
    }
    if (this.turnSign !== 0) this.lastTurnSign = this.turnSign;
    if (this.walkSign !== 0) {
      this.position = travel(
        this.position,
        this.walkSign > 0 ? this.headingDeg : (this.headingDeg + 180) % 360,
        WALK_SPEED_MPS * Math.abs(this.walkSign) * step,
        this.world.radius_m,
      );
    }
  }

  private lastTurnSign = 1;

  private get moving(): boolean {
    return this.walkSign !== 0 || this.turnSign !== 0 || this.turnRamp > 0.001;
  }

  // --- photo mode ---

  enterPhotoMode(): void {
    this.photoYawDeg = 0;
    this.photoFovDeg = PHOTO_START_FOV_DEG;
    this.photoMode = true;
    this.retarget(350);
  }

  leavePhotoMode(): void {
    this.photoMode = false;
    this.settled = true;
    this.retarget(350);
  }

  get photoYaw(): number {
    return this.photoYawDeg;
  }

  get photoFov(): number {
    return this.photoFovDeg;
  }

  turnPhoto(deltaDeg: number): void {
    this.photoYawDeg = (((this.photoYawDeg + deltaDeg) % 360) + 360) % 360;
    this.retarget(PHOTO_EASE_MS);
  }

  zoomPhoto(deltaDeg: number): void {
    this.photoFovDeg = Math.max(30, Math.min(70, this.photoFovDeg + deltaDeg));
    this.retarget(PHOTO_EASE_MS);
  }

  setPhotoFov(fovDeg: number): void {
    this.photoFovDeg = Math.max(30, Math.min(70, Math.round(fovDeg)));
    this.retarget(PHOTO_EASE_MS);
  }

  /** Eases from wherever the camera is now, so a step never jumps back to an old target. */
  private retarget(durationMs: number): void {
    if (motion.reduced) {
      this.blend.stop();
      this.blendFrom = null;
      return;
    }
    this.blendFrom = this.pose;
    this.blend.start(durationMs);
  }

  /** Captures the photo-camera view as a postcard, stamp edge and postmark drawn in. */
  async capture(): Promise<Blob> {
    this.renderer.setFixedSize({ width: 1200, height: 800 });
    this.drawFrame(performance.now());
    this.renderer.setFixedSize(null);
    const sheet = document.createElement('canvas');
    sheet.width = 1200;
    sheet.height = 800;
    const context = sheet.getContext('2d')!;
    context.drawImage(this.canvas, 0, 0, 1200, 800);
    this.drawStampEdge(context, 1200, 800);
    return new Promise((resolve, reject) => {
      sheet.toBlob((blob) => {
        if (blob === null) reject(new Error('no postcard'));
        else resolve(blob);
      }, 'image/png');
    });
  }

  private drawStampEdge(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.save();
    context.fillStyle = css(palette.paper);
    const bite = 16;
    for (let x = bite; x < width; x += bite * 2) {
      context.beginPath();
      context.arc(x, 0, bite * 0.6, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(x, height, bite * 0.6, 0, Math.PI * 2);
      context.fill();
    }
    for (let y = bite; y < height; y += bite * 2) {
      context.beginPath();
      context.arc(0, y, bite * 0.6, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(width, y, bite * 0.6, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = css(palette.ink);
    context.lineWidth = 4;
    context.beginPath();
    context.arc(width - 150, height - 120, 78, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = css(palette.ink);
    context.textAlign = 'center';
    context.font = '600 30px "Fraunces", Georgia, serif';
    context.fillText('Bramble', width - 150, height - 128);
    context.font = '400 20px "Atkinson Hyperlegible", sans-serif';
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    context.fillText(stamp, width - 150, height - 98);
    context.restore();
  }

  // --- the frame ---

  private advance(step: number, now: number): void {
    this.moveCourier(step);
    if (this.jumping && !this.jump.active) this.jumping = false;
    if (this.selfEmote !== null && now > this.selfEmoteUntil) this.selfEmote = null;
    this.advanceThread(now);
    const drawn = this.drawFrame(now);
    this.figures.advance();
    this.writeAttributes(drawn.viewProjection, drawn.width, drawn.height);
  }

  private advanceThread(now: number): void {
    if (this.threadStartedAt !== null) {
      const elapsed = now - this.threadStartedAt;
      if (elapsed < PULLBACK_MS) {
        this.setPhase('pullback');
        this.ribbonVisible = 0;
      } else if (elapsed < PULLBACK_MS + UNSPOOL_MS) {
        this.setPhase('unspool');
        this.ribbonVisible = (elapsed - PULLBACK_MS) / UNSPOOL_MS;
      } else if (elapsed < PULLBACK_MS + UNSPOOL_MS + RETURN_MS) {
        this.setPhase('return');
        this.ribbonVisible = 1;
      } else {
        this.threadStartedAt = null;
        this.orbit = null;
        this.pullbackFrom = null;
        this.ribbonVisible = this.ribbonFraction();
        this.settled = true;
        this.setPhase(this.arcRemaining() <= ARRIVED_ARC_M ? 'arrived' : 'walking');
      }
      return;
    }
    if (this.phase === 'rewind') {
      const progress = this.rewindTween.progress(now);
      this.ribbonVisible = this.rewindFrom * (1 - ease(progress));
      if (!this.rewindTween.active) {
        this.ribbonVisible = 0;
        this.route = null;
        this.notch = 'idle';
        this.setPhase('idle');
      }
      return;
    }
    if (this.phase === 'delivered' || this.phase === 'handing' || this.phase === 'idle') {
      if (this.phase !== 'idle' && this.route !== null) {
        this.ribbonVisible = this.phase === 'delivered' ? this.ribbonVisible : this.ribbonFraction();
      }
      return;
    }
    if (this.route === null) {
      this.ribbonVisible = 0;
      return;
    }
    this.ribbonVisible = this.ribbonFraction();
    const arc = this.arcRemaining();
    if (arc <= ARRIVED_ARC_M) {
      if (this.phase !== 'arrived') this.setPhase('arrived');
    } else if (this.phase === 'arrived') {
      this.setPhase('walking');
      this.announcedArrival = false;
    }
  }

  /** Which rig the camera is on right now. */
  private currentKind(): CameraKind {
    if (this.photoMode) return 'photo';
    if (this.phase === 'pullback' || this.phase === 'unspool' || this.phase === 'return') {
      return 'orbit';
    }
    if (this.introState === 'playing') return 'intro';
    return 'over-shoulder';
  }

  private orbitPoseNow(): CameraPose {
    if (this.orbit === null && this.route !== null) {
      this.orbit = orbitPose(
        toUnitVector(this.position),
        toUnitVector(this.route.door),
        this.world.radius_m,
        { width: this.canvas.clientWidth || 1280, height: this.canvas.clientHeight || 800 },
      );
    }
    return this.orbit ?? followPose(this.stance());
  }

  /** The pose the current rig asks for, driven by elapsed time so a hidden page resumes in phase. */
  private wantedPose(now: number): CameraPose {
    const stance = this.stance();
    const kind = this.currentKind();
    if (kind === 'photo') return photoPose(stance, this.photoYawDeg, this.photoFovDeg);
    if (kind === 'orbit' && this.threadStartedAt !== null) {
      const elapsed = now - this.threadStartedAt;
      const orbitHere = this.orbitPoseNow();
      if (elapsed < PULLBACK_MS) {
        return mixPose(this.pullbackFrom ?? this.pose, orbitHere, ease(elapsed / PULLBACK_MS));
      }
      if (elapsed < PULLBACK_MS + UNSPOOL_MS) return orbitHere;
      const amount = (elapsed - PULLBACK_MS - UNSPOOL_MS) / RETURN_MS;
      return mixPose(orbitHere, followPose(stance), ease(Math.min(1, amount)));
    }
    if (kind === 'intro') {
      const progress = ease(this.introTween.progress(now));
      if (!this.introTween.active) {
        this.introState = 'done';
        return followPose(stance);
      }
      return mixPose(introStartPose(stance), followPose(stance), progress);
    }
    return followPose(stance);
  }

  private drawFrame(now: number): { viewProjection: Float32Array; width: number; height: number } {
    const kind = this.currentKind();
    this.cameraKind = kind;
    const wanted = this.wantedPose(now);

    if (kind === 'orbit' || kind === 'intro') {
      this.pose = wanted;
      this.settled = false;
      this.settleFrom = null;
    } else if (this.blend.active && this.blendFrom !== null) {
      this.pose = mixPose(this.blendFrom, wanted, ease(this.blend.progress(now)));
      this.settled = false;
    } else if (motion.reduced || kind === 'photo') {
      this.pose = wanted;
      this.settled = true;
      this.settleFrom = null;
    } else if (this.moving) {
      this.pose = mixPose(this.pose, wanted, 0.2);
      this.settled = false;
      this.settleTween.stop();
      this.settleFrom = null;
    } else if (!this.settled) {
      if (this.settleFrom === null) {
        this.settleFrom = this.pose;
        this.settleTween.start(FOLLOW_SETTLE_MS, now);
      }
      this.pose = mixPose(this.settleFrom, wanted, ease(this.settleTween.progress(now)));
      if (!this.settleTween.active) {
        this.pose = wanted;
        this.settled = true;
        this.settleFrom = null;
      }
    } else {
      this.pose = wanted;
    }
    this.pose = clearPose(this.pose, this.world.radius_m, this.renderer.obstacles());

    const jumpLift = this.jumping ? Math.sin(this.jump.progress(now) * Math.PI) * JUMP_HEIGHT_M : 0;
    const self: Figure = {
      unit: vecScale(toUnitVector(this.position), 1 + jumpLift / this.world.radius_m),
      headingDeg: this.headingDeg,
      satchelColour: this.wornColour,
      tag: null,
      emote: this.selfEmote,
      alpha: 1,
      carrying: this.carrying,
    };
    const ribbon =
      this.route !== null && this.ribbonVisible > 0.001
        ? {
            tail: toUnitVector(this.position),
            head: toUnitVector(this.route.door),
            from: this.phase === 'rewind' ? 1 - this.ribbonVisible : 0,
            to: this.phase === 'unspool' ? this.ribbonVisible : 1,
            alpha: this.deliveredFade(now),
          }
        : null;
    const ambientSeconds = this.ambient.advance(now);
    return this.renderer.draw({
      camera: this.pose,
      self,
      others: this.figures.drawn.map((figure) => ({
        unit: toUnitVector(figure.shown),
        headingDeg: figure.headingDeg,
        satchelColour: figure.satchelColour,
        tag: figure.name,
        emote: figure.emote,
        alpha: figure.alpha,
        carrying: 'none' as const,
      })),
      ribbon,
      cloudDeg: (ambientSeconds / CLOUD_ORBIT_SECONDS) * 360,
      scrapSeconds: ambientSeconds,
    });
  }

  private deliveredFade(now: number): number {
    if (this.phase !== 'delivered' || this.deliveredAt === null) return 1;
    return Math.max(0, 1 - (now - this.deliveredAt) / DELIVERED_FADE_MS);
  }

  private writeAttributes(
    viewProjection: Float32Array | null,
    width: number,
    height: number,
  ): void {
    const feet = vecScale(toUnitVector(this.position), this.world.radius_m);
    const distance = vecLength(sub(this.pose.eye, feet));
    const region = this.region;
    region.setAttribute('data-camera', this.cameraKind);
    region.setAttribute('data-camera-dist-m', oneDecimal(distance));
    region.setAttribute(
      'data-camera-fov',
      whole(this.cameraKind === 'photo' ? this.photoFovDeg : this.pose.fovDeg),
    );
    region.setAttribute(
      'data-camera-alt-m',
      oneDecimal(altitudeAbove(this.pose.eye, this.world.radius_m, this.renderer.obstacles())),
    );
    region.setAttribute('data-camera-settled', this.settled ? 'true' : 'false');
    region.setAttribute(
      'data-photo-yaw-deg',
      this.cameraKind === 'photo' ? whole(this.photoYawDeg) : '',
    );
    region.setAttribute('data-lat', this.position.lat.toFixed(2));
    region.setAttribute('data-lon', this.position.lon.toFixed(2));
    region.setAttribute('data-grounded', this.jumping ? 'false' : 'true');
    region.setAttribute('data-heading-deg', whole(this.headingDeg % 360));
    region.setAttribute('data-courier-tilt-deg', '0.0');
    region.setAttribute('data-carrying', this.carrying);
    const still = !this.renderer.available || motion.reduced;
    region.setAttribute('data-intro', this.renderer.available ? this.introState : 'off');
    region.setAttribute(
      'data-ambient',
      still ? 'off' : page.visible ? 'running' : 'paused',
    );
    region.setAttribute('data-cloud-deg', whole(((this.ambient.seconds / CLOUD_ORBIT_SECONDS) * 360) % 360));

    if (viewProjection !== null) {
      this.lastViewProjection = viewProjection;
      this.lastWidth = width;
      this.lastHeight = height;
      const courierScreen = project(viewProjection, feet, width, height);
      region.setAttribute(
        'data-courier-screen',
        courierScreen.onScreen ? `${courierScreen.x},${courierScreen.y}` : '',
      );
      if (this.route !== null) {
        const doorPoint = vecScale(toUnitVector(this.route.door), this.world.radius_m + 0.18);
        const doorScreen = project(viewProjection, doorPoint, width, height);
        const hidden = hiddenByPlanet(this.pose.eye, doorPoint);
        this.lastDoorScreen =
          doorScreen.onScreen && !hidden ? `${doorScreen.x},${doorScreen.y}` : '';
      } else {
        this.lastDoorScreen = '';
      }
    }

    const status = this.routeStatus;
    status.setAttribute('data-thread-phase', this.phase);
    status.setAttribute('data-door-screen', this.lastDoorScreen);
    if (this.route === null) {
      status.setAttribute('data-route-id', '');
      status.setAttribute('data-arc-remaining-m', '0.0');
      status.setAttribute('data-bearing-deg', '0');
      status.setAttribute('data-ribbon-fraction', '0.00');
      status.setAttribute('data-ribbon-visible', '0.00');
      status.textContent = '';
      this.metresNumeral.textContent = '';
    } else {
      const arc = this.phase === 'delivered' ? 0 : this.arcRemaining();
      const fraction = this.phase === 'delivered' ? 0 : this.ribbonFraction();
      const bearing = this.bearingToDoor();
      status.setAttribute('data-route-id', this.route.routeId);
      status.setAttribute('data-arc-remaining-m', oneDecimal(arc));
      status.setAttribute('data-bearing-deg', whole(bearing));
      status.setAttribute('data-ribbon-fraction', twoDecimals(fraction));
      status.setAttribute('data-ribbon-visible', twoDecimals(this.ribbonVisible));
      this.metresNumeral.textContent = `${whole(arc)} m`;
      const now = performance.now();
      if (this.phase === 'arrived' && !this.announcedArrival) {
        this.announcedArrival = true;
        status.textContent = `Arrived at ${this.route.home}.`;
        this.lastRouteText = status.textContent;
        this.routeTextAt = now;
      } else if (this.phase !== 'arrived' && now - this.routeTextAt >= 1000) {
        const text = `Bearing ${compassLabel(bearing)} ${whole(bearing)}°, ${whole(arc)} m`;
        if (text !== this.lastRouteText) {
          status.textContent = text;
          this.lastRouteText = text;
        }
        this.routeTextAt = now;
      }
    }
    status.classList.toggle('readout-visible', motion.reduced);
    this.metresNumeral.hidden = motion.reduced;

    this.compass.setAttribute(
      'data-ring-deg',
      motion.reduced ? '0' : whole(this.route === null ? 0 : this.bearingToDoor()),
    );
    this.compass.setAttribute('data-notch', this.notch);
    this.compass.style.setProperty(
      '--ring-rotation',
      `${motion.reduced ? 0 : this.route === null ? 0 : -this.bearingToDoor()}deg`,
    );
    this.compass.setAttribute(
      'aria-label',
      'Horizon compass',
    );
    this.compassNotch?.setAttribute('data-notch-shape', this.notch);
  }

  /** The resident's door on screen, clamped to the viewport edge, for a letter to unfold from. */
  doorScreen(residentId: string): { x: number; y: number } {
    const resident = this.world.residents.find((each) => each.resident_id === residentId);
    if (resident === undefined || this.lastViewProjection === null) {
      return { x: Math.round(this.lastWidth / 2), y: Math.round(this.lastHeight / 2) };
    }
    const point = vecScale(toUnitVector(resident.door), this.world.radius_m + 0.5);
    const screen = project(this.lastViewProjection, point, this.lastWidth, this.lastHeight);
    return {
      x: Math.max(0, Math.min(this.lastWidth, screen.x)),
      y: Math.max(0, Math.min(this.lastHeight, screen.y)),
    };
  }

  private compassNotch: SVGElement | null = null;

  /** A thin ink ring with N, E, S and W and ticks every fifteen degrees. */
  private drawCompassFace(): void {
    const face = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    face.setAttribute('viewBox', '0 0 240 60');
    face.setAttribute('class', 'compass-face');
    face.setAttribute('aria-hidden', 'true');
    const dial = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    dial.setAttribute('class', 'compass-dial');
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const x = 120 + Math.sin((degrees * Math.PI) / 180) * 104;
      const major = degrees % 90 === 0;
      tick.setAttribute('x1', String(x));
      tick.setAttribute('y1', major ? '18' : '24');
      tick.setAttribute('x2', String(x));
      tick.setAttribute('y2', '34');
      tick.setAttribute('stroke', css(palette.ink));
      tick.setAttribute('stroke-width', major ? '2' : '1');
      dial.append(tick);
      if (major) {
        const letter = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        letter.setAttribute('x', String(x));
        letter.setAttribute('y', '50');
        letter.setAttribute('text-anchor', 'middle');
        letter.setAttribute('class', 'compass-letter');
        letter.textContent = ['N', 'E', 'S', 'W'][degrees / 90]!;
        dial.append(letter);
      }
    }
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ring.setAttribute('x1', '8');
    ring.setAttribute('y1', '34');
    ring.setAttribute('x2', '232');
    ring.setAttribute('y2', '34');
    ring.setAttribute('stroke', css(palette.ink));
    ring.setAttribute('stroke-width', '1.5');
    const notch = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    notch.setAttribute('class', 'compass-notch');
    notch.setAttribute('data-notch-shape', 'idle');
    const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    triangle.setAttribute('d', 'M112 4 L128 4 L120 18 Z');
    triangle.setAttribute('class', 'notch-triangle');
    const stamp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    stamp.setAttribute('class', 'notch-stamp');
    const plate = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    plate.setAttribute('x', '109');
    plate.setAttribute('y', '2');
    plate.setAttribute('width', '22');
    plate.setAttribute('height', '18');
    plate.setAttribute('rx', '2');
    plate.setAttribute('fill', css(palette.pink));
    const star = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    star.setAttribute(
      'd',
      'M120 5 L122.4 10 L127.6 10.6 L123.6 14 L124.8 19 L120 16.4 L115.2 19 L116.4 14 L112.4 10.6 L117.6 10 Z',
    );
    star.setAttribute('fill', css(palette.ink));
    stamp.append(plate, star);
    notch.append(triangle, stamp);
    face.append(ring, dial, notch);
    this.compass.append(face);
    this.compassNotch = notch;
  }
}
