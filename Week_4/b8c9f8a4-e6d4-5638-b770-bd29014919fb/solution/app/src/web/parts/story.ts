// The owner story panel and the two source plate record cards.

import { el, on, svg } from '../dom.js';
import { entrance } from '../ui/entrance.js';

/**
 * The dawn lane behind the owner's story: the road near Hexham seen from the verge at first
 * light. Everything is drawn here, in the stage's own palette, so the panel carries the same
 * light as the car. The lane converges on a vanishing point at the horizon and its centre dashes
 * shorten and narrow towards it, so the perspective reads rather than being implied.
 */
function laneArt(): SVGElement {
  const horizon = 254;
  const vanishX = 628;
  // Each dash is a trapezoid on the centre line, tapering towards the vanishing point.
  const dash = (t0: number, t1: number): string => {
    const at = (t: number): [number, number, number] => [
      420 - (420 - horizon) * t,
      600 + (vanishX - 600) * t,
      8 * (1 - t) + 0.6,
    ];
    const [y0, cx0, w0] = at(t0);
    const [y1, cx1, w1] = at(t1);
    return `<path d="M${(cx0 - w0).toFixed(1)} ${y0.toFixed(1)}L${(cx0 + w0).toFixed(1)} ${y0.toFixed(1)}`
      + `L${(cx1 + w1).toFixed(1)} ${y1.toFixed(1)}L${(cx1 - w1).toFixed(1)} ${y1.toFixed(1)}Z" fill="url(#ob-paint)"/>`;
  };
  const dashes = [[0, 0.11], [0.2, 0.29], [0.37, 0.45], [0.52, 0.59], [0.65, 0.71], [0.77, 0.82],
    [0.87, 0.91]].map(([a, b]) => dash(a, b)).join('');
  return svg(`<svg viewBox="0 0 1100 420" class="story-art" role="presentation" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="ob-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2B2272"/><stop offset="0.52" stop-color="#6C7BD8"/>
        <stop offset="0.84" stop-color="#C9A9C4"/><stop offset="1" stop-color="#FFE2C4"/>
      </linearGradient>
      <radialGradient id="ob-sun-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#FFF2DB" stop-opacity="0.62"/>
        <stop offset="0.45" stop-color="#FFD9A8" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#FFD9A8" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ob-far-hill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6A6AB4"/><stop offset="1" stop-color="#4A4790"/>
      </linearGradient>
      <linearGradient id="ob-near-hill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2A2A66"/><stop offset="1" stop-color="#140B36"/>
      </linearGradient>
      <linearGradient id="ob-tarmac" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#17103F"/><stop offset="0.55" stop-color="#3A3570"/>
        <stop offset="1" stop-color="#8E93C8"/>
      </linearGradient>
      <linearGradient id="ob-verge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1B1444"/><stop offset="1" stop-color="#4C4A86"/>
      </linearGradient>
      <linearGradient id="ob-paint" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFF2DB" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#FFF2DB" stop-opacity="0.85"/>
      </linearGradient>
    </defs>
    <rect width="1100" height="420" fill="url(#ob-sky)"/>
    <circle cx="766" cy="232" r="168" fill="url(#ob-sun-glow)"/>
    <circle cx="766" cy="232" r="27" fill="#FFF3DF" opacity="0.92"/>
    <path d="M0 248 C120 230 198 243 286 236 C372 229 438 214 534 220
             C636 226 712 240 806 234 C902 228 1006 238 1100 230 L1100 262 L0 262 Z"
          fill="url(#ob-far-hill)" opacity="0.72"/>
    <path d="M0 262 C150 246 252 262 352 256 C470 249 548 236 636 244
             C742 253 846 266 946 258 C1014 253 1060 256 1100 252 L1100 420 L0 420 Z"
          fill="url(#ob-near-hill)"/>
    <path d="M232 420 L${vanishX - 26} ${horizon} L${vanishX + 26} ${horizon} L968 420 Z" fill="url(#ob-verge)"/>
    <path d="M300 420 L${vanishX - 15} ${horizon} L${vanishX + 15} ${horizon} L900 420 Z" fill="url(#ob-tarmac)"/>
    ${dashes}
    <path d="M0 262 C150 246 252 262 352 256 C470 249 548 236 636 244
             C742 253 846 266 946 258 C1014 253 1060 256 1100 252 L1100 276 L0 286 Z"
          fill="#FFE2C4" opacity="0.14"/>
  </svg>`);
}

/** The panel's two-line statement: the opening sentence of the owner's own story. */
function statement(story: string): string {
  const stop = story.indexOf('. ');
  return stop === -1 ? story : story.slice(0, stop + 1);
}

export function storyPanel(
  story: string,
  viewingArea: string,
  /** How the page moves to a section: a jump writes no seen record, so the page decides it. */
  onJump: (href: string) => void,
): HTMLElement {
  const link = el('a', { href: '#offer', class: 'pill pill-outline' }, ['Go to the offer']);
  on(link, 'click', (event) => {
    event.preventDefault();
    onJump('#offer');
  });
  return el('section', {
    role: 'region',
    'aria-label': 'Owner story',
    class: 'story-panel',
    id: 'story',
  }, [
    laneArt(),
    entrance(el('div', { class: 'story-copy' }, [
      el('p', { class: 'story-eyebrow' }, [`Kept ${viewingArea.toLowerCase()}`]),
      el('p', { class: 'story-statement' }, [statement(story)]),
      link,
    ])),
  ]);
}
