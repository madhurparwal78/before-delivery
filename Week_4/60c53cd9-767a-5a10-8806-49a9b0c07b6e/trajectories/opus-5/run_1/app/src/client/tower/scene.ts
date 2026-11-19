/**
 * The 3D tower stage: a two-tone shell with a hard edge between light and shade,
 * an orthographic camera that only orbits and climbs, and no idle motion.
 */

import {
  BufferGeometry,
  Group,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { LOWEST_FLOOR } from '../../shared/units';

/** The shell is built with one storey per unit of height, two of them podium. */
const STOREY_HEIGHT = 1;
const PODIUM_STOREYS = 2;
const CAMERA_DISTANCE = 90;
const SHELL_RADIUS = 10;
/** The podium is the widest part of the shell, so the frustum must clear it. */
const PODIUM_RADIUS = 12.5;
const FACE_HALF_WIDTH = SHELL_RADIUS * Math.sin(Math.PI / 8);

export interface ProjectedCell {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

const VERTEX_SHADER = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `
varying vec3 vNormal;
uniform vec3 lightColour;
uniform vec3 shadeColour;
uniform vec3 lightDirection;
void main() {
  float lit = dot(normalize(vNormal), normalize(lightDirection));
  gl_FragColor = vec4(lit > 0.35 ? lightColour : shadeColour, 1.0);
}`;

export function floorToModelY(floor: number): number {
  return (PODIUM_STOREYS + (floor - LOWEST_FLOOR)) * STOREY_HEIGHT;
}

export function directionFor(bearingDegrees: number): Vector3 {
  const radians = (bearingDegrees * Math.PI) / 180;
  return new Vector3(Math.sin(radians), 0, -Math.cos(radians));
}

export class TowerScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly material: ShaderMaterial;
  private readonly shellGroup = new Group();
  private bearing = 214;
  private cameraFloor = 20;
  private width = 1;
  private height = 1;
  private readonly observer: ResizeObserver;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly onContextLost: () => void,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new OrthographicCamera(-20, 20, 20, -20, 0.1, 500);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        lightColour: { value: new Vector3(1, 1, 1) },
        shadeColour: { value: new Vector3(0.13, 0.16, 0.6) },
        lightDirection: { value: new Vector3(0.6, 0.5, 0.62) },
      },
    });
    this.scene.add(this.shellGroup);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.onContextLost();
    });
    // The stage is laid out by CSS, so the frustum follows the canvas box.
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  static create(canvas: HTMLCanvasElement, onContextLost: () => void): TowerScene | null {
    try {
      return new TowerScene(canvas, onContextLost);
    } catch {
      return null;
    }
  }

  async loadShell(url: string): Promise<void> {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(url);
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const geometry = node.geometry as BufferGeometry;
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      flat.computeVertexNormals();
      node.geometry = flat;
      node.material = this.material;
    });
    this.shellGroup.clear();
    this.shellGroup.add(gltf.scene);
    draco.dispose();
    this.render();
  }

  /** The two field colours the tower is drawn in; they invert between bands. */
  setColours(light: [number, number, number], shade: [number, number, number]): void {
    (this.material.uniforms.lightColour.value as Vector3).set(...light);
    (this.material.uniforms.shadeColour.value as Vector3).set(...shade);
    this.render();
  }

  setBearing(bearing: number): void {
    this.bearing = ((bearing % 360) + 360) % 360;
    this.render();
  }

  getBearing(): number {
    return this.bearing;
  }

  setCameraFloor(floor: number): void {
    this.cameraFloor = floor;
    this.render();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(this.width, this.height, false);
    // The frustum always covers the whole tower, however narrow the stage is.
    const halfHeight = Math.max(20 * STOREY_HEIGHT, PODIUM_RADIUS * 1.2 * (this.height / this.width));
    const halfWidth = halfHeight * (this.width / this.height);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private placeCamera(): void {
    const height = floorToModelY(this.cameraFloor);
    const direction = directionFor(this.bearing).multiplyScalar(CAMERA_DISTANCE);
    this.camera.position.set(direction.x, height, direction.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, height, 0);
    this.camera.updateMatrixWorld();
  }

  render(): void {
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  /** Where a unit's cell sits on screen, and whether its face is turned towards us. */
  projectCell(bearing: number, floor: number): ProjectedCell {
    this.placeCamera();
    const outward = directionFor(bearing);
    const tangent = new Vector3(outward.z, 0, -outward.x);
    const centre = outward.clone().multiplyScalar(SHELL_RADIUS * 1.001);
    centre.y = floorToModelY(floor) + STOREY_HEIGHT * 0.5;
    const left = centre.clone().addScaledVector(tangent, -FACE_HALF_WIDTH * 0.84);
    const right = centre.clone().addScaledVector(tangent, FACE_HALF_WIDTH * 0.84);
    const top = centre.clone();
    top.y += STOREY_HEIGHT * 0.38;
    const bottom = centre.clone();
    bottom.y -= STOREY_HEIGHT * 0.38;
    const toScreen = (point: Vector3): { x: number; y: number } => {
      const projected = point.clone().project(this.camera);
      return {
        x: ((projected.x + 1) / 2) * this.width,
        y: ((1 - projected.y) / 2) * this.height,
      };
    };
    const leftPoint = toScreen(left);
    const rightPoint = toScreen(right);
    const topPoint = toScreen(top);
    const bottomPoint = toScreen(bottom);
    const cameraBearing = this.bearing;
    const difference = Math.abs(((bearing - cameraBearing + 540) % 360) - 180);
    return {
      x: Math.min(leftPoint.x, rightPoint.x),
      y: topPoint.y,
      width: Math.abs(rightPoint.x - leftPoint.x),
      height: Math.abs(bottomPoint.y - topPoint.y),
      visible: difference <= 67.5,
    };
  }

  dispose(): void {
    this.observer.disconnect();
    this.renderer.dispose();
  }
}
