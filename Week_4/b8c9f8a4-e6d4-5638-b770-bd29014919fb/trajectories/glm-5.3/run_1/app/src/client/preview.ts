/** Owner stage preview: the same scene and camera rule as the buyer stage, writing nothing. */
import * as THREE from 'three';
import { panelPoint, type PanelId } from './panels.js';
import { buildScene, cameraFor, restingCamera, viewProjectionString } from './stage.js';

export interface PreviewOptions {
  findings: () => { id: string; panelId: PanelId; u: number; v: number; position: number; severity: string; seen: boolean }[];
  heroId: () => string | null;
  unsavedPin: () => { panelId: PanelId; u: number; v: number } | null;
  openAdvisories: () => number;
}

export function mountPreview(container: HTMLElement, opts: PreviewOptions): void {
  let renderer: THREE.WebGLRenderer | null = null;
  let frameCount = 0;
  let lastKey = '';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16121f);
  const built = buildScene();
  scene.add(built.group);
  scene.add(built.markerGroup);

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (gl) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(3, window.devicePixelRatio || 1));
      container.replaceChildren(renderer.domElement);
    }
  } catch { renderer = null; }

  const draw = (): void => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const findings = opts.findings();
    const pin = opts.unsavedPin();
    const open = opts.openAdvisories();
    const heroId = opts.heroId();
    const active = pin ?? (findings.find(f => f.id === heroId) ?? null);
    const key = `${pin ? 'pin' : active?.id ?? 'none'}|${width}x${height}|${open}`;
    if (key === lastKey) return;
    lastKey = key;
    if (!active || !renderer) {
      container.dataset.renderer = renderer ? 'webgl' : 'svg';
      container.dataset.panel = '';
      container.dataset.anchor = '';
      container.dataset.frameCount = String(frameCount);
      container.dataset.openAdvisories = String(open);
      if (!active && renderer) {
        const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
        camera.position.set(0, 2.6, 7.2);
        camera.lookAt(0, 1, 0);
        camera.updateMatrixWorld();
        renderer.setSize(width, height, false);
        for (const meshes of built.panelMeshes.values()) {
          for (const mesh of meshes) {
            const material = (mesh as THREE.Mesh).material as THREE.Material & { color?: THREE.Color; opacity?: number };
            if (material && 'color' in material && material.color) material.color.set(0x2c2740);
          }
        }
        renderer.render(scene, camera);
        frameCount += 1;
        container.dataset.viewProjection = viewProjectionString(camera);
        container.dataset.cameraPosition = camera.position.toArray().map(n => n.toFixed(3)).join(',');
      }
      return;
    }
    const world = panelPoint(active.panelId, active.u, active.v);
    const pose = restingCamera(world, width / height);
    const { camera } = cameraFor(pose, width / height);
    renderer.setSize(width, height, false);
    for (const [panelId, meshes] of built.panelMeshes) {
      const isCurrent = panelId === active.panelId;
      for (const mesh of meshes) {
        const material = (mesh as THREE.Mesh).material as THREE.Material & { color?: THREE.Color; opacity?: number };
        if (material && 'color' in material && material.color) {
          material.color.set(isCurrent ? 0x9aa8f2 : 0x5a63b0);
          material.opacity = isCurrent ? 1 : 0.85;
          material.transparent = true;
        }
      }
    }
    // Every marker is a hollow ring here.
    built.markerGroup.clear();
    const ringGeo = new THREE.RingGeometry(0.1, 0.13, 20);
    const coreGeo = new THREE.CircleGeometry(0.045, 14);
    for (const f of findings) {
      const w = panelPoint(f.panelId, f.u, f.v);
      const group = new THREE.Group();
      group.position.set(w[0], w[1], w[2]);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xdfe7ff, side: THREE.DoubleSide }));
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0x0c0816 }));
      core.position.z = 0.01;
      group.add(ring); group.add(core);
      const distance = camera.position.distanceTo(new THREE.Vector3(w[0], w[1], w[2]));
      group.scale.setScalar(distance * 0.028);
      group.lookAt(camera.position);
      built.markerGroup.add(group);
    }
    renderer.render(scene, camera);
    frameCount += 1;
    container.dataset.renderer = 'webgl';
    container.dataset.panel = active.panelId;
    container.dataset.anchor = `${active.u.toFixed(3)},${active.v.toFixed(3)}`;
    container.dataset.frameCount = String(frameCount);
    container.dataset.openAdvisories = String(open);
    container.dataset.viewProjection = viewProjectionString(camera);
    container.dataset.cameraPosition = camera.position.toArray().map(n => n.toFixed(3)).join(',');
  };

  draw();
  window.addEventListener('resize', () => { lastKey = ''; draw(); });
  const poller = setInterval(draw, 500);
  window.addEventListener('beforeunload', () => clearInterval(poller));
}
