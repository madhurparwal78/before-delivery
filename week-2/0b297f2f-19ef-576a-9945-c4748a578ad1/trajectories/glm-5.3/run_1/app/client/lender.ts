import { el, skipLink } from './ui.js';
import { formatLength } from './types.js';
import type { Unit } from './types.js';

interface SnapshotWork {
  title: string;
  objectNumber: string;
  wallName: string;
  offsetMm: number;
  centreHeightMm: number;
  widthMm: number;
  heightMm: number;
}

interface Snapshot {
  exhibition: { title: string; runStart: string; runEnd: string };
  lender: { name: string };
  publishedAt: string;
  publishedAtDisplay: string;
  walls: { id: string; name: string; lengthMm: number; heightMm: number }[];
  works: SnapshotWork[];
}

const WALL_ORDER = ['North wall', 'East wall', 'South wall', 'West wall'];

export class LenderPage {
  private view: 'plan' | 'wall' = 'plan';

  constructor(private root: HTMLElement, private token: string) {
    const params = new URL(window.location.href).searchParams;
    this.view = params.get('view') === 'wall' ? 'wall' : 'plan';
  }

  async start(): Promise<void> {
    let snapshot: Snapshot | null = null;
    let reason: 'not_found' | 'withdrawn' | 'db' | null = null;
    try {
      const response = await fetch(`/api/p/${this.token}`);
      if (response.status === 200) {
        snapshot = (await response.json()) as Snapshot;
      } else if (response.status === 410) {
        reason = 'withdrawn';
      } else if (response.status === 404) {
        reason = 'not_found';
      } else if (response.status === 503) {
        reason = 'db';
      } else {
        reason = 'not_found';
      }
    } catch {
      reason = 'db';
    }
    this.render(snapshot, reason);
  }

  private render(snapshot: Snapshot | null, reason: string | null): void {
    const page = el('div', {});
    page.append(skipLink());

    if (snapshot === null) {
      const main = el('main', { id: 'main', class: 'register-main', tabindex: '-1' });
      const heading = reason === 'withdrawn'
        ? 'This preview has been withdrawn by the museum.'
        : reason === 'db'
          ? `This preview can't be shown right now. Please try again later.`
          : `This preview link isn't valid.`;
      main.append(el('h1', { class: 'not-found-heading', text: heading }));
      page.append(main);
      this.root.replaceChildren(page);
      (this.root.querySelector('main') as HTMLElement).focus();
      return;
    }

    const main = el('main', { id: 'main', class: 'register-main', tabindex: '-1' });
    main.append(el('h1', { class: 'exhibition-title', text: snapshot.exhibition.title }));
    main.append(el('p', { text: `Prepared for ${snapshot.lender.name}` }));
    main.append(el('p', { class: 'num', text: `Published ${snapshot.publishedAtDisplay}` }));

    const scene = el('div', { class: 'scene-wrap', role: 'region', 'aria-label': 'Preview scene' });
    const canvasHolder = el('div', { class: 'gallery-scene' });
    scene.append(canvasHolder);
    const viewGroup = el('div', { role: 'group', 'aria-label': 'View' });
    for (const [name, label] of [['plan', 'Plan'], ['wall', 'Wall']] as const) {
      const button = el('button', {
        text: label,
        'aria-pressed': this.view === name ? 'true' : 'false',
      });
      button.addEventListener('click', () => {
        this.view = name;
        const url = new URL(window.location.href);
        if (name === 'wall') url.searchParams.set('view', 'wall');
        else url.searchParams.delete('view');
        window.history.replaceState({}, '', url);
        this.render(snapshot, null);
      });
      viewGroup.append(button);
    }
    main.append(viewGroup, scene);

    main.append(el('h2', { text: 'Your works in place' }));
    const list = el('ul', { 'aria-label': 'Your works' });
    const ordered = [...snapshot.works].sort((a, b) =>
      WALL_ORDER.indexOf(a.wallName) - WALL_ORDER.indexOf(b.wallName) || a.offsetMm - b.offsetMm
    );
    for (const work of ordered) {
      const item = el('li', {});
      item.append(el('h3', { text: work.title }));
      const dl = el('dl', {});
      const add = (label: string, value: string): void => {
        dl.append(el('dt', { text: label }), el('dd', { class: 'num', text: value }));
      };
      add('Object number', work.objectNumber);
      add('Wall', work.wallName);
      add('Offset', `Offset ${formatLength(work.offsetMm, 'cm')} from the left end`);
      add('Centre', `Centre ${formatLength(work.centreHeightMm, 'cm')} from the floor`);
      add('Dimensions', `${formatLength(work.widthMm, 'cm')} × ${formatLength(work.heightMm, 'cm')}`);
      item.append(dl);
      list.append(item);
    }
    main.append(list);
    page.append(main);
    this.root.replaceChildren(page);
    this.drawScene(canvasHolder, snapshot);
  }

