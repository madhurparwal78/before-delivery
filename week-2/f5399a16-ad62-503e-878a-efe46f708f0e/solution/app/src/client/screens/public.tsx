// The public site: wipe, reveal, reel filter, client strip, accordions and the enquiry form.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { COPY } from '../../shared/copy';
import { drawingStrokes, heroStrokes } from '../../shared/drawing';
import { announce } from '../announce';
import { api } from '../api';
import { BASE, EASE, reducedMotion, travel, type Rect } from '../motion';
import { navigate, useRoute, withParams, type Route } from '../router';
import { Link, Problems, RadioGroup, TextArea, TextField, classOf, focusHeading, landScroll, useForm, useTitle } from '../ui/kit';

/** A drawn frame on white: the only imagery the public site has. */
function DrawnFrame({ seed }: { seed: number }) {
  return (
    <svg className="drawn-frame" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="1280" height="720" fill="#fff" />
      <g fill="none" stroke="#17171a" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: drawingStrokes(seed) }} />
    </svg>
  );
}

// Frame and wipe -----------------------------------------------------------------------------------

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="nav-link" href={href}>{children}</Link>;
}

function SiteHeader() {
  const [solid, setSolid] = useState(() => window.scrollY >= 24);
  useEffect(() => {
    const read = () => setSolid(window.scrollY >= 24);
    read();
    addEventListener('scroll', read, { passive: true });
    return () => removeEventListener('scroll', read);
  }, []);
  // Fixed, not sticky: bringing a sticky link into view scrolls the page back to the header's place in the flow,
  // so a press on it could lose the position Back returns to. The slot keeps the header's room in the flow.
  const slot = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const hold = () => {
      if (slot.current && bar.current) slot.current.style.height = `${bar.current.offsetHeight}px`;
    };
    hold();
    const watcher = new ResizeObserver(hold);
    if (bar.current) watcher.observe(bar.current);
    return () => watcher.disconnect();
  }, []);
  return (
    <div ref={slot}>
      <header ref={bar} className="site-header" data-solid={solid ? 'true' : undefined}>
        <Link className="wordmark nav-link" href="/">Noor Bakker Boards</Link>
        <nav aria-label="Site">
          <NavLink href="/reel">Reel</NavLink>
          <NavLink href="/how-it-works">How it works</NavLink>
          <NavLink href="/sign-in">Sign in</NavLink>
        </nav>
      </header>
    </div>
  );
}

/** A city link or address hash lands below the sticky header with focus on its heading. */
function landOnHash(hash: string): boolean {
  const target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
  if (!target) return false;
  const header = document.querySelector('.site-header')?.getBoundingClientRect().height ?? 0;
  window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - header - 12, behavior: 'instant' });
  target.focus({ preventScroll: true });
  return true;
}

function land(route: Route, focus: boolean): void {
  landScroll(route);
  if (route.hash && (route.by === 'push' || route.memory.y === undefined)) {
    if (landOnHash(route.hash)) return;
  }
  if (focus) focusHeading();
}

