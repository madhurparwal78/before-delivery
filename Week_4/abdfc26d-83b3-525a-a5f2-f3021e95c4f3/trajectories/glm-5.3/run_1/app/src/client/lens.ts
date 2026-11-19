import { startPieceCanvas, type CanvasHandle } from './canvas.js';
import { prefersReducedMotion } from './motion.js';
import { api, freshIdempotencyKey, type OrderJson, type PieceJson } from './api.js';

export interface EditionInfo {
  number: number;
  status: 'available' | 'held' | 'collected';
  held_by_you: boolean;
  seed_hash: string;
}

export interface LensCallbacks {
  onHoldGranted(order: OrderJson): void;
  onHoldExpired(n: number): void;
  onTaken(n: number, next: number | null): void;
  announce(text: string): void;
}

/**
 * Edition Lens: maps pointer position to edition N, renders N's seed
 * variation inside the lens, follows the slider contract for keyboard and
 * touch, and asks for a hold on Enter, click or tap.
 */
export class EditionLens {
  private n = 14;
  private m: number;
  private handle: CanvasHandle | null = null;
  private lens: HTMLElement;
  private lensCanvasHost: HTMLElement;
  private numeral: HTMLElement;
  private caption: HTMLElement;
  private slider: HTMLInputElement;
  private target = { x: 0, y: 0 };
  private pos = { x: 0, y: 0 };
  private followTimer = 0;
  private locked = false;
  private editions: EditionInfo[] = [];
  private moved = false;

  constructor(
    private stage: HTMLElement,
    private piece: PieceJson,
    private callbacks: LensCallbacks
  ) {
    this.m = piece.edition_count ?? 1;
    this.lens = stage.querySelector<HTMLElement>('.edition-lens')!;
    this.lensCanvasHost = stage.querySelector<HTMLElement>('.lens-canvas')!;
    this.numeral = stage.querySelector<HTMLElement>('.hero-numeral')!;
    this.caption = stage.querySelector<HTMLElement>('.hero-caption')!;
    this.slider = stage.querySelector<HTMLInputElement>('input[type="range"]')!;
    this.slider.min = '1';
    this.slider.max = String(this.m);
    this.slider.value = String(this.n);
    this.bind();
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const result = await api<{ edition_count: number; editions: EditionInfo[] }>('GET', `/api/pieces/${this.piece.slug}/editions`);
    if (!result.ok) return;
    const body = result.body as { edition_count: number; editions: EditionInfo[] };
    this.editions = body.editions;
    if (!this.locked && !this.moved) this.applyEdition(this.n);
    else this.applyEdition(this.n);
  }

  current(): number {
    return this.n;
  }

  editionsList(): EditionInfo[] {
    return this.editions;
  }

  moveBy(delta: number): void {
    this.setN(this.n + delta);
  }

  home(): void {
    this.setN(1);
  }

  end(): void {
    this.setN(this.m);
  }

  setN(n: number): void {
    const clamped = Math.min(this.m, Math.max(1, n));
    this.locked = false;
    this.applyEdition(clamped);
    this.updateUrl();
  }

  private applyEdition(n: number): void {
    this.n = n;
    const info = this.editions.find((e) => e.number === n);
    const status = info?.status ?? 'available';
    this.slider.value = String(n);
    this.slider.setAttribute('aria-valuenow', String(n));
    this.slider.setAttribute('aria-valuetext', `Edition ${n} of ${this.m}, ${status === 'held' && !info?.held_by_you ? 'held' : status}`);
    this.numeral.textContent = String(n);
    this.numeral.classList.add('jump');
    window.setTimeout(() => this.numeral.classList.remove('jump'), 160);
    const captionBase = `of ${this.m} · `;
    this.caption.textContent = this.moved ? `${captionBase}${status}` : `${captionBase}move to choose`;
    this.lens.dataset.ring = info ? (info.status === 'held' && !info.held_by_you ? 'held-by-other' : info.status) : 'available';
    this.handle?.setSeed(seedUnit(info?.seed_hash ?? seedHash(this.piece.slug, n)));
  }

