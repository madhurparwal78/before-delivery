import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildHero, type HeroLook } from './hero.js';
import { inkMote, levelProps } from './level.js';
import { MOTE_LAYOUT } from '../../shared/constants.js';

/**
 * The sketchbook world behind screens that have no scene of their own: the player's hero at the
 * spawn with the chapter's motes and gate. It is still, so it renders only when the viewport changes.
 */
export class Backdrop {
  private readonly renderer: WebGLRenderer | null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.1, 100);
  private readonly onResize = (): void => this.render();

  constructor(host: HTMLElement, look: HeroLook) {
    let renderer: WebGLRenderer | null = null;
    try {
      // A still frame, kept after compositing because it is drawn only on resize.
      renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
    if (renderer === null) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.className = 'backdrop-canvas';
    host.append(renderer.domElement);

    this.scene.add(new AmbientLight(0xffffff, 0.95));
    const sun = new DirectionalLight(0xffffff, 0.7);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);
    this.scene.add(levelProps().group);
    for (const mote of MOTE_LAYOUT) {
      const mesh = inkMote();
      mesh.position.x = mote.x;
      mesh.position.z = mote.z;
      this.scene.add(mesh);
    }
    this.scene.add(buildHero(look).group);
    // Seen from high and far, so the hero and the chapter sit low and to the right of the page.
    this.camera.position.set(-6, 5, 12);
    this.camera.lookAt(new Vector3(-3, 1.6, -2));
    window.addEventListener('resize', this.onResize);
    this.render();
  }

  private render(): void {
    if (this.renderer === null) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    if (this.renderer === null) return;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
