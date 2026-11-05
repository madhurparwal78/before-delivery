import { api, copy, escapeHtml, announce, wireCore, locale } from './app-core.js';
import {
  AZIMUTH_STEP, AZIMUTH_MAX, TILT_STEP, TILT_MIN, TILT_MAX, DISTANCE_STEP, DISTANCE_MIN, DISTANCE_MAX,
  FOV_STEP, FOV_MIN, FOV_MAX, FP_HEADING_STEP, FP_PITCH_MIN, FP_PITCH_MAX, FP_EYE_HEIGHT_MM,
  stepTo, wrapAzimuth, facingAzimuth, cameraPosition, projectHotspot, ringIndexMarkCentre, reducedMotion,
  type Camera, type Hotspot, type Vec3,
} from './viewer-geometry.js';

interface GlbMesh {
  positions: Float32Array;
  indices: Uint32Array;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

class SurveyViewer {
  private root: HTMLElement;
  private stage: HTMLElement;
  private fallbackImage: HTMLImageElement;
  private gl: WebGLRenderingContext | null = null;
  private mesh: GlbMesh | null = null;

  private radius: number;
  private scaleDenominator: number;
  private camera: Camera;
  private savedCamera: Camera | null = null;
  private firstPerson = false;
  private heading = 0;
  private pitch = 0;
  private eyeHeight = 0;
  private hotspots: Hotspot[] = [];
  private activeHotspot = 0;
  private canvas: HTMLCanvasElement | null = null;
  private tweenHandle = 0;
  private locked = false;
  private tweenFrom: Camera | null = null;
  private tweenTo: Camera | null = null;
  private tweenStart = 0;
  private tweenDuration = 180;

  constructor(root: HTMLElement) {
    this.root = root;
    this.stage = root.querySelector<HTMLElement>('.viewer-stage') ?? root;
    this.fallbackImage = root.querySelector<HTMLImageElement>('.viewer-fallback') ?? document.createElement('img');
    this.radius = Number(root.dataset['radius'] ?? 50);
    this.scaleDenominator = Number(root.dataset['scaleDenominator'] ?? 1);
    this.camera = {
      azimuth: Number(root.dataset['azimuth'] ?? 30),
      tilt: Number(root.dataset['tilt'] ?? 20),
      distanceFactor: Number(root.dataset['distanceFactor'] ?? 2.4),
      fov: Number(root.dataset['fov'] ?? 35),
    };
    this.eyeHeight = FP_EYE_HEIGHT_MM / this.scaleDenominator;
  }

  async init(): Promise<void> {
    const rebuilding = this.root.dataset['rebuilding'] === 'true';
    if (rebuilding) {
      this.root.dataset['render'] = 'preview';
      this.fallbackImage.hidden = false;
      this.locked = true;
      return;
    }
    await this.tryWebgl();
    if (this.root.dataset['render'] === 'preview') {
      this.locked = true;
      return;
    }
    this.wireKeys();
    this.wireDrag();
    this.wireButtons();
    this.applyCamera();
    window.addEventListener('resize', () => this.draw());
  }

  private async tryWebgl(): Promise<void> {
    try {
      const response = await fetch(this.root.dataset['modelUrl'] ?? '');
      if (!response.ok) throw new Error('model fetch failed');
      const data = new Uint8Array(await response.arrayBuffer());
      this.mesh = parseGlb(data);
      if (this.mesh === null) throw new Error('no mesh');
      const canvas = document.createElement('canvas');
      canvas.className = 'viewer-canvas';
      const gl = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
      if (gl === null) throw new Error('no webgl');
      this.gl = gl;
      this.canvas = canvas;
      this.stage.appendChild(canvas);
      const program = buildProgram(gl);
      if (program === null) throw new Error('no program');
      uploadMesh(gl, this.mesh);
      this.root.dataset['render'] = 'webgl';
    } catch {
      this.gl = null;
      this.canvas = null;
      this.mesh = null;
      this.root.dataset['render'] = 'preview';
      this.fallbackImage.hidden = false;
    }
  }

  setHotspots(hotspots: Hotspot[]): void {
    this.hotspots = hotspots;
  }

  hotspotsState(): Hotspot[] {
    return [...this.hotspots];
  }

