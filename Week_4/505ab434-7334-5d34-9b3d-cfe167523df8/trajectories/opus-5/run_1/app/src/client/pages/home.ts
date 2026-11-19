import { getJson } from '../api.js';
import { clamp, el, isDesktop, lerp, phase, prefersReducedMotion } from '../dom.js';
import { quenbyMark, tileGlyph } from '../marks.js';
import { registerCleanup } from '../main.js';
import type { ChapterSummary } from '../../shared/types.js';

const OPENING_LINES = [
  'Quenby & Co. is not ',
  'a mood board. It is ',
  'a set of rules, each ',
  'with a name you can cite.',
];

const PROMISE =
  'Every colour, letter, mark and move here is a rule with an identifier. Ask for what you need by name, and we answer by name.';

interface TileSpec {
  key: string;
  label: string;
  href: string;
  field: 'lagoon' | 'moss' | 'saffron' | 'ember' | 'meadow' | 'iris' | 'clay' | 'orchid';
  glyph: 'logo' | 'voice' | 'colour' | 'typography' | 'iconography' | 'motion' | 'library' | 'rules';
}

const TILES: TileSpec[] = [
  { key: 'logo', label: 'Logo', href: '/chapters/logo', field: 'lagoon', glyph: 'logo' },
  { key: 'voice', label: 'Voice', href: '/chapters/voice', field: 'moss', glyph: 'voice' },
  { key: 'colour', label: 'Colour', href: '/chapters/colour', field: 'saffron', glyph: 'colour' },
  { key: 'typography', label: 'Typography', href: '/chapters/typography', field: 'ember', glyph: 'typography' },
  { key: 'iconography', label: 'Iconography', href: '/chapters/iconography', field: 'meadow', glyph: 'iconography' },
  { key: 'motion', label: 'Motion', href: '/chapters/motion', field: 'iris', glyph: 'motion' },
  { key: 'library', label: 'Library', href: '/library', field: 'clay', glyph: 'library' },
  { key: 'rules', label: 'Rule index', href: '/rules', field: 'orchid', glyph: 'rules' },
];

const SCROLL_LENGTH = 2700;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export async function renderHome(main: HTMLElement, navigate: (path: string) => void): Promise<void> {
  const summary = await getJson<{ chapters: ChapterSummary[]; liveRuleCount: number }>('/api/chapters');
  const lines = new Map<string, string>();
  for (const chapter of summary.chapters) {
    lines.set(chapter.slug, `v${chapter.version} · ${chapter.ruleCount} rules`);
  }
  lines.set('library', 'Assets and grants');
  lines.set('rules', `${summary.liveRuleCount} rules`);

  const opening = buildOpening();
  const promise = buildPromise();
  const mosaic = buildMosaic(lines, navigate);

  const animated = isDesktop() && !prefersReducedMotion();
  if (!animated) {
    main.classList.add('home-static');
    main.append(
      el('section', { class: 'home-section' }, opening.cell),
      el('section', { class: 'home-section' }, promise),
      el('section', { class: 'home-section' }, mosaic.element),
    );
    fadeOnEnter(main);
    opening.cue.addEventListener('click', () => {
      mosaic.element.scrollIntoView({ behavior: 'auto', block: 'start' });
      mosaic.tiles.get('logo')?.focus();
    });
    return;
  }

  const stage = el('div', { class: 'stage assembling' }, opening.cell, promise, mosaic.element);
  const scroller = el('section', { class: 'stage-scroll' }, stage);
  main.classList.add('home-animated');
  main.appendChild(scroller);

  const assembly = new Assembly(scroller, stage, opening, promise, mosaic);
  assembly.start();
  registerCleanup(() => assembly.stop());
}

interface Opening {
  cell: HTMLElement;
  cue: HTMLButtonElement;
}

function buildOpening(): Opening {
  const cue = el(
    'button',
    { type: 'button', class: 'cue', 'aria-label': 'Jump to chapters' },
    chevrons(),
  ) as HTMLButtonElement;
  const cell = el(
    'div',
    { class: 'cell opening-cell' },
    el('h1', { class: 'opening-statement' }, ...OPENING_LINES.map((line) => el('span', {}, line))),
    el('div', { class: 'opening-foot' }, quenbyMark(34, '#1F4E8C'), cue),
  );
  return { cell, cue };
}

