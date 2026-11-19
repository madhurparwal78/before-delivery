import * as THREE from 'three';
import { copy } from '../shared/copy.js';
import { announce, need, reducedMotion } from './dom.js';

const SPIN_STEP = 15;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const SPRING_MS = 600;
const HOP_MS = 420;

/** Wump on the title screen: the invented moss-backed tide-newt the family plays with first. */
export class GuideCreature {
  private spin = 0;
  private zoom = 1;
  private stretch = 0;
  private nudges = 0;
  private hopStartedAt: number | null = null;
  private springFrom = 0;
  private springStartedAt: number | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 50);
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly body = new THREE.Group();
  private readonly element: HTMLElement;
  private reduced = reducedMotion();

  constructor(element: HTMLElement, canvas: HTMLCanvasElement) {
    this.element = element;
    this.canvas = canvas;
    this.camera.position.set(0, 0.9, 3.4);
    this.camera.lookAt(0, 0.35, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556b3f, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);

    const skin = new THREE.MeshStandardMaterial({ color: '#5f7d4a', roughness: 0.6 });
    const moss = new THREE.MeshStandardMaterial({ color: '#8fae63', roughness: 0.95 });
    const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.9, 8, 16), skin);
    trunk.rotation.z = Math.PI / 2;
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), moss);
    back.position.set(0, 0.2, 0);
    back.scale.set(1.3, 0.5, 0.9);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), skin);
    head.position.set(0.78, 0.05, 0);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 10), skin);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-0.95, 0, 0);
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: '#15110c', roughness: 0.3 });
    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), eyeMaterial);
    leftEye.position.set(0.95, 0.14, 0.15);
    const rightEye = leftEye.clone();
    rightEye.position.z = -0.15;
    this.body.add(trunk, back, head, tail, leftEye, rightEye);
    this.scene.add(this.body);

    this.sync();
    this.wire();
    requestAnimationFrame((now) => this.frame(now));
  }

  private wire(): void {
    this.element.addEventListener('keydown', (event) => this.key(event));
    let pointerId: number | null = null;
    let startX = 0;
    let startSpin = 0;
    this.element.addEventListener('pointerdown', (event) => {
      pointerId = event.pointerId;
      startX = event.clientX;
      startSpin = this.spin;
      this.element.setPointerCapture(event.pointerId);
    });
    this.element.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      const travel = event.clientX - startX;
      this.setSpin(startSpin + Math.trunc(travel / 20) * SPIN_STEP);
      this.setStretch(Math.min(1, Math.abs(travel) / 200));
    });
    const release = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      this.releaseStretch();
    };
    this.element.addEventListener('pointerup', release);
    this.element.addEventListener('pointercancel', release);

    let pinchStart: number | null = null;
    let pinchZoom = 1;
    this.element.addEventListener(
      'touchmove',
      (event) => {
        if (event.touches.length !== 2) return;
        const distance = touchDistance(event.touches);
        if (pinchStart === null) {
          pinchStart = distance;
          pinchZoom = this.zoom;
          return;
        }
        const steps = Math.trunc((distance - pinchStart) / 40);
        this.setZoom(pinchZoom + steps * ZOOM_STEP);
      },
      { passive: true },
    );
    this.element.addEventListener('touchend', () => {
      pinchStart = null;
    });
  }

  private key(event: KeyboardEvent): void {
    const key = event.key;
    if (key === 'ArrowLeft' || key === 'q' || key === 'Q') this.setSpin(this.spin - SPIN_STEP);
    else if (key === 'ArrowRight' || key === 'e' || key === 'E') this.setSpin(this.spin + SPIN_STEP);
    else if (key === '+' || key === '=') this.setZoom(this.zoom + ZOOM_STEP);
    else if (key === '-' || key === '_') this.setZoom(this.zoom - ZOOM_STEP);
    else if (key === ' ' || key === 'Spacebar') this.nudge();
    else if (key === 'Home') this.reset();
    else return;
    event.preventDefault();
  }

  reset(): void {
    this.spin = 0;
    this.zoom = 1;
    this.stretch = 0;
    this.springStartedAt = null;
    this.sync();
    announce('guide-status', copy.guideRest);
  }

  private setSpin(value: number): void {
    this.spin = ((Math.round(value / SPIN_STEP) * SPIN_STEP) % 360 + 360) % 360;
    this.sync();
    announce('guide-status', copy.guideFaces(this.spin));
  }

  private setZoom(value: number): void {
    const stepped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
    if (stepped === this.zoom) return;
    this.zoom = stepped;
    this.sync();
    announce('guide-status', copy.guideZoom(Math.round(this.zoom * 100)));
  }

  private setStretch(value: number): void {
    this.stretch = value;
    this.springStartedAt = null;
    this.sync();
  }

  private releaseStretch(): void {
    if (this.stretch === 0) return;
    if (this.reduced) {
      this.stretch = 0;
      this.sync();
      announce('guide-status', copy.guideRest);
      return;
    }
    this.springFrom = this.stretch;
    this.springStartedAt = performance.now();
  }

  private nudge(): void {
    this.nudges += 1;
    if (!this.reduced) this.hopStartedAt = performance.now();
    this.sync();
    announce('guide-status', copy.guideHops);
  }

  private draw(): void {
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      } catch {
        this.element.dataset.state = 'still';
        return;
      }
    }
    const width = this.canvas.clientWidth || 640;
    const height = this.canvas.clientHeight || 360;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  private sync(): void {
    this.element.dataset.spin = String(this.spin);
    this.element.dataset.zoom = this.zoom.toFixed(2);
    this.element.dataset.stretch = this.stretch.toFixed(2);
    this.element.dataset.nudges = String(this.nudges);
    this.element.dataset.state = 'ready';
  }

  private frame(now: number): void {
    this.reduced = reducedMotion();
    if (this.springStartedAt !== null) {
      const share = Math.min(1, (now - this.springStartedAt) / SPRING_MS);
      this.stretch = share >= 1 ? 0 : this.springFrom * (1 - share);
      this.sync();
      if (share >= 1) {
        this.springStartedAt = null;
        announce('guide-status', copy.guideRest);
      }
    }
    let hop = 0;
    if (this.hopStartedAt !== null) {
      const share = (now - this.hopStartedAt) / HOP_MS;
      if (share >= 1) this.hopStartedAt = null;
      else hop = Math.sin(share * Math.PI) * 0.4;
    }
    const breath = this.reduced ? 0 : Math.sin(now / 1900) * 0.02;
    this.body.rotation.y = THREE.MathUtils.degToRad(this.spin);
    this.body.position.y = hop;
    this.body.scale.set(1 + this.stretch * 0.35, 1 - this.stretch * 0.2 + breath, 1 + breath);
    this.camera.position.set(0, 0.9, 3.4 / this.zoom);
    this.camera.lookAt(0, 0.35, 0);
    this.draw();
    requestAnimationFrame((next) => this.frame(next));
  }
}

function touchDistance(touches: TouchList): number {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

export function startGuide(): GuideCreature | null {
  const element = need('guide-creature');
  const canvas = document.getElementById('guide-canvas') as HTMLCanvasElement | null;
  if (!canvas) return null;
  return new GuideCreature(element, canvas);
}