  private updateUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('edition', String(this.n));
    window.history.replaceState(null, '', url);
  }

  private bind(): void {
    this.handle = startPieceCanvas(this.lensCanvasHost, this.piece, {});
    const pointerMove = (event: PointerEvent): void => {
      if (this.locked) return;
      const rect = this.stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      this.target = { x, y };
      const frac = Math.min(1, Math.max(0, x / rect.width));
      const n = Math.round(frac * (this.m - 1)) + 1;
      if (n !== this.n) {
        this.moved = true;
        this.applyEdition(n);
        this.updateUrl();
      }
      if (!prefersReducedMotion()) this.follow();
    };
    this.stage.addEventListener('pointermove', pointerMove);
    this.stage.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') {
        pointerMove(event);
        return;
      }
      void this.requestHold();
    });
    this.stage.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'touch') void this.requestHold();
    });

    this.slider.addEventListener('input', () => {
      this.moved = true;
      this.applyEdition(Number(this.slider.value));
      this.updateUrl();
    });
    this.slider.addEventListener('keydown', (event) => {
      const key = event.key;
      let handled = true;
      if (key === 'ArrowRight' || key === 'ArrowUp') this.moveBy(1);
      else if (key === 'ArrowLeft' || key === 'ArrowDown') this.moveBy(-1);
      else if (key === 'PageDown') this.moveBy(10);
      else if (key === 'PageUp') this.moveBy(-10);
      else if (key === 'Home') this.home();
      else if (key === 'End') this.end();
      else if (key === 'Enter') void this.requestHold();
      else handled = false;
      if (handled) {
        event.preventDefault();
        this.updateUrl();
      }
    });
  }

  private follow(): void {
    if (this.followTimer) return;
    const step = (): void => {
      const lensRect = this.lens.getBoundingClientRect();
      const stageRect = this.stage.getBoundingClientRect();
      const cx = lensRect.left - stageRect.left + lensRect.width / 2;
      const cy = lensRect.top - stageRect.top + lensRect.height / 2;
      const dx = this.target.x - cx;
      const dy = this.target.y - cy;
      this.pos = { x: cx + dx * 0.22, y: cy + dy * 0.22 };
      this.lens.style.transform = `translate(${this.pos.x - lensRect.width / 2}px, ${this.pos.y - lensRect.height / 2}px)`;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
        this.followTimer = 0;
        return;
      }
      this.followTimer = window.requestAnimationFrame(step);
    };
    this.followTimer = window.requestAnimationFrame(step);
  }

  lockOnHold(): void {
    this.locked = true;
    this.lens.dataset.ring = 'held';
  }

  unlock(): void {
    this.locked = false;
  }

  glideTo(n: number): void {
    this.applyEdition(n);
    this.updateUrl();
  }

  async requestHold(): Promise<void> {
    const signedIn = document.body.dataset.signedIn === 'true';
    if (!signedIn) {
      window.location.href = `/auth/login?return_to=${encodeURIComponent(new URL(window.location.href).pathname + `?edition=${this.n}`)}`;
      return;
    }
    const result = await api<OrderJson>('POST', `/api/pieces/${this.piece.slug}/editions/${this.n}/holds`, {}, { idempotencyKey: freshIdempotencyKey() });
    if (result.ok) {
      const order = result.body as OrderJson;
      this.lockOnHold();
      this.callbacks.onHoldGranted(order);
      return;
    }
    const body = result.body as { error: { code: string; next_free?: number | null } };
    if (body.error?.code === 'edition_taken') {
      const next = body.error.next_free ?? null;
      this.callbacks.onTaken(this.n, next);
      if (next !== null) this.glideTo(next);
      else this.callbacks.announce(`Every edition of this run is taken.`);
      return;
    }
    if (body.error?.code === 'own_piece') {
      this.callbacks.announce(`Only collector accounts can hold editions of their own pieces.`);
    }
  }

  restoreFromUrl(): void {
    const params = new URL(window.location.href).searchParams;
    const fromUrl = Number(params.get('edition'));
    if (Number.isInteger(fromUrl) && fromUrl >= 1 && fromUrl <= this.m) {
      this.moved = true;
      this.applyEdition(fromUrl);
    }
  }

  focusSlider(): void {
    this.slider.focus();
  }
}

export function seedHash(slug: string, n: number): string {
  // Mirrors the server's seed rule; used only before the edition list loads.
  let hash = 0;
  const text = `${slug}:${n}`;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
}

function seedUnit(hash: string): number {
  return Number.parseInt(hash.slice(0, 8), 16) / 4294967295;
}