  /** Placing mode: the next canvas click or Enter places a hotspot at the surface point. */
  beginPlace(after: (point: { x_mm: number; y_mm: number; z_mm: number }) => void): void {
    if (this.locked || this.firstPerson) return;
    const box = (this.root.dataset['box'] ?? '').split(' ').map(Number);
    const bounds: { min: [number, number, number]; max: [number, number, number] } = {
      min: [-(box[0] ?? 0) / 2000, -(box[1] ?? 0) / 2000, -(box[2] ?? 0) / 2000],
      max: [(box[0] ?? 0) / 2000, (box[1] ?? 0) / 2000, (box[2] ?? 0) / 2000],
    };
    const place = (canvasX: number, canvasY: number): void => {
      const point = this.rayPick(canvasX, canvasY, bounds);
      if (point === null) return;
      after(point);
    };
    const onClick = (event: MouseEvent): void => {
      event.stopImmediatePropagation();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      place(event.clientX - rect.left, event.clientY - rect.top);
      this.stage.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onEnter, true);
    };
    const onEnter = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const rect = this.stage.getBoundingClientRect();
      place((rect.right - rect.left) / 2, (rect.bottom - rect.top) / 2);
      this.stage.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onEnter, true);
    };
    this.stage.addEventListener('click', onClick);
    window.addEventListener('keydown', onEnter, true);
  }

  /** Intersects the view ray with the model's bounding box, returning millimetres from the centre. */
  private rayPick(canvasX: number, canvasY: number, bounds: { min: [number, number, number]; max: [number, number, number] }): { x_mm: number; y_mm: number; z_mm: number } | null {
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    const mesh = this.mesh;
    if (mesh === null) return null;
    const meshBounds = meshBoundsOf(mesh);
    const centre: Vec3 = {
      x: (meshBounds.min[0] + meshBounds.max[0]) / 2,
      y: (meshBounds.min[1] + meshBounds.max[1]) / 2,
      z: (meshBounds.min[2] + meshBounds.max[2]) / 2,
    };
    const eye = this.eyeOf();
    const aspect = width / Math.max(1, height);
    const half = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    const ndcX = (2 * canvasX) / width - 1;
    const ndcY = 1 - (2 * canvasY) / height;
    const forward = normalise({ x: centre.x - eye.x, y: centre.y - eye.y, z: centre.z - eye.z });
    const right = normalise(cross(forward, { x: 0, y: 1, z: 0 }));
    const up = cross(right, forward);
    const dir = normalise({
      x: forward.x + right.x * ndcX * half * aspect + up.x * ndcY * half,
      y: forward.y + right.y * ndcX * half * aspect + up.y * ndcY * half,
      z: forward.z + right.z * ndcX * half * aspect + up.z * ndcY * half,
    });
    let tMin = -Infinity;
    let tMax = Infinity;
    const boxMin = [bounds.min[0], bounds.min[1], bounds.min[2]];
    const boxMax = [bounds.max[0], bounds.max[1], bounds.max[2]];
    const origin = [eye.x - centre.x, eye.y - centre.y, eye.z - centre.z];
    const dirArr = [dir.x, dir.y, dir.z];
    for (let i = 0; i < 3; i++) {
      const o = origin[i] ?? 0;
      const d = dirArr[i] ?? 0;
      const lo = boxMin[i] ?? 0;
      const hi = boxMax[i] ?? 0;
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return null;
        continue;
      }
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
    }
    const t = tMax >= tMin && tMax > 0 ? tMax : null;
    if (t === null) return null;
    return {
      x_mm: ((origin[0] ?? 0) + (dirArr[0] ?? 0) * t) * 1000,
      y_mm: ((origin[1] ?? 0) + (dirArr[1] ?? 0) * t) * 1000,
      z_mm: ((origin[2] ?? 0) + (dirArr[2] ?? 0) * t) * 1000,
    };
  }

  private eyeOf(): Vec3 {
    const mesh = this.mesh;
    const fallback = cameraPosition(this.camera, this.radius);
    if (mesh === null) return fallback;
    const meshBounds = meshBoundsOf(mesh);
    const centre: Vec3 = {
      x: (meshBounds.min[0] + meshBounds.max[0]) / 2,
      y: (meshBounds.min[1] + meshBounds.max[1]) / 2,
      z: (meshBounds.min[2] + meshBounds.max[2]) / 2,
    };
    const radius = Math.hypot(
      meshBounds.max[0] - meshBounds.min[0],
      meshBounds.max[1] - meshBounds.min[1],
      meshBounds.max[2] - meshBounds.min[2],
    ) / 2;
    const d = this.camera.distanceFactor * radius;
    const a = (this.camera.azimuth * Math.PI) / 180;
    const t = (this.camera.tilt * Math.PI) / 180;
    return {
      x: centre.x + d * Math.cos(t) * Math.sin(a),
      y: centre.y + d * Math.sin(t),
      z: centre.z + d * Math.cos(t) * Math.cos(a),
    };
  }

  cameraState(): Camera {
    return { ...this.camera };
  }

  firstPersonActive(): boolean {
    return this.firstPerson;
  }

  fpsHeading(): number {
    return this.heading;
  }

  toggleFirstPerson(): void {
    if (this.locked) return;
    if (this.firstPerson) {
      this.firstPerson = false;
      if (this.savedCamera !== null) this.camera = { ...this.savedCamera };
      this.savedCamera = null;
      this.root.dataset['mode'] = 'orbit';
      delete this.root.dataset['heading'];
      delete this.root.dataset['pitch'];
      delete this.root.dataset['eyeHeight'];
      const ring = document.querySelector<SVGSVGElement>('.ring-svg');
      if (ring !== null) ring.setAttribute('aria-label', copy('viewer.ring'));
      this.applyCamera();
    } else {
      this.savedCamera = { ...this.camera };
      this.firstPerson = true;
      this.heading = wrapAzimuth(this.camera.azimuth + 180);
      this.pitch = 0;
      this.root.dataset['mode'] = 'first-person';
      this.root.dataset['heading'] = headingShown(this.heading);
      this.root.dataset['pitch'] = '0.0';
      this.root.dataset['eyeHeight'] = this.eyeHeight.toFixed(1);
      const ring = document.querySelector<SVGSVGElement>('.ring-svg');
      if (ring !== null) ring.setAttribute('aria-label', copy('viewer.heading_strip'));
      this.hideRingParts();
      this.draw();
    }
  }

  private hideRingParts(): void {
    const ring = document.querySelector<SVGSVGElement>('.ring-svg');
    if (ring === null) return;
    ring.querySelectorAll('[data-part]').forEach(part => {
      const element = part as SVGElement;
      if (element.dataset['part'] === 'hotspot-dot') element.remove();
    });
    const caliper = ring.querySelector('[data-part="caliper"]');
    if (caliper !== null) (caliper as SVGElement).setAttribute('hidden', '');
    const indexMark = ring.querySelector('[data-part="index-mark"]');
    if (indexMark !== null) indexMark.remove();
    const tiltMarker = ring.querySelector('[data-part="tilt-marker"]');
    if (tiltMarker !== null) tiltMarker.remove();
  }

  step(delta: { azimuth?: number; tilt?: number; distance?: number; fov?: number }): void {
    if (this.firstPerson || this.locked) return;
    const from = { ...this.camera };
    if (delta.azimuth !== undefined) {
      this.camera.azimuth = wrapAzimuth(this.camera.azimuth + delta.azimuth * AZIMUTH_STEP);
    }
    if (delta.tilt !== undefined) {
      this.camera.tilt = stepTo(this.camera.tilt, delta.tilt, TILT_STEP, TILT_MIN, TILT_MAX);
    }
    if (delta.distance !== undefined) {
      this.camera.distanceFactor = stepTo(this.camera.distanceFactor, delta.distance, DISTANCE_STEP, DISTANCE_MIN, DISTANCE_MAX);
    }
    if (delta.fov !== undefined) {
      this.camera.fov = stepTo(this.camera.fov, delta.fov, FOV_STEP, FOV_MIN, FOV_MAX);
    }
    this.tweenDuration = 180;
    this.tween(from, this.camera);
  }

  stepFirstPerson(delta: { heading?: number; pitch?: number }): void {
    if (!this.firstPerson || this.locked) return;
    if (delta.heading !== undefined) this.heading = wrapAzimuth(this.heading + delta.heading * FP_HEADING_STEP);
    if (delta.pitch !== undefined) this.pitch = Math.min(FP_PITCH_MAX, Math.max(FP_PITCH_MIN, this.pitch + delta.pitch * TILT_STEP));
    this.root.dataset['heading'] = headingShown(this.heading);
    this.root.dataset['pitch'] = this.pitch.toFixed(1);
    this.draw();
  }

  reset(): void {
    if (this.locked) return;
    if (this.firstPerson) this.toggleFirstPerson();
    const target = this.defaultCamera();
    this.activeHotspot = 0;
    this.clearHotspotAttributes();
    this.tweenDuration = 330;
    this.tween({ ...this.camera }, target);
  }

  defaultCamera(): Camera {
    return {
      azimuth: Number(this.root.dataset['defaultAzimuth'] ?? this.root.dataset['azimuth'] ?? 30),
      tilt: Number(this.root.dataset['defaultTilt'] ?? this.root.dataset['tilt'] ?? 20),
      distanceFactor: Number(this.root.dataset['defaultDistanceFactor'] ?? this.root.dataset['distanceFactor'] ?? 2.4),
      fov: Number(this.root.dataset['defaultFov'] ?? this.root.dataset['fov'] ?? 35),
    };
  }

  stepHotspot(direction: 1 | -1): void {
    if (this.hotspots.length === 0 || this.locked) return;
    const next = (this.activeHotspot + direction + this.hotspots.length) % this.hotspots.length;
    this.focusHotspot(next);
  }

  focusHotspot(index: number): void {
    if (index >= this.hotspots.length) return;
    const hotspot = this.hotspots[index];
    if (hotspot === undefined) return;
    const targetAzimuth = facingAzimuth({ x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm });
    this.activeHotspot = index;
    const from = { ...this.camera };
    this.camera = { ...this.camera, azimuth: targetAzimuth };
    this.tweenDuration = 330;
    this.tween(from, this.camera, () => this.announceSelection());
  }

  private clearHotspotAttributes(): void {
    delete this.root.dataset['hotspotIndex'];
    delete this.root.dataset['hotspotX'];
    delete this.root.dataset['hotspotY'];
    const ring = document.querySelector<SVGSVGElement>('.ring-svg');
    const caliper = ring?.querySelector('[data-part="caliper"]');
    if (caliper !== undefined && caliper !== null) (caliper as SVGElement).setAttribute('hidden', '');
  }

  private tween(from: Camera, to: Camera, done?: () => void): void {
    this.tweenFrom = from;
    this.tweenTo = to;
    this.tweenStart = performance.now();
    this.root.dataset['animating'] = reducedMotion() ? 'false' : 'true';
    this.publishEndAttributes(to);
    if (reducedMotion()) {
      this.camera = { ...to };
      this.root.dataset['animating'] = 'false';
      this.applyCamera();
      done?.();
      return;
    }
    window.cancelAnimationFrame(this.tweenHandle);
    const tick = (now: number): void => {
      const t = Math.min(1, (now - this.tweenStart) / this.tweenDuration);
      const eased = t * (2 - t);
      if (this.tweenFrom === null || this.tweenTo === null) return;
      this.camera = {
        azimuth: wrapAzimuth(this.tweenFrom.azimuth + (this.tweenTo.azimuth - this.tweenFrom.azimuth) * eased),
        tilt: this.tweenFrom.tilt + (this.tweenTo.tilt - this.tweenFrom.tilt) * eased,
        distanceFactor: this.tweenFrom.distanceFactor + (this.tweenTo.distanceFactor - this.tweenFrom.distanceFactor) * eased,
        fov: this.tweenFrom.fov + (this.tweenTo.fov - this.tweenFrom.fov) * eased,
      };
      this.applyCamera();
      if (t < 1) {
        this.tweenHandle = window.requestAnimationFrame(tick);
      } else {
        this.camera = { ...this.tweenTo };
        this.root.dataset['animating'] = 'false';
        this.applyCamera();
        done?.();
      }
    };
    this.tweenHandle = window.requestAnimationFrame(tick);
  }

  /** Data attributes hold the end value from the moment the input lands. */
  private publishEndAttributes(cam: Camera): void {
    if (this.firstPerson) return;
    this.root.dataset['azimuth'] = viewerNumber(wrapAzimuth(cam.azimuth));
    this.root.dataset['tilt'] = viewerNumber(cam.tilt);
    this.root.dataset['cameraDistance'] = viewerNumber(cam.distanceFactor * this.radius);
    this.root.dataset['fov'] = viewerNumber(cam.fov);
  }

  private applyCamera(): void {
    this.draw();
  }

  private draw(): void {
    this.updateRing();
    this.updateReadout();
    if (this.gl === null || this.canvas === null) return;
    const canvas = this.canvas;
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.root.dataset['canvasWidth'] = String(width);
    this.root.dataset['canvasHeight'] = String(height);
    renderScene(this.gl, this.mesh!, this.camera, this.firstPerson ? { heading: this.heading, pitch: this.pitch, eyeHeight: this.eyeHeight } : null);
  }

  private updateRing(): void {
    const ring = document.querySelector<SVGSVGElement>('.ring-svg');
    if (ring === null) return;
    if (this.firstPerson) return;
    const width = Number(this.root.dataset['canvasWidth'] ?? 600);
    const height = Number(this.root.dataset['canvasHeight'] ?? 450);
    const indexMark = ring.querySelector<SVGElement>('[data-part="index-mark"]');
    if (indexMark !== null) {
      indexMark.dataset['angle'] = viewerNumber(this.camera.azimuth);
      indexMark.setAttribute('transform', `rotate(${this.camera.azimuth} 150 150)`);
    }
    const tiltMarker = ring.querySelector<SVGElement>('[data-part="tilt-marker"]');
    if (tiltMarker !== null) {
      tiltMarker.dataset['angle'] = viewerNumber(this.camera.tilt);
      const angle = ((90 - this.camera.tilt) * Math.PI) / 180;
      tiltMarker.setAttribute('transform', `translate(${(150 + 128 * Math.cos(angle)).toFixed(1)},${(150 - 128 * Math.sin(angle)).toFixed(1)}) rotate(${(this.camera.tilt - 90).toFixed(1)})`);
    }
    const caliper = ring.querySelector<SVGElement>('[data-part="caliper"]');
    const activeDot = ring.querySelector<SVGElement>(`[data-part="hotspot-dot"][data-active="true"]`);
    if (this.activeHotspot > 0 && this.hotspots[this.activeHotspot - 1] !== undefined && caliper !== null) {
      const hotspot = this.hotspots[this.activeHotspot - 1]!;
      const point = projectHotspot({ x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm }, this.camera, this.radius, width, height);
      const centre = ringIndexMarkCentre(this.camera.azimuth, width, height);
      caliper.removeAttribute('hidden');
      caliper.setAttribute('x1', centre.x.toFixed(1));
      caliper.setAttribute('y1', centre.y.toFixed(1));
      caliper.setAttribute('x2', point.x.toFixed(1));
      caliper.setAttribute('y2', point.y.toFixed(1));
      this.root.dataset['hotspotIndex'] = String(this.activeHotspot);
      this.root.dataset['hotspotX'] = point.x.toFixed(1);
      this.root.dataset['hotspotY'] = point.y.toFixed(1);
      if (activeDot !== null) {
        activeDot.setAttribute('cx', point.x.toFixed(1));
        activeDot.setAttribute('cy', point.y.toFixed(1));
      }
    } else if (caliper !== null) {
      caliper.setAttribute('hidden', '');
    }
    ring.querySelectorAll<SVGElement>('[data-part="hotspot-dot"]').forEach(dot => {
      const index = Number(dot.dataset['index'] ?? 0);
      const hotspot = this.hotspots[index - 1];
      if (hotspot === undefined) {
        dot.setAttribute('hidden', '');
        return;
      }
      const point = projectHotspot({ x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm }, this.camera, this.radius, width, height);
      dot.setAttribute('cx', point.x.toFixed(1));
      dot.setAttribute('cy', point.y.toFixed(1));
      if (index === this.activeHotspot) {
        dot.dataset['active'] = 'true';
        dot.setAttribute('data-active', 'true');
      } else {
        dot.removeAttribute('data-active');
      }
    });
  }

  private updateReadout(): void {
    const distanceEl = document.getElementById('readout-distance');
    const fovEl = document.getElementById('readout-fov');
    const tiltEl = document.getElementById('readout-tilt');
    const azimuthEl = document.getElementById('readout-azimuth');
    if (this.firstPerson) {
      if (distanceEl !== null) distanceEl.textContent = '—';
      if (fovEl !== null) fovEl.textContent = '—';
      if (tiltEl !== null) tiltEl.textContent = this.pitch.toFixed(1);
      if (azimuthEl !== null) azimuthEl.textContent = headingShown(this.heading);
      return;
    }
    if (distanceEl !== null) distanceEl.textContent = viewerNumber(this.camera.distanceFactor * this.radius);
    if (fovEl !== null) fovEl.textContent = viewerNumber(this.camera.fov);
    if (tiltEl !== null) tiltEl.textContent = viewerNumber(this.camera.tilt);
    if (azimuthEl !== null) azimuthEl.textContent = viewerNumber(this.camera.azimuth);
  }

  private wireKeys(): void {
    const keysAct = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      const controls = this.root.parentElement?.querySelector('.viewer-controls') ?? null;
      const within =
        this.root === target ||
        this.root.contains(target) ||
        (controls !== null && controls.contains(target));
      if (!within) return;
      const fps = this.firstPerson;
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          if (fps) this.stepFirstPerson({ heading: 1 });
          else this.step({ azimuth: 1 });
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (fps) this.stepFirstPerson({ heading: -1 });
          else this.step({ azimuth: -1 });
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (fps) this.stepFirstPerson({ pitch: 1 });
          else this.step({ tilt: 1 });
          break;
        case 'ArrowDown':
          event.preventDefault();
          if (fps) this.stepFirstPerson({ pitch: -1 });
          else this.step({ tilt: -1 });
          break;
        case '+':
        case '=':
          if (!fps) this.step({ distance: -1 });
          break;
        case '-':
          if (!fps) this.step({ distance: 1 });
          break;
        case ']':
          if (!fps) this.step({ fov: 1 });
          break;
        case '[':
          if (!fps) this.step({ fov: -1 });
          break;
        case 'h':
        case 'H':
          if (!fps) {
            if (event.shiftKey) this.stepHotspot(-1);
            else this.stepHotspot(1);
          }
          break;
        case 'f':
        case 'F':
          this.toggleFirstPerson();
          const fpButton = document.getElementById('first-person');
          if (fpButton !== null) fpButton.setAttribute('aria-pressed', this.firstPerson ? 'true' : 'false');
          break;
        case '0':
          if (!fps) this.reset();
          break;
        case 'Escape':
          if (this.firstPerson) {
            this.toggleFirstPerson();
            const fpButton2 = document.getElementById('first-person');
            if (fpButton2 !== null) fpButton2.setAttribute('aria-pressed', 'false');
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', keysAct);
  }

  private wireDrag(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let travelX = 0;
    let travelY = 0;
    const down = (x: number, y: number): void => {
      dragging = true;
      lastX = x;
      lastY = y;
      travelX = 0;
      travelY = 0;
    };
    const move = (x: number, y: number): void => {
      if (!dragging) return;
      const dx = x - lastX;
      const dy = y - lastY;
      travelX += dx;
      travelY += dy;
      lastX = x;
      lastY = y;
      const horizontalSteps = wholeSteps(travelX, 24);
      const verticalSteps = wholeSteps(travelY, 24);
      if (horizontalSteps !== 0) {
        travelX -= horizontalSteps * 24;
        this.step({ azimuth: horizontalSteps });
      }
      if (verticalSteps !== 0) {
        travelY -= verticalSteps * 24;
        this.step({ tilt: verticalSteps });
      }
    };
    const up = (): void => {
      dragging = false;
    };
    this.stage.addEventListener('mousedown', event => {
      down(event.clientX, event.clientY);
    });
    window.addEventListener('mousemove', event => move(event.clientX, event.clientY));
    window.addEventListener('mouseup', up);
    this.stage.addEventListener('touchstart', event => {
      const touch = event.touches[0];
      if (touch !== undefined) down(touch.clientX, touch.clientY);
    }, { passive: true });
    this.stage.addEventListener('touchmove', event => {
      const touch = event.touches[0];
      if (touch !== undefined) move(touch.clientX, touch.clientY);
    }, { passive: true });
    this.stage.addEventListener('touchend', up);
    this.stage.addEventListener('wheel', event => {
      event.preventDefault();
      this.step({ distance: event.deltaY > 0 ? 1 : -1 });
    }, { passive: false });
    let pinchSpread = -1;
    this.stage.addEventListener('touchmove', event => {
      if (event.touches.length !== 2) return;
      const [a, b] = [event.touches[0], event.touches[1]];
      if (a === undefined || b === undefined) return;
      const spread = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchSpread > 0) {
        const change = (Math.abs(spread - pinchSpread) / pinchSpread) * 100;
        if (change >= 10) {
          const closer = spread > pinchSpread;
          this.step({ distance: closer ? -1 : 1 });
          pinchSpread = spread;
        }
      } else {
        pinchSpread = spread;
      }
    }, { passive: true });
    this.stage.addEventListener('touchend', () => {
      pinchSpread = -1;
    });
  }

  private wireButtons(): void {
    const prev = document.getElementById('prev-hotspot');
    prev?.addEventListener('click', () => this.stepHotspot(-1));
    const next = document.getElementById('next-hotspot');
    next?.addEventListener('click', () => this.stepHotspot(1));
    const fp = document.getElementById('first-person');
    fp?.addEventListener('click', () => {
      this.toggleFirstPerson();
      fp.setAttribute('aria-pressed', this.firstPerson ? 'true' : 'false');
    });
    const reset = document.getElementById('reset-view');
    reset?.addEventListener('click', () => this.reset());
  }

  announceSelection(): void {
    const el = document.getElementById('viewer-announcements');
    if (this.activeHotspot === 0 || el === null) return;
    const hotspot = this.hotspots[this.activeHotspot - 1];
    if (hotspot === undefined) return;
    announce(el, copy('viewer.announcements.hotspot', { n: this.activeHotspot, total: this.hotspots.length, label: hotspot.label }));
  }
}

