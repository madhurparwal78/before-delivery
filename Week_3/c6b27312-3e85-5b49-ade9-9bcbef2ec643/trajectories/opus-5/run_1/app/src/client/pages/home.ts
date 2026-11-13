import {
  AppConfig,
  EvaluationResponse,
  Me,
  PartResponse,
  appConfig,
  me,
  send,
} from '../api';
import { all, clear, el, find, on, reducedMotion } from '../dom';
import { Viewport } from '../viewport';
import { ParameterControls } from '../params';
import { Values, defaultsOf, sparseValues } from '../values';
import { bboxText, display, volumeMm3 } from '../../shared/numbers';
import { boxOfBbox } from '../../shared/pose';
import { openLiveStream, thumbnail } from '../ui';
import { Epoch } from '../viewport';

const HERO_SLUG = 'hero-cable-clip';
const PIXELS_TO_MM = 0.2645833;

type GalleryPart = {
  slug: string;
  title: string;
  category: string;
  author: { id: string; displayName: string };
  likes: number;
  liked: boolean;
  createdAt: string;
  head: { id: string; label: string; geometryDigest: string; volume: number; bbox: [number, number, number] } | null;
};

type GalleryAnswer = {
  parts: GalleryPart[];
  nextCursor: string | null;
  categories: { slug: string; name: string; count: number }[];
  total: number;
};

export async function mountHome(): Promise<void> {
  const settings = await appConfig();
  const viewer = await me();
  await mountHero(settings);
  mountStatements();
  await mountGallery(viewer);
}

/** The hero prints its headline's rendered width in millimetres as the clip's span. */
async function mountHero(settings: AppConfig): Promise<void> {
  const fragmentHost = find<HTMLElement>('[data-ui="hero-fragment"]');
  const headlineHost = find<HTMLElement>('.hero-copy h1');
  if (!fragmentHost || !headlineHost) return;
  const fragment: HTMLElement = fragmentHost;
  const headline: HTMLElement = headlineHost;
  const answer = await send<PartResponse>(`/api/parts/${HERO_SLUG}`);
  const manifest = answer.data.manifest;
  const span = manifest.find((entry) => entry.name === 'span')!;
  const values: Values = defaultsOf(manifest);
  const viewerId = crypto.randomUUID();
  let seq = 0;
  let byHand = false;

  const viewport = new Viewport({ epochKey: 'tinework:epoch:hero', fallbackAlt: 'Cable clip' });
  viewport.root.setAttribute('data-ui', 'hero-viewport');
  viewport.setViewerId(viewerId);
  const readout = el('p', { 'data-ui': 'hero-readout', class: 'hero-readout' });
  const row = el('div', { class: 'hero-row' });
  viewport.mount(fragment);
  fragment.append(row, readout);

  const controls = new ParameterControls(manifest, values, 'mm', (name, value) => {
    values[name] = value;
    byHand = true;
    controls.refresh();
    paintReadout();
    void evaluate();
  });
  for (const node of controls.build([span])) row.append(node);

  function paintReadout(): void {
    readout.textContent = `span ${display(Number(values.span), 2)} mm · ${
      byHand ? 'set by hand' : 'measured from the headline'
    }`;
  }

  async function evaluate(): Promise<void> {
    seq += 1;
    const mySeq = seq;
    const result = await send<EvaluationResponse>('/api/evaluations', {
      method: 'POST',
      body: {
        partSlug: HERO_SLUG,
        values: sparseValues(manifest, values),
        seq: mySeq,
        viewerId,
      },
    });
    if (result.data.status !== 'succeeded' || mySeq < seq) return;
    const first = viewport.getSolid() === null;
    viewport.setSolid(result.data.solid, { crossfade: !first });
    viewport.setDefaultPose(viewport.poseForBox(boxOfBbox(result.data.bbox)), first);
    viewport.setReadouts({
      digest: result.data.geometryDigest,
      volume: result.data.volume,
      bbox: result.data.bbox,
      faces: result.data.faces,
      seq: mySeq,
    });
    viewport.paint();
  }

  function measureHeadline(): void {
    const range = document.createRange();
    range.selectNodeContents(headline);
    const rectangles = [...range.getClientRects()].filter((rectangle) => rectangle.width > 0);
    const width =
      rectangles.length > 0
        ? Math.max(...rectangles.map((rectangle) => rectangle.width))
        : headline.getBoundingClientRect().width;
    const millimetres = Math.min(
      span.max ?? 400,
      Math.max(span.min ?? 40, Math.round(width * PIXELS_TO_MM * 1000) / 1000),
    );
    values.span = Math.round(millimetres * 100) / 100;
    byHand = false;
    controls.refresh();
    paintReadout();
    void evaluate();
  }

  measureHeadline();
  let timer = 0;
  on(window, 'resize', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => measureHeadline(), 200);
  });
  void settings;
}

