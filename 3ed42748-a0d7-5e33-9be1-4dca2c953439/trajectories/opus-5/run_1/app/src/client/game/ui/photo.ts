import { el } from '../../shared/dom.js';
import { paperGround } from '../../shared/paper.js';
import { trapTab } from '../../shared/dom.js';
import { copy } from '../copy.js';
import type { Scene } from '../scene.js';

export interface PhotoHooks {
  onCapture: () => void;
  onLeave: () => void;
}

/**
 * The photo-mode frame: a paper strip top and bottom, with a see-through centre so the planet
 * stays visible while the photo camera is framed.
 */
export class PhotoMode {
  readonly root: HTMLElement;
  readonly take: HTMLButtonElement;
  readonly leave: HTMLButtonElement;
  readonly status: HTMLElement;
  private darkroomOpen = true;
  private signedIn = false;
  private pinchStart: { distance: number; fov: number } | null = null;
  private dragFrom: number | null = null;

  constructor(
    private readonly scene: Scene,
    hooks: PhotoHooks,
  ) {
    this.take = el('button', { type: 'button', class: 'primary' }, ['Take postcard']);
    this.leave = el('button', { type: 'button' }, ['Leave photo mode']);
    this.status = el(
      'div',
      { role: 'status', 'aria-label': 'Darkroom', class: 'darkroom-status' },
      [copy.darkroomOpen],
    );
    const top = el('div', { class: 'photo-strip photo-top perforated' }, [this.status]);
    const bottom = el('div', { class: 'photo-strip photo-bottom perforated' }, [
      this.take,
      this.leave,
    ]);
    paperGround(top);
    paperGround(bottom);
    this.root = el(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Photo mode',
        class: 'photo-mode',
        hidden: true,
      },
      [top, el('div', { class: 'photo-window' }), bottom],
    );
    this.take.addEventListener('click', () => hooks.onCapture());
    this.leave.addEventListener('click', () => hooks.onLeave());
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        hooks.onLeave();
        return;
      }
      if (this.framing(event)) {
        event.preventDefault();
        return;
      }
      trapTab(this.root, event);
    });
    this.root.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.scene.zoomPhoto(event.deltaY < 0 ? -5 : 5);
      },
      { passive: false },
    );
    this.listenToDrags();
  }

  private framing(event: KeyboardEvent): boolean {
    switch (event.key) {
      case 'ArrowRight':
        this.scene.turnPhoto(15);
        return true;
      case 'ArrowLeft':
        this.scene.turnPhoto(-15);
        return true;
      case 'ArrowUp':
        this.scene.zoomPhoto(-5);
        return true;
      case 'ArrowDown':
        this.scene.zoomPhoto(5);
        return true;
      default:
        return false;
    }
  }

  /** Dragging swings the camera by a degree every four pixels; pinching sets the field of view. */
  private listenToDrags(): void {
    const touches = new Map<number, { x: number; y: number }>();
    const window2 = this.root;
    window2.addEventListener('pointerdown', (event) => {
      if (event.target !== window2 && !(event.target as HTMLElement).classList.contains('photo-window')) {
        return;
      }
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 1) this.dragFrom = event.clientX;
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        this.pinchStart = {
          distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          fov: this.scene.photoFov,
        };
      }
    });
    window2.addEventListener('pointermove', (event) => {
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2 && this.pinchStart !== null) {
        const [a, b] = [...touches.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
        this.scene.setPhotoFov((this.pinchStart.fov * this.pinchStart.distance) / distance);
        return;
      }
      if (this.dragFrom !== null) {
        const steps = Math.trunc((event.clientX - this.dragFrom) / 4);
        if (steps !== 0) {
          this.scene.turnPhoto(steps);
          this.dragFrom += steps * 4;
        }
      }
    });
    for (const ending of ['pointerup', 'pointercancel'] as const) {
      window2.addEventListener(ending, (event) => {
        touches.delete(event.pointerId);
        if (touches.size < 2) this.pinchStart = null;
        if (touches.size === 0) this.dragFrom = null;
      });
    }
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(signedIn: boolean): void {
    this.signedIn = signedIn;
    this.root.hidden = false;
    this.refreshShutter();
    this.take.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }

  setDarkroom(open: boolean): void {
    this.darkroomOpen = open;
    this.status.textContent = open ? copy.darkroomOpen : copy.postcard.darkroomClosed;
    this.refreshShutter();
  }

  private refreshShutter(): void {
    this.take.disabled = !this.darkroomOpen || !this.signedIn;
  }
}
