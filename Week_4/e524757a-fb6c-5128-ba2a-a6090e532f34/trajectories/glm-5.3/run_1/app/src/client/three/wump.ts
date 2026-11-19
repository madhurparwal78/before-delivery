// Wump, the guide creature: a small three.js scene with a moss-backed tide-newt look.

import * as THREE from "three";

export class WumpScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private wump: THREE.Group;
  private spin = 0;
  private zoomLevel = 1;
  private stretch = 0;
  private hopT = -1;
  private breath = 0;
  private readonly reduced: boolean;
  private running = true;
  private raf = 0;

  constructor(host: HTMLElement, reduced: boolean) {
    this.reduced = reduced;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d2f2a);
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
    this.camera.position.set(0, 1.1, 4.4);
    this.camera.lookAt(0, 0.6, 0);

    const hemi = new THREE.HemisphereLight(0xdfe8e4, 0x2b3a33, 0.9);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e0, 1.2);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);

    this.wump = this.buildWump();
    this.scene.add(this.wump);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x3b4d42, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      host.append(this.renderer.domElement);
      this.resize(host);
      const observer = new ResizeObserver(() => this.resize(host));
      observer.observe(host);
    } catch {
      this.renderer = null;
    }
  }

  private buildWump(): THREE.Group {
    const group = new THREE.Group();
    const moss = new THREE.MeshStandardMaterial({ color: 0x4c6b3f, roughness: 0.8 });
    const belly = new THREE.MeshStandardMaterial({ color: 0xd8c98d, roughness: 0.7 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 8, 16), moss);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.55;
    group.add(body);

    const bellyPatch = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), belly);
    bellyPatch.position.set(0, 0.42, 0.24);
    bellyPatch.scale.set(1.5, 0.9, 0.7);
    group.add(bellyPatch);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), moss);
    head.position.set(0, 0.62, 0.62);
    group.add(head);

    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eye);
      e.position.set(sx * 0.12, 0.7, 0.88);
      group.add(e);
    }

    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.5, 6, 8), belly);
    tail.rotation.x = Math.PI / 2.6;
    tail.position.set(0, 0.45, -0.75);
    group.add(tail);

    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 6, 8), belly);
      leg.position.set(sx * 0.3, 0.18, 0.1);
      group.add(leg);
    }
    return group;
  }

  private resize(host: HTMLElement): void {
    if (!this.renderer) return;
    const w = host.clientWidth || 320;
    const h = host.clientHeight || 180;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  start(): void {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
  }

  private frame(): void {
    this.wump.rotation.y = THREE.MathUtils.degToRad(this.spin);
    const targetX = 4.4 / Math.max(0.5, this.zoomLevel);
    this.camera.position.x = targetX * 0.2;
    this.camera.position.z = targetX;
    this.camera.lookAt(0, 0.55, 0);

    this.wump.scale.y = 1 + this.stretch * 0.25;
    this.wump.scale.x = this.wump.scale.z = 1 - this.stretch * 0.12;

    if (!this.reduced) {
      this.breath = (this.breath + 1) % 240;
      const phase = Math.sin((this.breath / 240) * Math.PI * 2);
      this.wump.position.y = this.hopT >= 0 ? this.hopArc(this.hopT) : 0.02 * phase;
      if (this.hopT >= 0) {
        this.hopT += 1 / 24;
        if (this.hopT >= 1) this.hopT = -1;
      }
    } else {
      this.wump.position.y = 0;
    }

    this.renderer?.render(this.scene, this.camera);
  }

  private hopArc(t: number): number {
    return Math.sin(t * Math.PI) * 0.5;
  }

  setSpin(deg: number): void { this.spin = deg; }
  setZoom(z: number): void { this.zoomLevel = z; }
  setStretch(s: number): void { this.stretch = Math.min(1, Math.max(0, s)); }
  setFocus(f: number): void { this.camera.fov = 40 - 10 * (1 - f); this.camera.updateProjectionMatrix(); }
  hop(): void { this.hopT = 0; }
}