function headingShown(heading: number): string {
  const wrapped = ((heading % 360) + 360) % 360;
  return (Math.round(wrapped * 10) / 10).toFixed(1);
}

function wholeSteps(travel: number, step: number): number {
  if (travel >= 0) return Math.floor(travel / step);
  return Math.ceil(travel / step);
}

function viewerNumber(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** Minimal GLB reader for the viewer: positions + indices of the first mesh. */
function parseGlb(data: Uint8Array): GlbMesh | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 20 || data[0] !== 0x67 || data[1] !== 0x6c) return null;
  let offset = 12;
  let json: Record<string, unknown> | null = null;
  let binary: Uint8Array | null = null;
  while (offset + 8 <= data.length) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = String.fromCharCode(data[offset + 4]!, data[offset + 5]!, data[offset + 6]!, data[offset + 7]!);
    const start = offset + 8;
    const chunk = data.subarray(start, start + chunkLength);
    if (chunkType === 'JSON') {
      json = JSON.parse(new TextDecoder().decode(chunk)) as Record<string, unknown>;
    } else if (chunkType.startsWith('BIN')) {
      binary = chunk;
    }
    offset = start + chunkLength;
  }
  if (json === null) return null;
  const meshes = (json['meshes'] as { primitives: { attributes: Record<string, number>; indices?: number }[] }[] | undefined) ?? [];
  const accessors = (json['accessors'] as { bufferView?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[] | undefined) ?? [];
  const views = (json['bufferViews'] as { buffer: number; byteOffset?: number; byteLength: number }[] | undefined) ?? [];
  const buffers = (json['buffers'] as { byteLength: number; uri?: string }[] | undefined) ?? [];
  void buffers;
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives) {
      const positionIndex = primitive.attributes.POSITION;
      if (positionIndex === undefined) continue;
      const positionAccessor = accessors[positionIndex];
      if (positionAccessor === undefined || positionAccessor.bufferView === undefined) continue;
      const positionView = views[positionAccessor.bufferView];
      if (positionView === undefined || binary === null) continue;
      const positions = new Float32Array(
        binary.buffer,
        binary.byteOffset + (positionView.byteOffset ?? 0),
        positionAccessor.count * 3,
      );
      let indices: Uint32Array;
      if (primitive.indices !== undefined) {
        const indexAccessor = accessors[primitive.indices];
        if (indexAccessor === undefined || indexAccessor.bufferView === undefined) continue;
        const indexView = views[indexAccessor.bufferView];
        if (indexView === undefined) continue;
        const indexCount = indexAccessor.count;
        if (indexAccessor.componentType === 5125) {
          indices = new Uint32Array(binary.buffer, binary.byteOffset + (indexView.byteOffset ?? 0), indexCount);
        } else if (indexAccessor.componentType === 5123) {
          const short = new Uint16Array(binary.buffer, binary.byteOffset + (indexView.byteOffset ?? 0), indexCount);
          indices = Uint32Array.from(short);
        } else {
          const bytes = new Uint8Array(binary.buffer, binary.byteOffset + (indexView.byteOffset ?? 0), indexCount);
          indices = Uint32Array.from(bytes);
        }
      } else {
        indices = Uint32Array.from({ length: positionAccessor.count }, (_, i) => i);
      }
      const min = positionAccessor.min ?? [-1, -1, -1];
      const max = positionAccessor.max ?? [1, 1, 1];
      return { positions, indices, bounds: { min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0], max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0] } };
    }
  }
  return null;
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertexSource = `
    attribute vec3 aPosition;
    uniform mat4 uMvp;
    void main() {
      gl_Position = uMvp * vec4(aPosition, 1.0);
    }`;
  const fragmentSource = `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(0.16, 0.19, 0.27, 1.0);
    }`;
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (shader === null) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      return null;
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (vertex === null || fragment === null) return null;
  const program = gl.createProgram();
  if (program === null) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  return program;
}

