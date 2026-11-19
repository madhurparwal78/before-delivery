// The sprocket strip: sampling frames, scrubbing, and the pluck.

import type { Reference } from '../../shared/types.js';
import { api, announce, el } from '../lib.js';
import type { WallState } from './wall.js';
import { timecodeOf } from '../../shared/domain.js';
import { recalledTrayCluster } from './wall.js';

export class SprocketStrip {
  private state: WallState;
  private clip: Reference;
  private opener: HTMLElement;
  private node: HTMLElement;
  private timeline: HTMLElement;
  private framesWrap: HTMLElement;
  private playheadLine: HTMLElement;
  private slider: HTMLInputElement;
  private preview: HTMLCanvasElement;
  private timecodeEl: HTMLElement;
  private pluckBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private video: HTMLVideoElement;
  private totalFrames: number;
  private frameRate: number;
  private frameIndex = 0;
  private tiles: HTMLCanvasElement[] = [];
  private reducedMotion = false;

  constructor(state: WallState, clip: Reference, opener: HTMLElement) {
    this.state = state;
    this.clip = clip;
    this.opener = opener;
    this.totalFrames = clip.totalFrames ?? 1;
    this.frameRate = clip.frameRate ?? 25;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.node = el('section', { class: `strip ${this.reducedMotion ? '' : 'sprocket'}`, id: 'sprocket-strip', role: 'region', 'aria-label': 'Sprocket strip' });
    const head = el('div', { class: 'strip-head' });
    this.preview = el('canvas', { class: 'strip-preview', 'aria-label': 'Frame preview', role: 'img' }) as HTMLCanvasElement;
    this.preview.width = 296;
    this.preview.height = 168;
    this.timecodeEl = el('div', { class: 'strip-timecode mono', role: 'timer', 'aria-label': 'Timecode' }, this.timecodeOf(0));
    this.timeline = el('div', { class: 'strip-timeline', id: 'strip-timeline' });
    this.framesWrap = el('div', { class: 'strip-frames' });
    this.playheadLine = el('div', { class: 'playhead' });
    this.slider = el('input', {
      type: 'range',
      min: '0',
      max: String(this.totalFrames - 1),
      value: '0',
      step: '1',
      class: 'playhead-slider',
    }) as HTMLInputElement;
    this.slider.style.position = 'absolute';
    this.slider.style.left = '0';
    this.slider.style.width = '100%';
    this.slider.style.height = '100%';
    this.slider.style.opacity = '0';
    this.slider.style.margin = '0';
    this.slider.style.cursor = 'ew-resize';
    this.slider.style.touchAction = 'none';
    this.slider.setAttribute('role', 'slider');
    this.slider.setAttribute('aria-label', 'Playhead');
    this.slider.setAttribute('aria-valuemin', '0');
    this.slider.setAttribute('aria-valuemax', String(this.totalFrames - 1));
    this.slider.setAttribute('aria-valuenow', '0');
    this.slider.setAttribute('aria-valuetext', this.timecodeOf(0));
    this.timeline.append(this.framesWrap, this.playheadLine, this.slider);

    this.pluckBtn = el('button', { class: 'btn btn-primary', id: 'pluck-btn' }, 'Pluck');
    this.pluckBtn.setAttribute('aria-label', 'Pluck frame');
    this.closeBtn = el('button', { class: 'btn', id: 'close-clip' }, 'Close');
    this.closeBtn.setAttribute('aria-label', 'Close clip');

    head.append(this.preview, this.timecodeEl, this.pluckBtn, this.closeBtn);
    // The timeline (with the playhead slider) comes first in the DOM so the tab
    // order is playhead, Pluck, Close; CSS order puts the head visually on top.
    this.node.append(this.timeline, head);

    this.video = el('video', { src: clip.mediaUrl, preload: 'auto', muted: true, crossorigin: 'anonymous' }) as HTMLVideoElement;
    this.video.style.display = 'none';
    this.video.playsInline = true;
    this.node.append(this.video);

    // Scrubbing: pointer position maps to frame index.
    this.timeline.addEventListener('pointerdown', (e) => {
      this.timeline.setPointerCapture(e.pointerId);
      this.scrubTo(e.clientX);
    });
    this.timeline.addEventListener('pointermove', (e) => {
      if (e.buttons > 0 || this.timeline.hasPointerCapture(e.pointerId)) {
        this.scrubTo(e.clientX);
      }
    });
    this.timeline.addEventListener('pointerup', () => {
      // The playhead stops where released; no coasting.
    });
    this.timeline.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this.scrubTo(t.clientX);
    }, { passive: false });
    this.timeline.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this.scrubTo(t.clientX);
    }, { passive: false });

    this.slider.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? this.frameRate : 1;
      let handled = true;
      if (e.key === 'ArrowRight') this.setFrame(Math.min(this.totalFrames - 1, this.frameIndex + step));
      else if (e.key === 'ArrowLeft') this.setFrame(Math.max(0, this.frameIndex - step));
      else if (e.key === 'Home') this.setFrame(0);
      else if (e.key === 'End') this.setFrame(this.totalFrames - 1);
      else if (e.key === 'p' || e.key === 'P') {
        this.pluck();
      } else handled = false;
      if (handled) e.preventDefault();
    });
    this.node.addEventListener('keydown', (e) => {
      if ((e.key === 'p' || e.key === 'P') && document.activeElement !== this.slider) {
        e.preventDefault();
        this.pluck();
      }
    });
    const escapeClose = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    this.slider.addEventListener('keydown', escapeClose);
    this.timeline.addEventListener('keydown', escapeClose);

    this.pluckBtn.addEventListener('click', () => this.pluck());
    this.closeBtn.addEventListener('click', () => this.close());

    // Sample the tiles once the video can seek.
    this.video.addEventListener('loadeddata', () => {
      void this.sample();
    });
    this.video.addEventListener('seeked', () => {
      this.drawCurrentFrame();
    });
  }

  open(): void {
    this.state.strip = this;
    // The strip docks inside the layout between the wall and the tray, so the
    // tab order is wall cards, then playhead, Pluck, Close, then the tray.
    const layout = document.querySelector('.wall-layout');
    const tray = layout?.querySelector('.tray');
    if (layout && tray) {
      layout.insertBefore(this.node, tray);
    } else {
      document.querySelector('main')?.append(this.node);
    }
    this.slider.focus();
    void this.sample();
  }

  close(): void {
    this.node.remove();
    if (this.state.strip === this) this.state.strip = null;
    this.opener.focus();
  }

  private timecodeOf(index: number): string {
    return timecodeOf(index, this.frameRate);
  }

  private frameTime(index: number): number {
    return index / this.frameRate;
  }

  private scrubTo(clientX: number): void {
    const rect = this.timeline.getBoundingClientRect();
    const w = rect.width;
    if (w <= 0) return;
    const x = clientX - rect.left;
    const index = Math.min(this.totalFrames - 1, Math.max(0, Math.floor((x / w) * this.totalFrames)));
    this.setFrame(index);
  }

  setFrame(index: number): void {
    this.frameIndex = index;
    this.video.currentTime = Math.min(Math.max(this.frameTime(index), 0), Math.max(0, (this.video.duration || 0) - 0.001));
    this.updateReadouts();
    this.drawCurrentFrame();
  }

  private updateReadouts(): void {
    const tc = this.timecodeOf(this.frameIndex);
    this.timecodeEl.textContent = tc;
    this.slider.value = String(this.frameIndex);
    this.slider.setAttribute('aria-valuenow', String(this.frameIndex));
    this.slider.setAttribute('aria-valuetext', tc);
    const rect = this.timeline.getBoundingClientRect();
    const pct = this.totalFrames > 1 ? this.frameIndex / (this.totalFrames - 1) : 0;
    this.playheadLine.style.left = `${pct * 100}%`;
    this.tiles.forEach((tile, i) => {
      tile.classList.toggle('current', i === this.frameIndex);
    });
  }

  private async sample(): Promise<void> {
    if (!this.video.videoWidth) {
      // wait for data
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        this.video.addEventListener('loadeddata', done, { once: true });
        setTimeout(done, 800);
      });
    }
    const rect = this.timeline.getBoundingClientRect();
    const width = rect.width || 600;
    // As many evenly spaced frames as fit, at least 8, at most totalFrames.
    let count = Math.floor(width / 64);
    count = Math.max(8, count);
    count = Math.min(count, this.totalFrames);
    this.tiles = [];
    this.framesWrap.replaceChildren();
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const idx = count === 1 ? 0 : Math.round((i / (count - 1)) * (this.totalFrames - 1));
      indices.push(idx);
    }
    for (const idx of indices) {
      const canvas = el('canvas', { class: 'strip-frame' }) as HTMLCanvasElement;
      canvas.width = 160;
      canvas.height = 90;
      this.tiles.push(canvas);
      this.framesWrap.append(canvas);
      await this.seekAndDraw(canvas, idx);
    }
    this.updateReadouts();
    this.drawCurrentFrame();
  }

  resample(): void {
    void this.sample();
  }

  private async seekAndDraw(canvas: HTMLCanvasElement, index: number): Promise<void> {
    const time = this.frameTime(index);
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        this.video.removeEventListener('seeked', onSeeked);
      };
      this.video.addEventListener('seeked', onSeeked);
      try {
        this.video.currentTime = time;
      } catch {
        cleanup();
        resolve();
      }
      setTimeout(() => {
        cleanup();
        resolve();
      }, 500);
    });
    const ctx = canvas.getContext('2d');
    if (ctx && this.video.videoWidth) {
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    }
  }

  private drawCurrentFrame(): void {
    const ctx = this.preview.getContext('2d');
    if (ctx && this.video.videoWidth) {
      ctx.drawImage(this.video, 0, 0, this.preview.width, this.preview.height);
    }
  }

  async pluck(): Promise<void> {
    const clusterId = recalledTrayCluster();
    if (!clusterId) {
      announce('tray-announcements', 'Choose a cluster in the tray before plucking.');
      return;
    }
    // Capture the frame at full resolution.
    const canvas = el('canvas') as HTMLCanvasElement;
    canvas.width = this.video.videoWidth || 320;
    canvas.height = this.video.videoHeight || 180;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      announce('tray-announcements', 'Storage is unreachable. Frame 00:00:00:00 was not saved and the cluster is unchanged.');
      return;
    }
    const frameIndex = this.frameIndex;
    const tc = this.timecodeOf(frameIndex);
    announce('tray-announcements', `Saving frame ${tc}...`);
    this.pluckBtn.disabled = true;
    const form = new FormData();
    form.append('still', blob, `still-${frameIndex}.png`);
    form.append('frameIndex', String(frameIndex));
    form.append('clusterId', clusterId);
    const r = await api<{ reference: Reference; entry: { id: string; position: number }; cluster: { id: string; itemCount: number } }>(
      'POST',
      `/api/workspaces/${this.state.slug}/clips/${this.clip.id}/stills`,
      form,
    );
    this.pluckBtn.disabled = false;
    if (r.ok && r.data) {
      announce('tray-announcements', `Plucked ${tc} from ${this.clip.title}. ${r.data.cluster.itemCount} items.`);
      window.dispatchEvent(new CustomEvent('rushes:cluster-updated', { detail: { clusterId } }));
      this.focusPlayhead();
      return;
    }
    const err = r.error;
    if (err?.error === 'cluster_locked') {
      announce('tray-announcements', `The active cluster is locked and cannot take new items.`);
    } else if (err?.error === 'storage_unavailable') {
      announce('tray-announcements', `Storage is unreachable. Frame ${tc} was not saved and the cluster is unchanged.`);
    } else if (err?.error === 'seat_required') {
      announce('wall-announcements', 'You need a pro seat to make changes. Ask your design ops lead.');
    } else {
      announce('tray-announcements', `Storage is unreachable. Frame ${tc} was not saved and the cluster is unchanged.`);
    }
    this.focusPlayhead();
  }

  focusPlayhead(): void {
    this.slider.focus();
  }
}
