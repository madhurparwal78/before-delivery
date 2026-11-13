import { copy } from '../../shared/copy';
import { el } from '../dom';
import { ditherCanvas } from '../ui/dither';

function ditherTile(offset: number): HTMLElement {
  const tile = el('div', { class: 'tile dither' });
  const draw = (): void => {
    const width = Math.max(240, Math.round(tile.clientWidth || 480));
    const height = Math.max(180, Math.round(tile.clientHeight || 360));
    tile.replaceChildren(ditherCanvas(width, height, offset));
  };
  requestAnimationFrame(draw);
  return tile;
}

export function mountHome(container: HTMLElement): void {
  container.append(
    el('div', { class: 'board home' }, [
      el('div', { class: 'tile paper name-tile' }, [el('p', { class: 'wordmark', text: 'Overlap' })]),
      ditherTile(0),
      ditherTile(420),
      el('div', { class: 'hero-pair' }, [
        el('div', { class: 'tile ink hero' }, [el('p', { text: copy.heroInk })]),
        el('div', { class: 'tile brass hero' }, [el('p', { text: copy.heroBrass })]),
      ]),
    ]),
  );
}