/** Five statements beside real, cropped Tinework fragments; one pins from 1024 pixels. */
function mountStatements(): void {
  const host = find<HTMLElement>('[data-ui="statements"]');
  if (!host) return;
  const lines: [string, string][] = [
    ['Set a dimension by keyboard.', 'Arrow keys step, Shift jumps ten, Ctrl trims a tenth.'],
    ['Run pre-flight before you spend stock.', 'Thin walls and deep holes show up as findings.'],
    ['Replay the build tape.', 'Every operation keeps the solid it made.'],
    ['Compare two revisions.', 'Added material lights up; removed material ghosts out.'],
    ['Pin a comment to a view.', 'Reviewers see the part exactly as you left it.'],
  ];
  for (const [title, line] of lines) {
    host.append(
      el('section', { class: 'statement' }, [
        el('div', { class: 'statement-copy' }, [el('h3', {}, [title]), el('p', { class: 'muted' }, [line])]),
        el('div', { class: 'statement-fragment' }, [el('span', { 'aria-hidden': 'true' }, ['⌗'])]),
      ]),
    );
  }

  const pinned = el('div', { 'data-ui': 'pinned-fragment', class: 'pinned-fragment', 'data-step': '1' });
  const steps = [
    'Change a dimension. The solid rebuilds where you are looking.',
    'Run pre-flight. Thin walls and deep holes show before you print.',
    'Scrub the tape. See which operation made each wall.',
  ];
  const pinnedSection = el('section', { class: 'pinned-section' }, [
    pinned,
    ...steps.map((text, index) =>
      el('p', { class: 'pinned-statement', 'data-step': index + 1 }, [text]),
    ),
  ]);
  host.append(pinnedSection);

  if (reducedMotion()) {
    pinned.setAttribute('data-step', '3');
    return;
  }
  on(window, 'scroll', () => {
    const middle = window.innerHeight / 2;
    let active = 1;
    for (const statement of all('.pinned-statement', pinnedSection)) {
      const box = statement.getBoundingClientRect();
      if (box.top < middle) active = Number(statement.getAttribute('data-step'));
    }
    pinned.setAttribute('data-step', String(active));
  });
}

