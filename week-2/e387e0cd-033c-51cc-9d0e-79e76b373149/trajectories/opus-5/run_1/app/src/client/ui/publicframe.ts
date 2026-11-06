import { get } from '../api';
import { element } from '../dom';
import { navigate } from '../router';
import { StatusRegion } from './live';
import { HeaderMenu } from './menu';

interface NodePosition {
  readonly x: number;
  readonly y: number;
}

/** Fourteen nodes and their connectors, with one packet per connector. */
function networkBand(): SVGSVGElement {
  const count = 14;
  const nodes: NodePosition[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    nodes.push({
      x: 600 + Math.cos(angle) * (210 + (index % 3) * 40),
      y: 150 + Math.sin(angle) * (90 + (index % 4) * 12),
    });
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1200 300');
  svg.setAttribute('class', 'network-band-art');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Lanternline network');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  for (let index = 0; index < count; index += 1) {
    const from = nodes[index];
    const to = nodes[(index + 1) % count];
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x.toFixed(1));
    line.setAttribute('y1', from.y.toFixed(1));
    line.setAttribute('x2', to.x.toFixed(1));
    line.setAttribute('y2', to.y.toFixed(1));
    line.setAttribute('class', 'network-connector');
    svg.append(line);
    const packet = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    packet.setAttribute('cx', from.x.toFixed(1));
    packet.setAttribute('cy', from.y.toFixed(1));
    packet.setAttribute('r', '3.5');
    packet.setAttribute('class', 'network-packet');
    packet.style.setProperty('--dx', `${(to.x - from.x).toFixed(1)}px`);
    packet.style.setProperty('--dy', `${(to.y - from.y).toFixed(1)}px`);
    packet.style.setProperty('--delay', `${index * 40}ms`);
    svg.append(packet);
  }
  for (const position of nodes) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', position.x.toFixed(1));
    circle.setAttribute('cy', position.y.toFixed(1));
    circle.setAttribute('r', '7');
    circle.setAttribute('class', 'network-node');
    svg.append(circle);
  }
  return svg;
}

interface StatsBody {
  jurisdictions: number;
  rulesInForce: number;
  listedExchanges: number;
}

function figure(value: number, suffix: string): HTMLElement {
  const label = `${value} ${suffix}`;
  return element('div', {
    className: 'figure',
    attributes: { role: 'group', 'aria-label': label },
    children: [
      element('span', {
        className: 'figure-value mono roll',
        text: String(value),
        attributes: { 'aria-hidden': 'true' },
      }),
      element('span', { className: 'figure-label', text: suffix, attributes: { 'aria-hidden': 'true' } }),
    ],
  });
}

export interface PublicFrame {
  readonly main: HTMLElement;
  readonly status: StatusRegion;
  readonly layer: HTMLElement;
  readonly band: HTMLElement;
  destroy(): void;
}

export async function publicFrame(host: HTMLElement): Promise<PublicFrame> {
  const status = new StatusRegion('Directory status');
  const directoryMenu = new HeaderMenu('Directory', [
    { label: 'Jurisdictions', activate: () => scrollToList('Jurisdictions') },
    { label: 'Listed exchanges', activate: () => scrollToList('Listed exchanges') },
  ]);
  const band = element('div', { className: 'network-band', children: [networkBand()] });
  const deskMenu = new HeaderMenu('Desk', [
    { label: 'How it works', activate: () => band.scrollIntoView({ block: 'start' }) },
    { label: 'Sign in', activate: () => navigate('/sign-in') },
  ]);
  const stats = element('div', {
    className: 'stats-band',
    attributes: { role: 'region', 'aria-label': 'Network figures' },
  });
  const main = element('main', { className: 'public-main' });
  const layer = element('div', { className: 'dialog-layer' });
  host.append(
    element('div', {
      className: 'public-page',
      children: [
        element('header', {
          className: 'public-header',
          children: [
            element('a', {
              className: 'wordmark control',
              text: 'Lanternline',
              attributes: { href: '/' },
            }),
            element('div', {
              className: 'header-menus',
              children: [directoryMenu.node, deskMenu.node],
            }),
          ],
        }),
        band,
        stats,
        status.node,
        main,
        layer,
      ],
    }),
  );
  try {
    const body = await get<StatsBody>('/api/public/stats');
    stats.append(
      figure(body.jurisdictions, 'jurisdictions tracked'),
      figure(body.rulesInForce, 'rules in force'),
      figure(body.listedExchanges, 'listed exchanges'),
    );
  } catch {
    stats.append(element('p', { text: 'Figures are unavailable.' }));
  }
  return {
    main,
    status,
    layer,
    band,
    destroy(): void {
      directoryMenu.close();
      deskMenu.close();
    },
  };
}

function scrollToList(name: string): void {
  const list = document.querySelector<HTMLElement>(`[aria-label="${name}"]`);
  list?.scrollIntoView({ block: 'start' });
}