  private drawScene(holder: HTMLElement, snapshot: Snapshot): void {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    holder.replaceChildren(canvas);
    const rect = holder.getBoundingClientRect();
    canvas.width = Math.max(300, Math.floor(rect.width));
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.fillStyle = '#efe8dc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const walls = snapshot.walls;
    if (this.view === 'plan') {
      // Top-down outline
      ctx.strokeStyle = '#211d1a';
      ctx.lineWidth = 2;
      const w = canvas.width - 80;
      const h = canvas.height - 60;
      ctx.strokeRect(40, 30, w, h);
      for (const work of snapshot.works) {
        const wall = walls.find((v) => v.name === work.wallName);
        if (wall === undefined) continue;
        const scale = work.wallName === 'North wall' || work.wallName === 'South wall'
          ? w / wall.lengthMm : h / wall.lengthMm;
        const size = work.widthMm * scale;
        const along = (work.offsetMm - wall.lengthMm / 2) * scale;
        ctx.fillStyle = '#f6f1e8';
        const cx = 40 + w / 2 + along;
        if (work.wallName === 'North wall') {
          ctx.fillRect(cx - size / 2, 30, size, 8);
          ctx.strokeRect(cx - size / 2, 30, size, 8);
        } else if (work.wallName === 'South wall') {
          ctx.fillRect(cx - size / 2, 30 + h - 8, size, 8);
          ctx.strokeRect(cx - size / 2, 30 + h - 8, size, 8);
        } else if (work.wallName === 'East wall') {
          ctx.fillRect(40 + w - 8, 30 + h / 2 + along - size / 2, 8, size);
          ctx.strokeRect(40 + w - 8, 30 + h / 2 + along - size / 2, 8, size);
        } else {
          ctx.fillRect(40, 30 + h / 2 + along - size / 2, 8, size);
          ctx.strokeRect(40, 30 + h / 2 + along - size / 2, 8, size);
        }
      }
    } else {
      const first = snapshot.works[0];
      const wall = walls.find((v) => v.name === first?.wallName) ?? walls[0];
      if (wall !== undefined) {
        const scale = Math.min((canvas.width - 60) / (wall.lengthMm / 10), (canvas.height - 60) / (wall.heightMm / 10));
        const x0 = (canvas.width - (wall.lengthMm / 10) * scale) / 2;
        const y0 = (canvas.height - (wall.heightMm / 10) * scale) / 2;
        ctx.fillStyle = '#d8d1c5';
        ctx.fillRect(x0, y0, (wall.lengthMm / 10) * scale, (wall.heightMm / 10) * scale);
        ctx.strokeStyle = '#211d1a';
        ctx.strokeRect(x0, y0, (wall.lengthMm / 10) * scale, (wall.heightMm / 10) * scale);
        for (const work of snapshot.works.filter((wk) => wk.wallName === wall.name)) {
          const w = (work.widthMm / 10) * scale;
          const h = (work.heightMm / 10) * scale;
          const x = x0 + ((work.offsetMm - work.widthMm / 2) / 10) * scale;
          const y = y0 + (wall.heightMm / 10) * scale - ((work.centreHeightMm + work.heightMm / 2) / 10) * scale;
          ctx.fillStyle = '#f6f1e8';
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);
        }
        ctx.strokeStyle = '#c25e1e';
        ctx.lineWidth = 1.5;
        const y = y0 + (wall.heightMm / 10) * scale - 145 * scale;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + (wall.lengthMm / 10) * scale, y);
        ctx.stroke();
      }
    }
  }
}

export function mountLenderPage(root: HTMLElement, token: string): void {
  const page = new LenderPage(root, token);
  void page.start();
}
