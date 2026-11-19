import { svg } from '../dom.js';

const PHONE_MAX = 767;
const CLEARANCE = 28;

/**
 * A flat teal disc, cropped by the window, whose edge breaks into a hex halftone ramp
 * of shrinking dots fading from solid tone into paper. The headline always keeps bare
 * paper, so the disc and its ramp are held clear of the copy block.
 */
export function drawHeroDisc(host: HTMLElement): void {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (width === 0 || height === 0) return;

  const phone = window.innerWidth <= PHONE_MAX;
  const frame = host.getBoundingClientRect();
  const copy = host.querySelector('.hero-copy');
  const copyBox = copy === null ? null : copy.getBoundingClientRect();
  const copyRight = copyBox === null ? 0 : copyBox.right - frame.left;
  const copyBottom = copyBox === null ? 0 : copyBox.bottom - frame.top;

  const centreX = phone ? width * 0.5 : width * 0.75;
  let radius = phone ? width * 0.65 : window.innerHeight * 0.6;
  if (!phone) radius = Math.min(radius, Math.max(width * 0.22, centreX - copyRight - CLEARANCE));
  const discTop = Math.max(copyBottom + CLEARANCE, height * 0.52);
  const centreY = phone ? discTop + radius : height * 0.55;
  const band = radius * 0.34;

  const canvas = svg('svg', {
    class: 'hero-disc',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  canvas.appendChild(svg('circle', { cx: centreX, cy: centreY, r: radius, class: 'hero-solid' }));

  const pitch = radius * 0.1;
  const reach = Math.ceil((radius + band) / pitch) + 2;
  const ramp = svg('g', { class: 'hero-ramp' });
  for (let row = -reach; row <= reach; row += 1) {
    for (let column = -reach; column <= reach; column += 1) {
      const x = centreX + pitch * (column + row / 2);
      const y = centreY + pitch * row * (Math.sqrt(3) / 2);
      // The ramp breaks off the left edge on wide screens and the top edge on phones.
      if (phone ? y > centreY : x > centreX) continue;
      if (phone ? y < copyBottom + CLEARANCE : x < copyRight + CLEARANCE) continue;
      const distance = Math.hypot(x - centreX, y - centreY);
      const coverage = (radius + band - distance) / band;
      if (coverage <= 0.02 || coverage >= 0.995) continue;
      if (x < -pitch || y < -pitch || x > width + pitch || y > height + pitch) continue;
      ramp.appendChild(
        svg('circle', {
          cx: x,
          cy: y,
          r: (pitch * 1.155 * Math.sqrt(coverage)) / 2,
          class: 'hero-dot',
        }),
      );
    }
  }
  canvas.appendChild(ramp);

  const existing = host.querySelector('.hero-disc');
  if (existing === null) host.prepend(canvas);
  else existing.replaceWith(canvas);
}