function uploadMesh(gl: WebGLRenderingContext, mesh: GlbMesh): void {
  const positions = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positions);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  if (program === null) return;
  const loc = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  const indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  gl.getExtension('OES_element_index_uint');
}

function renderScene(
  gl: WebGLRenderingContext,
  mesh: GlbMesh,
  camera: Camera,
  fps: { heading: number; pitch: number; eyeHeight: number } | null,
): void {
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0.956, 0.941, 0.902, 1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  if (program === null) return;
  const mvpLocation = gl.getUniformLocation(program, 'uMvp');
  const bounds = meshBoundsOf(mesh);
  const centre: Vec3 = {
    x: (bounds.min[0] + bounds.max[0]) / 2,
    y: (bounds.min[1] + bounds.max[1]) / 2,
    z: (bounds.min[2] + bounds.max[2]) / 2,
  };
  const radius = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ) / 2;
  let eye: Vec3;
  let look: Vec3;
  let fov = camera.fov;
  if (fps !== null) {
    const a = ((fps.heading + 180) * Math.PI) / 180;
    eye = {
      x: centre.x + radius * Math.sin(a),
      y: bounds.min[1] + fps.eyeHeight / 1000,
      z: centre.z + radius * Math.cos(a),
    };
    look = { x: centre.x, y: eye.y, z: centre.z };
    fov = 60;
  } else {
    const d = camera.distanceFactor * radius;
    const a = (camera.azimuth * Math.PI) / 180;
    const t = (camera.tilt * Math.PI) / 180;
    eye = {
      x: centre.x + d * Math.cos(t) * Math.sin(a),
      y: centre.y + d * Math.sin(t),
      z: centre.z + d * Math.cos(t) * Math.cos(a),
    };
    look = centre;
  }
  const projection = perspective(fov, gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight), radius / 100, radius * 20);
  const view = lookAt(eye, look);
  const mvp = multiply(projection, view);
  if (mvpLocation !== null) gl.uniformMatrix4fv(mvpLocation, false, mvp);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
}

function meshBoundsOf(mesh: GlbMesh): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[i + axis] ?? 0;
      if (value < (min[axis] ?? Infinity)) min[axis] = value;
      if (value > (max[axis] ?? -Infinity)) max[axis] = value;
    }
  }
  return { min, max };
}

function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye: Vec3, target: Vec3): Float32Array {
  const forward = normalise({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  const right = normalise(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  return new Float32Array([
    right.x, up.x, -forward.x, 0,
    right.y, up.y, -forward.y, 0,
    right.z, up.z, -forward.z, 0,
    -dot(right, eye), -dot(up, eye), dot(forward, eye), 1,
  ]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + j] ?? 0) * (b[i * 4 + k] ?? 0);
      }
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

function normalise(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return len === 0 ? { x: 0, y: 1, z: 0 } : { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export { SurveyViewer, viewerNumber };
