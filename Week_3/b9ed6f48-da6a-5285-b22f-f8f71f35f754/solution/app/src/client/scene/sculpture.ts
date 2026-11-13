// The WebGL sightline sculpture (brief: Motion › Sightline sculpture, Idle motion, Resolution).
// One instanced mesh of procedural shards; the camera orbits by yaw; the cloud sways ±1.6°
// about its own axis every 16 s while visible; settling springs every shard onto the text plane
// in under a second with a slight overshoot. The animation loop keeps at most a few frames queued
// on the GPU, so a slow (software) GPU never builds a backlog that delays the next page.

import * as THREE from "three";
import { cameraAt, fovFor, shardPosition, type ShardModel } from "./shardModel.js";

const SWAY_DEG = 1.6;
const SWAY_PERIOD_MS = 16_000;
const SETTLE_MS = 900;
/** Frames the loop may have queued on the GPU before it waits for the oldest to finish. */
const FRAMES_IN_FLIGHT = 8;
const GROUND = 0x0e0f0b;
const INK = new THREE.Color(0xece4d2);

/** A damped spring from 0 to 1: ζ = 0.75 overshoots under 3% and is at rest by 900 ms. */
function spring(ms: number): number {
  const zeta = 0.75;
  const omega = 7.2;
  const t = ms / 1000;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
}

export class Sculpture {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
  private readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private yaw = -60;
  private progress = 0;
  private settleStart: number | null = null;
  private frame = 0;
  private visible = true;
  private swayOn = true;
  /** A frame the loop still owes the canvas because the GPU was busy. */
  private dirty = false;
  /** One fence per queued frame, oldest first. */
  private readonly inFlight: WebGLSync[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly model: ShardModel,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(GROUND, 1);
    this.scene.fog = new THREE.Fog(GROUND, 5.2, 11.5);
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: true });
    this.mesh = new THREE.InstancedMesh(shape, material, model.count);
    const color = new THREE.Color();
    for (let i = 0; i < model.count; i++) this.mesh.setColorAt(i, color.copy(INK).multiplyScalar(model.shade[i]));
    this.group.add(this.mesh);
    this.scene.add(this.group);
    this.place();
    document.addEventListener("visibilitychange", this.wake);
  }

  /** Writes every shard's instance matrix for the current settle progress. */
  private place(): void {
    const m = this.model;
    const e = this.matrix.elements;
    for (let i = 0; i < m.count; i++) {
      const p = shardPosition(m, i, this.progress);
      const ax = m.edges[i * 4] * p.scale;
      const ay = m.edges[i * 4 + 1] * p.scale;
      const bx = m.edges[i * 4 + 2] * p.scale;
      const by = m.edges[i * 4 + 3] * p.scale;
      // Columns: edge a, edge b, a hair of thickness along the normal, then the position.
      e[0] = ax * m.right[0] + ay * m.up[0];
      e[1] = ax * m.right[1] + ay * m.up[1];
      e[2] = ax * m.right[2] + ay * m.up[2];
      e[4] = bx * m.right[0] + by * m.up[0];
      e[5] = bx * m.right[1] + by * m.up[1];
      e[6] = bx * m.right[2] + by * m.up[2];
      e[8] = m.eye[0] * 0.001;
      e[9] = 0;
      e[10] = m.eye[2] * 0.001;
      e[12] = p.x;
      e[13] = p.y;
      e[14] = p.z;
      e[3] = e[7] = e[11] = 0;
      e[15] = 1;
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = fovFor(width / height);
    this.camera.updateProjectionMatrix();
    this.render();
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.wake();
  }

  setSway(on: boolean): void {
    this.swayOn = on;
    this.wake();
  }

  /** Springs the shards onto the text plane; `at once` places them there directly. */
  settle(atOnce: boolean): void {
    if (this.progress === 1 || this.settleStart !== null) return;
    if (atOnce) {
      this.progress = 1;
      this.place();
      this.render();
      return;
    }
    this.settleStart = performance.now();
    this.wake();
  }

  private render(): void {
    const [x, y, z] = cameraAt(this.yaw);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
    const gl = this.renderer.getContext();
    if (gl instanceof WebGL2RenderingContext) {
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (fence) this.inFlight.push(fence);
    }
  }

  /** Drops the frames the GPU has finished; true while the queue is still full. */
  private gpuBusy(): boolean {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    while (this.inFlight.length && gl.getSyncParameter(this.inFlight[0], gl.SYNC_STATUS) === gl.SIGNALED) gl.deleteSync(this.inFlight.shift() as WebGLSync);
    return this.inFlight.length >= FRAMES_IN_FLIGHT;
  }

  private readonly wake = (): void => {
    if (!this.frame && this.visible && !document.hidden) this.frame = requestAnimationFrame(this.tick);
  };

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (this.settleStart !== null) {
      const elapsed = now - this.settleStart;
      this.progress = elapsed >= SETTLE_MS ? 1 : spring(elapsed);
      if (elapsed >= SETTLE_MS) this.settleStart = null;
      this.place();
    }
    this.group.rotation.y = this.swayOn ? ((SWAY_DEG * Math.PI) / 180) * Math.sin((2 * Math.PI * now) / SWAY_PERIOD_MS) : 0;
    if (this.gpuBusy()) this.dirty = true;
    else this.render();
    if ((this.swayOn || this.settleStart !== null || this.dirty) && this.visible && !document.hidden) this.frame = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    cancelAnimationFrame(this.frame);
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.inFlight.forEach((fence) => gl.deleteSync(fence));
    document.removeEventListener("visibilitychange", this.wake);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}

/** True when this browser can create a WebGL context. */
export function webglAvailable(): boolean {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}
