import { el, focusFirstIn, openSheet, svgIcon } from '../dom';
import { hhmmss } from '../format';
import { clipStateCopy, status } from '../live';
import type { Clip } from '../../shared/types';

const STORAGE_DOWN_COPY = "The clip can't be loaded while clip storage is unreachable.";

/** The open clip sheet's repaint, so a clip becoming stored enables Play in place. */
let openClipId: string | null = null;
let repaintOpenClip: ((clip: Clip) => void) | null = null;

export function notifyClipSheets(clip: Clip): void {
  if (openClipId === clip.id) repaintOpenClip?.(clip);
}

export function openClipSheet(clip: Clip, opener: HTMLElement): void {
  const name = `Clip from ${clip.camera_name} at ${hhmmss(clip.recorded_at)}`;
  const sheet = openSheet({ name, opener, className: 'clip-sheet' });
  if (sheet.body.childElementCount > 0) {
    focusFirstIn(sheet);
    return;
  }

  const video = el('video', {
    class: 'clip-video',
    preload: 'none',
    controls: 'controls',
  }) as HTMLVideoElement;
  const stateLine = el('p', { class: 'clip-state' });
  const sizeLine = el('p', { class: 'clip-sizes num' });
  const alertSlot = el('div', { class: 'alert-slot' });
  const play = el('button', { type: 'button', class: 'control primary' }, [
    svgIcon('play'),
    el('span', {}, ['Play']),
  ]) as HTMLButtonElement;
  const closeButton = el('button', { type: 'button', class: 'control sheet-close' }, [
    svgIcon('x'),
    el('span', {}, ['Close']),
  ]);
  closeButton.addEventListener('click', () => {
    openClipId = null;
    repaintOpenClip = null;
    sheet.close();
  });

  play.addEventListener('click', () => {
    alertSlot.replaceChildren();
    if (status()?.services.storage === 'down') {
      alertSlot.replaceChildren(el('p', { class: 'alert', role: 'alert' }, [STORAGE_DOWN_COPY]));
      return;
    }
    video.src = `/api/clips/${clip.id}/media`;
    void video.play().catch(() => {
      alertSlot.replaceChildren(el('p', { class: 'alert', role: 'alert' }, [STORAGE_DOWN_COPY]));
    });
  });

  sheet.body.replaceChildren(
    el('h2', { class: 'sheet-heading' }, [name]),
    video,
    stateLine,
    sizeLine,
    alertSlot,
    el('div', { class: 'sheet-actions' }, [play]),
    closeButton,
  );

  const paint = (next: Clip): void => {
    stateLine.textContent = clipStateCopy(next);
    sizeLine.textContent = `Declared ${next.declared_size} bytes · Stored ${
      next.stored_size === null ? '0' : next.stored_size
    } bytes`;
    play.disabled = !next.playable;
  };

  paint(clip);
  openClipId = clip.id;
  repaintOpenClip = paint;
  focusFirstIn(sheet);
}