export function PublicFrame({ screen }: { screen: (path: string) => ReactNode }) {
  const route = useRoute();
  const [shownPath, setShownPath] = useState(route.path);
  const [wiping, setWiping] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const moving = useRef<Animation | null>(null);
  const firstLand = useRef(true);
  const latest = useRef(route);
  latest.current = route;

  useLayoutEffect(() => {
    if (firstLand.current) {
      firstLand.current = false;
      land(route, false);
      return;
    }
    if (route.path === shownPath) {
      if (route.hash && route.by === 'push') landOnHash(route.hash);
      return;
    }
    if (reducedMotion() || wiping) {
      moving.current?.cancel();
      moving.current = null;
      setWiping(false);
      setShownPath(route.path);
      return;
    }
    setWiping(true);
    // The route itself drives this; it starts once per address change.
  }, [route.address]);

  // A new page was placed with no wipe running: it lands at once.
  const placedPath = useRef(shownPath);
  useLayoutEffect(() => {
    if (placedPath.current !== shownPath) {
      placedPath.current = shownPath;
      if (!wiping) land(latest.current, true);
    }
  }, [shownPath, wiping]);

  useLayoutEffect(() => {
    if (!wiping || !panel.current) return;
    const element = panel.current;
    const skew = 'skewX(-18deg)';
    const cover = element.animate(
      [{ transform: `translateX(-130%) ${skew}` }, { transform: `translateX(0) ${skew}` }],
      { duration: BASE, easing: EASE, fill: 'forwards' },
    );
    moving.current = cover;
    let cancelled = false;
    void cover.finished.then(
      () => {
        if (cancelled) return;
        setShownPath(latest.current.path);
        requestAnimationFrame(() => {
          if (cancelled) return;
          landScroll(latest.current);
          if (latest.current.hash) landOnHash(latest.current.hash);
          const uncover = element.animate(
            [{ transform: `translateX(0) ${skew}` }, { transform: `translateX(130%) ${skew}` }],
            { duration: BASE, easing: EASE, fill: 'forwards' },
          );
          moving.current = uncover;
          void uncover.finished.then(
            () => {
              if (cancelled) return;
              moving.current = null;
              setWiping(false);
              if (!latest.current.hash) focusHeading();
            },
            () => undefined,
          );
        });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [wiping]);

  return (
    <>
      <div className="public-page" inert={wiping && shownPath !== route.path}>
        <SiteHeader />
        {screen(shownPath)}
      </div>
      {wiping ? <div ref={panel} className="route-wipe" data-part="route-wipe" /> : null}
    </>
  );
}

function PublicHeading({ lines, title }: { lines: string[]; title: string }) {
  useTitle(title);
  return (
    <h1 tabIndex={-1} className="reveal">
      {lines.map((line, index) => (
        <span key={line}>
          <span className="heading-line" data-part="heading-line" style={{ animationDelay: `${index * 80}ms` }}>{line}</span>
          {index < lines.length - 1 ? ' ' : null}
        </span>
      ))}
    </h1>
  );
}

// Home ---------------------------------------------------------------------------------------------

const KINDS: [string, string][] = [
  ['Boards', 'Frames drawn to the script, shot by shot, ready for the room.'],
  ['Reels', 'Those frames timed to the frame against a target length.'],
  ['Pitch frames', 'A few frames that sell the idea before the job exists.'],
];

export function Home() {
  return (
    <main className="home">
      <section className="hero">
        <div className="hero-frame">
          <svg className="hero-sheet" viewBox="0 0 640 960" preserveAspectRatio="xMinYMid slice" aria-hidden="true">
            <rect width="640" height="960" fill="#fff" />
            <g fill="none" stroke="#17171a" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: heroStrokes() }} />
          </svg>
          <div className="hero-bar" />
        </div>
        <div className="hero-card">
          <div className="clap-band" aria-hidden="true" />
          <p className="hero-wordmark">Noor Bakker Boards</p>
          <PublicHeading title="Boards drawn to the frame" lines={['Boards drawn', 'to the frame']} />
          <p className="hero-line">Storyboards and story reels for advertising producers.</p>
          <Link className={`${classOf('primary')} hero-action`} href="/reel">See the reel</Link>
          <div className="hero-foot">
            <NavLink href="/how-it-works">How it works</NavLink>
            <NavLink href="/how-it-works#amsterdam">Contact</NavLink>
            <NavLink href="/sign-in">Sign in</NavLink>
          </div>
        </div>
      </section>
      <section className="kinds" aria-label="Kinds of work">
        <ul>
          {KINDS.map(([name, text]) => (
            <li key={name}><span className="bullet" aria-hidden="true" /><strong>{name}</strong> {text}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

// Reel ---------------------------------------------------------------------------------------------

const WORK: { title: string; kind: string; seed: number }[] = [
  { title: 'Ferry at First Light', kind: 'boards', seed: 1 },
  { title: 'The Long Bakery Shift', kind: 'boards', seed: 5 },
  { title: 'Cold Snap Cola', kind: 'boards', seed: 7 },
  { title: 'Night Tram', kind: 'reels', seed: 9 },
  { title: 'Harbour Swimmers', kind: 'reels', seed: 12 },
  { title: 'Paper Kites', kind: 'reels', seed: 6 },
  { title: 'Rainline Coats', kind: 'pitchFrames', seed: 10 },
  { title: 'Orchard Bank', kind: 'pitchFrames', seed: 8 },
  { title: 'Salt and Thyme', kind: 'pitchFrames', seed: 3 },
];
const KIND_LABEL: Record<string, string> = { boards: 'Boards', reels: 'Reels', pitchFrames: 'Pitch frames' };
const CLIENT_NAMES = ['Tidewater Soda', 'Kestrel Air', 'Oak & Ember Bakers', 'Northquay Bank', 'Lumen Bicycles', 'Saffron Street Foods'];

function ClientStrip() {
  const [held, setHeld] = useState(false);
  return (
    <section
      className="client-strip"
      data-part="client-strip"
      data-held={held ? 'true' : undefined}
      aria-label="Clients"
      tabIndex={0}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHeld(true); }}
      onPointerLeave={(event) => { if (event.pointerType !== 'touch') setHeld(false); }}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="client-track">
        <ul>{CLIENT_NAMES.map((name) => <li key={name}>{name}</li>)}</ul>
        <ul aria-hidden="true" className="client-repeat">{CLIENT_NAMES.map((name) => <li key={name}>{name}</li>)}</ul>
      </div>
    </section>
  );
}

export function PublicReel() {
  const route = useRoute();
  const kind = route.search.get('kind') ?? 'all';
  const items = useRef(new Map<string, HTMLLIElement>());
  const rects = useRef(new Map<string, Rect>());
  const grid = useRef<HTMLUListElement>(null);

  const measure = () => {
    for (const [title, element] of items.current) {
      if (element.hidden) continue;
      const box = element.getBoundingClientRect();
      rects.current.set(title, { left: box.left, top: box.top });
    }
  };

  useLayoutEffect(() => {
    if (!grid.current?.dataset.kind) {
      if (grid.current) grid.current.dataset.kind = kind;
      measure();
      return;
    }
    if (grid.current.dataset.kind === kind) return;
    grid.current.dataset.kind = kind;
    for (const [title, element] of items.current) {
      const was = rects.current.get(title);
      if (element.hidden) {
        rects.current.delete(title);
        continue;
      }
      if (was) {
        travel(element, was);
      } else if (!reducedMotion()) {
        element.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: BASE, easing: EASE });
      }
    }
    measure();
  }, [kind]);

  useEffect(() => {
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, []);

  return (
    <main className="page">
      <PublicHeading title="Work on the reel" lines={['Work on', 'the reel']} />
      <RadioGroup
        label="Kind of work"
        name="kind"
        value={kind}
        options={[['all', 'All'], ['boards', 'Boards'], ['reels', 'Reels'], ['pitchFrames', 'Pitch frames']]}
        onChange={(value) => {
          measure();
          navigate(withParams(route, { kind: value === 'all' ? null : value }));
        }}
      />
      <ul ref={grid} className="work-grid">
        {WORK.map((item) => (
          <li
            key={item.title}
            data-part="work"
            hidden={kind !== 'all' && item.kind !== kind}
            ref={(element) => {
              if (element) items.current.set(item.title, element);
            }}
          >
            <div className="slant-mask"><DrawnFrame seed={item.seed} /></div>
            <h2>{item.title}</h2>
            <p className="muted">{KIND_LABEL[item.kind]}</p>
          </li>
        ))}
      </ul>
      <ClientStrip />
    </main>
  );
}

// How it works -------------------------------------------------------------------------------------

const STEPS: { key: string; title: string; text: string }[] = [
  { key: 'script', title: 'From script to frames', text: 'A script file comes in, each row becomes a frame, and every frame gets its drawing.' },
  { key: 'timing', title: 'Timing the reel', text: 'Each clip is trimmed on the Slate strip until the reel is exact against its target length.' },
  { key: 'review', title: 'Review and notes', text: 'The producer gets a private page in their own language, pins notes on the frames and signs off by name.' },
  { key: 'delivery', title: 'Delivery and fee letter', text: 'The signed cut goes out as boards PDF, edit decision list and shot list, with a fee letter whose cents are exact.' },
];

function Accordion({ step, open, onToggle }: { step: (typeof STEPS)[number]; open: boolean; onToggle: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  const first = useRef(true);
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const element = panel.current;
    if (!element) return;
    if (reducedMotion()) {
      if (!open) setPresent(false);
      return;
    }
    element.style.overflow = 'hidden';
    const height = `${element.scrollHeight}px`;
    const frames = [{ height: open ? '0px' : height }, { height: open ? height : '0px' }];
    const moving = element.animate(frames, { duration: BASE, easing: EASE });
    void moving.finished.then(
      () => {
        element.style.overflow = '';
        if (!open) setPresent(false);
      },
      () => undefined,
    );
    return () => moving.cancel();
  }, [open]);
  const id = `panel-${step.key}`;
  return (
    <div className="accordion">
      <h2>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span className="bullet" aria-hidden="true" />{step.title}
        </button>
      </h2>
      <div ref={panel} id={id} hidden={!present} inert={!open} className="accordion-panel">
        <p>{step.text}</p>
      </div>
    </div>
  );
}

const CITIES: [string, string, string][] = [
  ['amsterdam', 'Amsterdam', 'The desk itself, at the top of the Prinsengracht.'],
  ['new-york', 'New York', 'Calls in New York wall time, morning there.'],
  ['toronto', 'Toronto', 'Calls in Toronto wall time, morning there.'],
];
const ADDRESS = 'desk@noorbakkerboards.example';

function CopyAddress() {
  const text = useRef<HTMLSpanElement>(null);
  const press = async () => {
    try {
      await navigator.clipboard.writeText(ADDRESS);
      announce(COPY.addressCopied);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(text.current as HTMLSpanElement);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      announce(COPY.pressCopy);
    }
  };
  return (
    <p className="address-line">
      <span ref={text} className="address">{ADDRESS}</span>
      <button type="button" className="btn btn-ink" onClick={() => void press()}>Copy address</button>
    </p>
  );
}

function EnquiryForm() {
  const form = useForm(null, () => ({ name: '', email: '', phone: '', message: '' }));
  const send = () =>
    form.submit(async () => {
      const answer = await api<{ message: string }>('/api/enquiries', { method: 'POST', body: form.values });
      announce(answer.message);
      form.setAll({ name: '', email: '', phone: '', message: '' });
      setThanks(answer.message);
    });
  const [thanks, setThanks] = useState<string | null>(null);
  return (
    <form
      aria-label="Enquiry"
      className="enquiry"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Problems form={form} />
      <TextField form={form} name="name" label="Name" autoComplete="name" />
      <TextField form={form} name="email" label="Email" autoComplete="email" type="text" inputMode="email" />
      <TextField form={form} name="phone" label="Phone" autoComplete="tel" inputMode="tel" />
      <TextArea form={form} name="message" label="Message" />
      <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? COPY.working : 'Send enquiry'}</button>
      {thanks ? <p className="thanks">{thanks}</p> : null}
    </form>
  );
}

export function HowItWorks() {
  const route = useRoute();
  const open = route.search.get('open');
  return (
    <main className="page">
      <PublicHeading title="How the work runs" lines={['How the', 'work runs']} />
      <div className="accordions">
        {STEPS.map((step) => (
          <Accordion
            key={step.key}
            step={step}
            open={open === step.key}
            onToggle={() => navigate(withParams(route, { open: open === step.key ? null : step.key }) + route.hash, { replace: true })}
          />
        ))}
      </div>
      <section className="contact">
        <h2 className="section-title">Contact</h2>
        <div className="cities">
          <nav aria-label="Cities">
            {CITIES.map(([id, city]) => (
              <a
                key={id}
                className="nav-link"
                href={`#${id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`${withParams(route, {})}#${id}`);
                }}
              >
                {city}
              </a>
            ))}
          </nav>
          {CITIES.map(([id, city, line]) => (
            <div key={id} className="city">
              <h3 id={id} tabIndex={-1}>{city}</h3>
              <p>{line}</p>
            </div>
          ))}
        </div>
        <CopyAddress />
        <EnquiryForm />
      </section>
    </main>
  );
}

