import { LANDING_COPY } from '../../shared/copy';
import type { LandingFrame } from '../../shared/types';
import { el, on, svg } from '../dom';
import { fileIcon } from '../icons';
import { proceduralField } from '../frames';

const LIT_TITLE = 'Fern gully';

export const renderLanding = (root: HTMLElement, frames: LandingFrame[]): void => {
  const title = el('p', { class: 'strip-title' });
  const strip = el('div', { class: 'strip' });
  const nodes: HTMLElement[] = [];

  const light = (index: number): void => {
    for (const [position, node] of nodes.entries()) {
      node.setAttribute('data-lit', position === index ? 'true' : 'false');
    }
    title.textContent = frames[index]?.title ?? '';
  };

  for (const [index, frame] of frames.entries()) {
    const node = el('div', { class: 'frame', role: 'img', tabindex: '0', 'aria-label': frame.title });
    if (frame.kind === 'file' && frame.file_name !== null) {
      node.append(el('span', { class: 'frame-file' }, [svg(fileIcon('text/plain'), 'file-icon'), el('span', { text: frame.file_name })]));
    } else {
      const fieldNode = el('span', { class: 'frame-field' });
      fieldNode.style.backgroundImage = proceduralField(frame.id);
      node.append(fieldNode);
    }
    on(node, 'pointerenter', () => light(index));
    on(node, 'focus', () => light(index));
    nodes.push(node);
    strip.append(node);
  }

  const litIndex = Math.max(
    0,
    frames.findIndex((frame) => frame.title === LIT_TITLE),
  );
  light(litIndex);

  root.append(
    el('div', { class: 'landing' }, [
      el('div', { class: 'corner-row' }, [
        el('span', { class: 'wordmark', text: 'Pinsheet' }),
        el('a', { href: '/signin', text: 'Sign in' }),
      ]),
      el('div', { class: 'strip-wrap' }, [strip, title]),
      el('div', { class: 'corner-row' }, [
        el('p', { class: 'sentence', text: LANDING_COPY.sentence }),
        el('a', { class: 'cta', href: '/signup', text: 'Make a board' }),
      ]),
    ]),
  );
};
