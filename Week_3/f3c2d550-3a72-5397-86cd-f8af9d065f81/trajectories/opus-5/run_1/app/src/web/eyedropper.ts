import { element } from './dom.js';

/**
 * Eyedropper mode. The point is measured against the whole upright photo shown in the tile,
 * never against the cropped tile, so its fractions are the ones the API expects.
 */

export interface EyedropperHandle {
  close(): void;
}

export function openEyedropper(options: {
  photo: HTMLImageElement;
  container: HTMLElement;
  opener: HTMLElement;
  onPick: (x: number, y: number) => void;
  onClose: () => void;
  initial?: { x: number; y: number } | null;
}): EyedropperHandle {
  let x = options.initial?.x ?? 0.5;
  let y = options.initial?.y ?? 0.5;
  let closed = false;

  const crosshair = element('span', {
    class: 'crosshair',
    tabindex: '0',
    role: 'application',
    'aria-label': 'Swatch point',
  });
  const use = element('button', { type: 'button', class: 'action' }, ['Use this colour']);
  const cancel = element('button', { type: 'button', class: 'action quiet' }, [
    'Cancel eyedropper',
  ]);
  const group = element('div', { role: 'group', 'aria-label': 'Eyedropper', class: 'eyedropper' }, [
    crosshair,
    element('div', { class: 'eyedropper-actions' }, [use, cancel]),
  ]);

  function place(): void {
    const photoBox = options.photo.getBoundingClientRect();
    const hostBox = options.container.getBoundingClientRect();
    crosshair.style.left = `${photoBox.left - hostBox.left + x * photoBox.width}px`;
    crosshair.style.top = `${photoBox.top - hostBox.top + y * photoBox.height}px`;
  }

  function move(dx: number, dy: number): void {
    x = Math.min(1, Math.max(0, x + dx));
    y = Math.min(1, Math.max(0, y + dy));
    place();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    group.remove();
    options.photo.removeEventListener('pointerdown', onPhotoPointer);
    window.removeEventListener('resize', place);
    options.opener.focus();
    options.onClose();
  }

  function pick(): void {
    options.onPick(x, y);
    close();
  }

  function onPhotoPointer(event: PointerEvent): void {
    const box = options.photo.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    place();
    pick();
  }

  crosshair.addEventListener('keydown', (event) => {
    const stride = event.shiftKey ? 0.1 : 0.01;
    switch (event.key) {
      case 'ArrowLeft':
        move(-stride, 0);
        break;
      case 'ArrowRight':
        move(stride, 0);
        break;
      case 'ArrowUp':
        move(0, -stride);
        break;
      case 'ArrowDown':
        move(0, stride);
        break;
      case 'Enter':
        pick();
        break;
      case 'Escape':
        close();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  use.addEventListener('click', pick);
  cancel.addEventListener('click', close);
  options.photo.addEventListener('pointerdown', onPhotoPointer);
  window.addEventListener('resize', place);

  options.container.append(group);
  place();
  crosshair.focus();

  return { close };
}
