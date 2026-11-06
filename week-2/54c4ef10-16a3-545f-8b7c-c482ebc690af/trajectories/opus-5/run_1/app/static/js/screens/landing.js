// The landing hero: two prints in darkness.
import * as api from '../api.js';
import { COPY } from '../boot.js';
import { el } from '../dom.js';
import { drawNegativePrint, drawStepWedge } from '../hero.js';
import { signOut } from '../main.js';
import { StripPreview } from '../strip.js';

// The hero print is a four-to-five portrait, so the frame is cropped to it.
async function latestAlignedPrint(canvas, frame) {
  const scan = await api.get(`/api/scans/${frame.scan_id}`);
  const preview = new StripPreview(scan);
  if (!(await preview.load())) return false;
  canvas.height = Math.round((canvas.width * 5) / 4);
  const cropWidth = Math.min(frame.x1 - frame.x0, Math.round((scan.height * 4) / 5));
  const left = Math.round((frame.x0 + frame.x1) / 2 - cropWidth / 2);
  preview.drawRegion(canvas, left, 0, left + cropWidth, scan.height);
  return true;
}

export async function render(context) {
  const { account } = context;
  const large = el('canvas', {
    width: 320,
    height: 400,
    role: 'img',
    'aria-label': 'Negative print',
    class: 'print hero-large',
  });
  drawNegativePrint(large);
  const small = el('canvas', {
    width: 240,
    height: 240,
    role: 'img',
    'aria-label': 'Step wedge print',
    class: 'print hero-small',
  });
  drawStepWedge(small);

  const header = el('header', { class: 'hero-top' }, [
    el('div', { class: 'brand' }, [
      el('a', { href: '/', class: 'wordmark', text: 'Edgeprint' }),
      el('nav', { role: 'navigation', 'aria-label': 'Main' }, [
        el('a', { href: '/archive', text: 'Archive' }),
        el('a', { href: '/curves', text: 'Curves' }),
        el('a', { href: '/log', text: 'Log' }),
      ]),
    ]),
    el('div', { class: 'hero-actions' }, [
      el('a', {
        href: account ? '/archive' : '/signin',
        class: 'solid',
        text: 'Open archive',
      }),
      account
        ? el('button', { type: 'button', class: 'ghost', text: 'Sign out', onclick: signOut })
        : null,
    ]),
  ]);

  const section = el('section', { class: 'hero' }, [
    header,
    el('div', { class: 'hero-prints' }, [large, small]),
    el('h1', { class: 'hero-headline', text: COPY.headline }),
    el('p', { class: 'muted hero-sentence', text: COPY.heroSentence }),
  ]);

  if (account && account.latest_aligned_frame) {
    latestAlignedPrint(large, account.latest_aligned_frame).catch(() => {});
  }
  return section;
}