function chevrons(): HTMLElement {
  const holder = el('span', { class: 'chevrons', 'aria-hidden': 'true' });
  holder.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
    <path d="M4 6 L12 13 L20 6" fill="none" stroke="currentColor" stroke-width="2.6"/>
    <path d="M4 14 L12 21 L20 14" fill="none" stroke="currentColor" stroke-width="2.6"/>
  </svg>`;
  return holder;
}

function buildPromise(): HTMLElement {
  return el(
    'section',
    { class: 'promise-card', 'aria-label': 'Brand promise' },
    el('p', { class: 'promise-statement' }, PROMISE),
    quenbyMark(46, '#FFFFFF'),
  );
}

interface Mosaic {
  element: HTMLElement;
  tiles: Map<string, HTMLAnchorElement>;
  markTile: HTMLElement;
}

function buildMosaic(lines: Map<string, string>, navigate: (path: string) => void): Mosaic {
  const tiles = new Map<string, HTMLAnchorElement>();
  const nav = el('nav', { class: 'mosaic', 'aria-label': 'Chapters' });
  for (const spec of TILES) {
    const descriptionId = `tile-line-${spec.key}`;
    const link = el(
      'a',
      {
        class: `tile tile-${spec.key} field field-${spec.field}`,
        href: spec.href,
        'aria-describedby': descriptionId,
        onclick: (event: Event) => {
          event.preventDefault();
          navigate(spec.href);
        },
      },
      el('span', { class: 'tile-label' }, spec.label),
      el('span', { class: 'tile-line', id: descriptionId }, lines.get(spec.key) ?? ''),
      tileGlyph(spec.glyph, spec.field),
    ) as HTMLAnchorElement;
    tiles.set(spec.key, link);
    nav.appendChild(link);
  }
  const markTile = el('div', { class: 'tile mark-tile' }, quenbyMark(46, '#FFFFFF'));
  nav.appendChild(markTile);
  return { element: nav, tiles, markTile };
}

function fadeOnEnter(main: HTMLElement): void {
  const sections = [...main.querySelectorAll<HTMLElement>('.home-section')];
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add('shown');
      }
    },
    { threshold: 0.05 },
  );
  for (const section of sections) observer.observe(section);
  registerCleanup(() => observer.disconnect());
}

class Assembly {
  private readonly finals = new Map<string, Rect>();
  private frame = 0;
  private readonly onScroll = (): void => this.schedule();
  private readonly onResize = (): void => {
    this.measure();
    this.apply();
  };

  constructor(
    private readonly scroller: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly opening: Opening,
    private readonly promise: HTMLElement,
    private readonly mosaic: Mosaic,
  ) {}

  start(): void {
    this.measure();
    this.apply();
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);
    this.opening.cue.addEventListener('click', () => this.jumpToMosaic(true));
    for (const tile of this.mosaic.tiles.values()) {
      tile.addEventListener('focus', () => {
        if (this.progress() < 1) this.jumpToMosaic(false);
      });
    }
  }

  stop(): void {
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    cancelAnimationFrame(this.frame);
  }

  private jumpToMosaic(focusLogo: boolean): void {
    const top = this.scroller.offsetTop + SCROLL_LENGTH;
    window.scrollTo({ top, behavior: 'auto' });
    this.apply();
    if (focusLogo) this.mosaic.tiles.get('logo')?.focus();
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.apply());
  }

  private progress(): number {
    const offset = window.scrollY - this.scroller.offsetTop;
    return clamp(offset / SCROLL_LENGTH, 0, 1);
  }

  private measure(): void {
    this.stage.classList.remove('assembling');
    const base = this.stage.getBoundingClientRect();
    for (const [key, tile] of this.mosaic.tiles) {
      this.finals.set(key, relative(tile.getBoundingClientRect(), base));
    }
    this.finals.set('mark', relative(this.mosaic.markTile.getBoundingClientRect(), base));
    this.stage.classList.add('assembling');
  }

  private apply(): void {
    const p = this.progress();
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;

    this.opening.cell.style.opacity = String(1 - phase(p, 0, 0.2));
    this.promise.classList.toggle('shrunk', p >= 0.5);

    const cardSize =
      p < 0.5
        ? 500
        : p < 0.75
          ? lerp(500, 416, phase(p, 0.5, 0.75))
          : lerp(416, markSize(this.finals.get('mark')), phase(p, 0.75, 1));
    const markRect = this.finals.get('mark') ?? { left: width / 2, top: height / 2, width: 90, height: 90 };
    const cardCentreX = lerp(width / 2, markRect.left + markRect.width / 2, phase(p, 0.75, 1));
    const cardCentreY = lerp(height / 2, markRect.top + markRect.height / 2, phase(p, 0.75, 1));
    place(this.promise, {
      left: cardCentreX - cardSize / 2,
      top: cardCentreY - cardSize / 2,
      width: cardSize,
      height: cardSize,
    });
    this.promise.style.opacity = String(phase(p, 0, 0.2));

    const sideWidth =
      p < 0.2
        ? 0
        : p < 0.5
          ? lerp(70, 195, phase(p, 0.2, 0.5))
          : p < 0.75
            ? lerp(195, 394, phase(p, 0.5, 0.75))
            : 0;

    this.placeSide('colour', 'left', sideWidth, p, width, height);
    this.placeSide('logo', 'right', sideWidth, p, width, height);
    this.placeBand('voice', 'top', p, width, height);
    this.placeBand('rules', 'bottom', p, width, height);
    this.placeLate('typography', 'right', p, width, height);
    this.placeLate('iconography', 'bottom', p, width, height);
    this.placeLate('motion', 'bottom', p, width, height);
    this.placeLate('library', 'bottom', p, width, height);
  }

  private placeSide(
    key: string,
    edge: 'left' | 'right',
    sideWidth: number,
    p: number,
    width: number,
    height: number,
  ): void {
    const tile = this.mosaic.tiles.get(key);
    const final = this.finals.get(key);
    if (!tile || !final) return;
    if (p < 0.2) {
      tile.style.opacity = '0';
      place(tile, { left: edge === 'left' ? 0 : width, top: 0, width: 0, height });
      return;
    }
    tile.style.opacity = '1';
    const t = phase(p, 0.75, 1);
    const currentWidth = p < 0.75 ? sideWidth : lerp(394, final.width, t);
    const currentHeight = p < 0.75 ? height : lerp(height, final.height, t);
    const edgeLeft = edge === 'left' ? 0 : width - currentWidth;
    place(tile, {
      left: p < 0.75 ? edgeLeft : lerp(edge === 'left' ? 0 : width - 394, final.left, t),
      top: p < 0.75 ? 0 : lerp(0, final.top, t),
      width: currentWidth,
      height: currentHeight,
    });
  }

  private placeBand(key: string, edge: 'top' | 'bottom', p: number, width: number, height: number): void {
    const tile = this.mosaic.tiles.get(key);
    const final = this.finals.get(key);
    if (!tile || !final) return;
    const bandHeight = lerp(0, 160, phase(p, 0.5, 0.75));
    const bandWidth = Math.max(width - 2 * lerp(195, 394, phase(p, 0.5, 0.75)), 120);
    if (p < 0.5) {
      tile.style.opacity = '0';
      place(tile, {
        left: (width - bandWidth) / 2,
        top: edge === 'top' ? 0 : height,
        width: bandWidth,
        height: 0,
      });
      return;
    }
    tile.style.opacity = '1';
    if (p < 0.75) {
      place(tile, {
        left: (width - bandWidth) / 2,
        top: edge === 'top' ? 0 : height - bandHeight,
        width: bandWidth,
        height: bandHeight,
      });
      return;
    }
    const t = phase(p, 0.75, 1);
    place(tile, {
      left: lerp((width - bandWidth) / 2, final.left, t),
      top: lerp(edge === 'top' ? 0 : height - 160, final.top, t),
      width: lerp(bandWidth, final.width, t),
      height: lerp(160, final.height, t),
    });
  }

  private placeLate(key: string, edge: 'right' | 'bottom', p: number, width: number, height: number): void {
    const tile = this.mosaic.tiles.get(key);
    const final = this.finals.get(key);
    if (!tile || !final) return;
    if (p < 0.75) {
      tile.style.opacity = '0';
      place(tile, {
        left: edge === 'right' ? width : final.left,
        top: edge === 'bottom' ? height : final.top,
        width: final.width,
        height: final.height,
      });
      return;
    }
    tile.style.opacity = '1';
    const t = phase(p, 0.75, 1);
    place(tile, {
      left: edge === 'right' ? lerp(width, final.left, t) : final.left,
      top: edge === 'bottom' ? lerp(height, final.top, t) : final.top,
      width: final.width,
      height: final.height,
    });
  }
}

function markSize(rect: Rect | undefined): number {
  return rect ? Math.min(rect.width, rect.height) : 90;
}

function relative(rect: DOMRect, base: DOMRect): Rect {
  return { left: rect.left - base.left, top: rect.top - base.top, width: rect.width, height: rect.height };
}

function place(node: HTMLElement, rect: Rect): void {
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}
