import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cascadeStyles, colourHex } from '../../shared/derive.ts';
import { layoutDoc } from '../../shared/layout.ts';
import type { MapDoc } from '../../shared/model.ts';
import { childrenIndex, rootOf } from '../../shared/tree.ts';
import { Accordion, type AccordionItem } from '../ui/Accordion.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Link } from '../ui/Link.tsx';
import { Logo, LogoMark } from '../ui/Logo.tsx';
import { MiniMap } from '../ui/MiniMap.tsx';
import { CHAPTER_PLAN, HERO_DOC, RUNBOOK, SEED_SWAP, TRAIN_NOTES } from '../ui/sampleMaps.ts';
import { useMedia } from '../ui/useMedia.ts';

/* ------------------------------------------------------------------ top bar */

/** True once the page has scrolled past the threshold; false again at the top. Read once per animation frame. */
function useScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(() => window.scrollY > threshold);
  useLayoutEffect(() => {
    let frame = requestAnimationFrame(function check() {
      setScrolled(window.scrollY > threshold);
      frame = requestAnimationFrame(check);
    });
    return () => cancelAnimationFrame(frame);
  }, [threshold]);
  return scrolled;
}

function TopBar() {
  const scrolled = useScrolled(16);
  return (
    <header class={`sitebar${scrolled ? ' is-compact' : ''}`}>
      <div class="sitebar-row">
        <Logo />
        <nav class="sitebar-actions" aria-label="Account">
          <Link href="/signin" class="btn btn-text sitebar-signin">
            Sign in
          </Link>
          <Link href="/signup" class="btn btn-primary">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- branch field */

interface Strand {
  id: string;
  colour: string;
  x: number;
  y: number;
  side: -1 | 1;
}

/** The hero map's eight level 2 topics, laid out by the app's own engine. */
const STRANDS: { strands: Strand[]; reachX: number; reachY: number } = (() => {
  const layout = layoutDoc(HERO_DOC, new Set());
  const styles = cascadeStyles(HERO_DOC);
  const root = rootOf(HERO_DOC.topics);
  const kids = root ? (childrenIndex(HERO_DOC.topics).get(root.id) ?? []) : [];
  const strands: Strand[] = [];
  for (const kid of kids) {
    const box = layout.boxes.get(kid.id);
    if (!box) continue;
    strands.push({ id: kid.id, colour: colourHex(styles.get(kid.id)?.colour ?? 'accent'), x: box.x, y: box.y, side: box.side === 'left' ? -1 : 1 });
  }
  return { strands, reachX: Math.max(...strands.map((s) => Math.abs(s.x))), reachY: Math.max(...strands.map((s) => Math.abs(s.y))) };
})();

const WIDTHS = [42, 38, 40, 44, 40, 42, 38, 44];
const INITIALS = ['MA', 'JO', 'TK'];

interface Point {
  x: number;
  y: number;
}

interface Ribbon {
  d: string;
  colour: string;
  width: number;
  from: Point;
  c1: Point;
  c2: Point;
  to: Point;
}

const bezier = (r: Ribbon, t: number): Point => {
  const u = 1 - t;
  return {
    x: u * u * u * r.from.x + 3 * u * u * t * r.c1.x + 3 * u * t * t * r.c2.x + t * t * t * r.to.x,
    y: u * u * u * r.from.y + 3 * u * u * t * r.c1.y + 3 * u * t * t * r.c2.y + t * t * t * r.to.y,
  };
};

/** Stretch the engine's coordinates over the field: children run to the screen edges, the root becomes the centred stack. */
function ribbonsFor(w: number, h: number, phone: boolean): Ribbon[] {
  const { strands, reachX, reachY } = STRANDS;
  return strands.map((s, i) => {
    let from: Point;
    let to: Point;
    if (phone) {
      // tips only: a short stub entering from the edge, converging a little
      const mid = h / 2;
      const y0 = mid + (s.y / reachY) * (h / 2 - 34);
      const tip = Math.min(130, w * 0.34);
      from = { x: s.side < 0 ? -24 : w + 24, y: y0 };
      to = { x: s.side < 0 ? tip : w - tip, y: mid + (y0 - mid) * 0.82 };
    } else {
      const cx = w / 2;
      const cy = h / 2;
      const over = 48;
      const sx = (w / 2 + over) / reachX;
      const sy = (h * 0.4) / reachY;
      const endDx = Math.min(300, Math.max(210, w * 0.2));
      from = { x: cx + s.x * sx, y: cy + s.y * sy };
      to = { x: cx + s.side * endDx, y: cy + s.y * sy * 0.3 };
    }
    const mid = (from.x + to.x) / 2;
    const c1 = { x: mid, y: from.y };
    const c2 = { x: mid, y: to.y };
    return {
      d: `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
      colour: s.colour,
      width: WIDTHS[i] ?? 40,
      from,
      c1,
      c2,
      to,
    };
  });
}

/** Which ribbon each avatar rides, and how far along it. */
const RIDERS_DESK: { ribbon: number; at: number; tip: 'left' | 'right' | 'below' }[] = [
  { ribbon: 1, at: 0.4, tip: 'below' },
  { ribbon: 4, at: 0.46, tip: 'left' },
  { ribbon: 7, at: 0.46, tip: 'below' },
];
const RIDERS_PHONE: { ribbon: number; at: number; tip: 'left' | 'right' | 'below' }[] = [
  { ribbon: 1, at: 0.5, tip: 'below' },
  { ribbon: 6, at: 0.5, tip: 'left' },
];

function HeroField() {
  const ref = useRef<HTMLDivElement>(null);
  const phone = useMedia('(max-width: 767px)');
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: phone ? 250 : Math.min(780, Math.max(600, window.innerHeight - 88)) }));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize((old) => (Math.abs(old.w - width) < 0.5 && Math.abs(old.h - height) < 0.5 ? old : { w: width, h: height }));
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  const ribbons = useMemo(() => ribbonsFor(size.w, size.h, phone), [size.w, size.h, phone]);
  const riders = phone ? RIDERS_PHONE : RIDERS_DESK;

  return (
    <div ref={ref} class="hero-field" aria-hidden="true" data-ribbons={ribbons.length}>
      <svg class="ribbons" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} focusable="false">
        {ribbons.map((r, i) => (
          <path key={i} class="ribbon" d={r.d} pathLength="1" fill="none" stroke={r.colour} stroke-width={r.width} stroke-linecap="round" data-side={i < 4 ? 'left' : 'right'} />
        ))}
      </svg>
      {riders.map((rider, n) => {
        const ribbon = ribbons[rider.ribbon];
        if (!ribbon) return null;
        const at = bezier(ribbon, rider.at);
        return (
          <span key={n} class="rider" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
            <span class={`avatar avatar-${n + 1}`} data-tip={rider.tip} style={{ '--avatar-ring': ribbon.colour }}>
              <svg class="pointer" width="30" height="34" viewBox="0 0 30 34" focusable="false">
                <path d="M3 3 27 12 15 16 11 29z" fill={ribbon.colour} stroke="#fff" stroke-width="3" stroke-linejoin="round" />
              </svg>
              <span class="avatar-initials">{INITIALS[n]}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** A hand-drawn arrow curling down toward the Get started button. */
function HeroArrow() {
  return (
    <svg class="hero-arrow" width="132" height="86" viewBox="0 0 132 86" aria-hidden="true" focusable="false">
      <path class="hero-arrow-line" d="M112 4C120 30 108 50 76 52S36 54 36 72" pathLength="1" fill="none" stroke="var(--c-teal)" stroke-width="4" stroke-linecap="round" />
      <path class="hero-arrow-head" d="M22 60 36 78 50 60" pathLength="1" fill="none" stroke="var(--c-teal)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------ feature blocks */

interface Feature {
  id: string;
  title: string;
  text: string;
  checks: [string, string, string];
  doc: MapDoc;
  aside: ComponentChildren;
}

const FEATURES: Feature[] = [
  {
    id: 'grow',
    title: 'Start with one idea and let it branch',
    text: 'Every Sprigmap begins with a central idea. Press Tab to add a branch, Enter for a sibling, and keep your hands on the keyboard while the map grows around you.',
    checks: ['Add, rename and reorder topics without the mouse', 'Switch between mind map, org chart and list', 'Pin a branch to the left or right side'],
    doc: SEED_SWAP,
    aside: (
      <div class="fragment fragment-keys">
        <kbd>Tab</kbd>
        <span>Add a branch</span>
      </div>
    ),
  },
  {
    id: 'together',
    title: 'Edit together, in real time',
    text: 'Invite a few people and watch their cursors move through the same map. Changes land on every screen at once, and one published rule settles every conflict.',
    checks: ['Live cursors, selections and presence', 'Comments, @mentions and star votes', 'Undo that only reverses your own changes'],
    doc: CHAPTER_PLAN,
    aside: (
      <div class="fragment fragment-comment">
        <span class="mini-avatar" aria-hidden="true">
          MA
        </span>
        <span>Should the storm come first?</span>
      </div>
    ),
  },
  {
    id: 'offline',
    title: 'Keep going when the train goes underground',
    text: 'Switch on offline mode and carry on editing. Your changes wait in the browser, survive a reload and are replayed once, in order, when you are back.',
    checks: ['Queued changes survive a reload', 'Concurrent edits merge character by character', 'Replay any version and restore it in one step'],
    doc: TRAIN_NOTES,
    aside: (
      <div class="fragment fragment-status">
        <Icon name="history" size={18} />
        <span class="tnum">3 changes waiting</span>
      </div>
    ),
  },
  {
    id: 'share',
    title: 'Share it, then present it live',
    text: 'Give each person exactly the access they need, from owner to viewer. Links expire on time, restricted branches stay private, and an audience can follow along from a phone.',
    checks: ['Four roles with clear limits', 'Share links that expire at a set time', 'Present to an audience that needs no account'],
    doc: RUNBOOK,
    aside: (
      <div class="fragment fragment-status">
        <Icon name="eye" size={18} />
        <span>Viewer</span>
      </div>
    ),
  },
];

function FeatureBlock({ feature, index }: { feature: Feature; index: number }) {
  return (
    <section id={feature.id} class="feature" data-side={index % 2 === 0 ? 'text-left' : 'text-right'}>
      <div class="feature-text">
        <h2>{feature.title}</h2>
        <p class="feature-copy">{feature.text}</p>
        <ul class="checks">
          {feature.checks.map((line) => (
            <li key={line}>
              <Icon name="check" size={20} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <div class="feature-panel">
        <MiniMap doc={feature.doc} padding={20} minZoom={0.6} initial={{ w: 540, h: 380 }} />
        {feature.aside}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- footer */

interface FooterColumn {
  id: string;
  title: string;
  links: { label: string; href: string }[];
}

const COLUMNS: FooterColumn[] = [
  {
    id: 'product',
    title: 'Product',
    links: [
      { label: 'Grow a map', href: '#grow' },
      { label: 'Edit together', href: '#together' },
      { label: 'Work offline', href: '#offline' },
      { label: 'Share and present', href: '#share' },
    ],
  },
  {
    id: 'account',
    title: 'Account',
    links: [
      { label: 'Create an account', href: '/signup' },
      { label: 'Sign in', href: '/signin' },
      { label: 'Your maps', href: '/maps' },
    ],
  },
  {
    id: 'roles',
    title: 'Who it is for',
    links: [
      { label: 'Study groups', href: '#grow' },
      { label: 'Writers and co-writers', href: '#together' },
      { label: 'Volunteers and households', href: '#share' },
    ],
  },
];

function FooterLinks({ column }: { column: FooterColumn }) {
  return (
    <ul class="footer-links plain">
      {column.links.map((l) => (
        <li key={l.label}>
          {l.href.startsWith('#') ? (
            <a href={l.href}>{l.label}</a>
          ) : (
            <Link href={l.href}>{l.label}</Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function Footer() {
  const phone = useMedia('(max-width: 767px)');
  const items: AccordionItem[] = COLUMNS.map((c) => ({ id: c.id, title: c.title, body: <FooterLinks column={c} /> }));
  return (
    <footer class="footer">
      <div class="footer-inner">
        <h2 class="sr-only">Site links</h2>
        <div class="footer-top">
          <div class="footer-brand">
            <Link href="/" class="logo footer-logo" aria-label="Sprigmap">
              <LogoMark size={32} />
              <span class="logo-word">Sprigmap</span>
            </Link>
            <p>Mind maps that grow with the people who build them.</p>
          </div>
          {phone ? (
            <Accordion items={items} variant="plain" headingLevel={3} class="footer-acc" />
          ) : (
            <div class="footer-columns">
              {COLUMNS.map((c) => (
                <div class="footer-column" key={c.id}>
                  <h3>{c.title}</h3>
                  <FooterLinks column={c} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div class="footer-bottom">
          <p>Made by Twinefold Software. Every map, person and business on this page is invented.</p>
        </div>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------------- page */

export function Home() {
  return (
    <div class="home">
      <TopBar />
      <main id="top">
        <section class="hero">
          <HeroField />
          <div class="hero-stack">
            <p class="hero-eyebrow">One idea, many branches</p>
            <h1 class="hero-title">
              Grow a map <br />
              together
            </h1>
            <HeroArrow />
            <div class="hero-cta">
              <Link href="/signup" class="btn btn-primary btn-lg">
                Get started
              </Link>
              <Link href="/signin" class="btn btn-secondary btn-lg">
                I already have an account
              </Link>
            </div>
          </div>
        </section>
        <section class="statement">
          <p>Sprigmap is the shared mind map where every plan starts as one idea and grows with the people you invite.</p>
        </section>
        <div class="features">
          {FEATURES.map((feature, index) => (
            <FeatureBlock key={feature.id} feature={feature} index={index} />
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