async function mountGallery(viewer: Me): Promise<void> {
  const gridHost = find<HTMLElement>('[data-ui="gallery-grid"]');
  const categoriesHost = find<HTMLElement>('[data-ui="categories"]');
  const sortHost = find<HTMLSelectElement>('[data-ui="sort-by"]');
  const showMoreHost = find<HTMLButtonElement>('[data-ui="show-more"]');
  const statusHost = find<HTMLElement>('[data-ui="gallery-status"]');
  if (!gridHost || !categoriesHost || !sortHost || !showMoreHost || !statusHost) return;
  const grid: HTMLElement = gridHost;
  const categories: HTMLElement = categoriesHost;
  const sort: HTMLSelectElement = sortHost;
  const showMore: HTMLButtonElement = showMoreHost;
  const status: HTMLElement = statusHost;
  const epoch = new Epoch('tinework:epoch:gallery:home');
  grid.setAttribute('data-epoch', String(epoch.current()));

  const url = new URL(window.location.href);
  let category = url.searchParams.get('category');
  let sortId = url.searchParams.get('sort') ?? 'featured';
  sort.value = sortId;
  let cursor: string | null = null;
  let shown = 0;

  function card(part: GalleryPart): HTMLElement {
    const count = el('span', { 'data-ui': 'like-count' }, [
      part.likes === 1 ? '1 like' : `${part.likes} likes`,
    ]);
    const like = el(
      'button',
      {
        type: 'button',
        'aria-label': `Like ${part.title}`,
        'aria-pressed': part.liked ? 'true' : 'false',
        ...(viewer ? {} : { 'aria-disabled': 'true' }),
      },
      [`Like ${part.title}`, count],
    );
    const tooltip = el('span', { role: 'tooltip', class: 'tooltip', hidden: true }, [
      'Sign in to like parts',
    ]);
    if (!viewer) {
      for (const event of ['pointerenter', 'focus']) {
        on(like, event, () => {
          tooltip.hidden = false;
        });
      }
      for (const event of ['pointerleave', 'blur']) {
        on(like, event, () => {
          tooltip.hidden = true;
        });
      }
    }
    on(like, 'click', async () => {
      if (!viewer) return;
      const pressed = like.getAttribute('aria-pressed') === 'true';
      const result = await send<{ liked: boolean; likes: number }>(`/api/parts/${part.slug}/like`, {
        method: pressed ? 'DELETE' : 'PUT',
      });
      like.setAttribute('aria-pressed', result.data.liked ? 'true' : 'false');
      count.textContent = result.data.likes === 1 ? '1 like' : `${result.data.likes} likes`;
    });
    return el('li', { 'data-ui': 'part-card', class: 'part-card', 'data-slug': part.slug }, [
      thumbnail(part.head?.geometryDigest ?? null, `${part.title}, ${part.head?.label ?? 'r1'}`),
      el('a', { href: `/parts/${part.slug}`, class: 'card-title' }, [part.title]),
      el('p', { class: 'muted' }, [part.author.displayName]),
      el('p', { class: 'muted' }, [part.category]),
      el('p', { class: 'card-measures' }, [
        part.head ? volumeMm3(part.head.volume) : '',
        part.head ? ` · ${bboxText(part.head.bbox)}` : '',
      ]),
      el('div', { class: 'card-actions' }, [like, tooltip]),
    ]);
  }

  function paintCategories(list: { slug: string; name: string; count: number }[]): void {
    clear(categories);
    for (const entry of list) {
      const selected = entry.slug === 'all' ? category === null : entry.slug === category;
      const link = el(
        'a',
        {
          href: entry.slug === 'all' ? '/' : `/?category=${entry.slug}`,
          ...(selected ? { 'aria-current': 'true' } : {}),
        },
        [entry.slug === 'all' ? `All parts (${entry.count})` : `${entry.name} (${entry.count})`],
      );
      on(link, 'click', (event) => {
        event.preventDefault();
        category = entry.slug === 'all' ? null : entry.slug;
        void load(true);
      });
      categories.append(link);
    }
  }

  async function load(reset: boolean): Promise<void> {
    if (reset) {
      cursor = null;
      shown = 0;
    }
    const search = new URLSearchParams();
    if (category) search.set('category', category);
    search.set('sort', sortId);
    if (cursor) search.set('cursor', cursor);
    const result = await send<GalleryAnswer>(`/api/parts?${search.toString()}`);
    if (reset) clear(grid);
    for (const part of result.data.parts) grid.append(card(part));
    if (result.data.parts.length === 0 && reset) {
      const showAll = el('a', { href: '/' }, ['Show all parts']);
      on(showAll, 'click', (event) => {
        event.preventDefault();
        category = null;
        void load(true);
      });
      grid.append(
        el('li', { class: 'empty-state' }, ['No parts in this category yet.', showAll]),
      );
    }
    shown += result.data.parts.length;
    cursor = result.data.nextCursor;
    showMore.hidden = cursor === null;
    grid.setAttribute('data-epoch', String(epoch.advance()));
    paintCategories(result.data.categories);
    status.textContent = `Showing ${shown} parts.`;
    const next = new URL(window.location.href);
    if (category) next.searchParams.set('category', category);
    else next.searchParams.delete('category');
    next.searchParams.set('sort', sortId);
    history.replaceState(history.state, '', `${next.pathname}?${next.searchParams.toString()}`);
  }

  on(sort, 'change', () => {
    sortId = sort.value;
    void load(true);
  });
  on(showMore, 'click', () => void load(false));

  openLiveStream('*', {
    like: (data) => {
      const slug = String(data.partSlug);
      const likes = Number(data.likes);
      for (const node of all(`[data-ui="part-card"][data-slug="${slug}"]`, grid)) {
        const count = find('[data-ui="like-count"]', node);
        if (count) count.textContent = likes === 1 ? '1 like' : `${likes} likes`;
      }
    },
  });

  await load(true);
}
