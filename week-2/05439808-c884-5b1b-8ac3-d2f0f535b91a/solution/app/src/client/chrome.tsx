// The fixed signed-in chrome: the top rule with its readouts and Main navigation, and the Queues rail.
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BUILDINGS, RESOURCES, UNITS, type Resource } from '../shared/catalog';
import { api } from './api';
import { amountsText, localTime, mss } from './copy';
import { Icon, type IconName } from './icons';
import { RaidClock } from './raid';
import { loadVillage, navigate, openPanel, reducedMotion, serverNow, signOut, type Panel } from './store';
import type { Army } from './types';
import { Empty, Num, useBusy, useRerender, useStore } from './ui';

/** Re-renders once a second so countdowns tick from the server's finish times. */
export function useSecondTick(): void {
  const rerender = useRerender();
  useEffect(() => {
    const timer = window.setInterval(rerender, 1000);
    return () => clearInterval(timer);
  }, []);
}

const label = (r: Resource): string => r.charAt(0).toUpperCase() + r.slice(1);

/** One readout: its name and its value, side by side on laptops and stacked in a cell on smaller screens. */
function Readout({ name, children, tone = '' }: { name: string; children: ComponentChildren; tone?: string }) {
  return (
    <span class={`readout ${tone}`}>
      <span class="rl">{name}</span> <span class="rv">{children}</span>
    </span>
  );
}

function Resources() {
  const v = useStore().village;
  return (
    <div role="group" aria-label="Resources" class="resources">
      {v &&
        RESOURCES.map((r) => (
          <Readout key={r} name={label(r)}>
            <Num value={v.resources[r].amount} /> / <Num value={v.resources[r].cap} />
          </Readout>
        ))}
    </div>
  );
}

function Stats() {
  const s = useStore();
  useSecondTick();
  const v = s.village;
  if (!v) return null;
  const shielded = v.shield !== null && Date.parse(v.shield.endsAt) > serverNow();
  return (
    <>
      <Readout name="Builders">
        <Num value={v.builders.free} />/<Num value={v.builders.total} />
      </Readout>
      <Readout name="Saltmark">
        <Num value={v.saltmark} />
      </Readout>
      <Readout name="Army">
        <Num value={v.army.housing.used} />/<Num value={v.army.housing.capacity} />
      </Readout>
      <Readout name="Trophies">
        <Num value={v.trophies} />
      </Readout>
      <Readout name="League">{v.league}</Readout>
      {shielded && v.shield && (
        <Readout name="Shielded until" tone="shield">
          <span class="num">{localTime(v.shield.endsAt, s.me?.timeZone ?? 'UTC')}</span>
        </Readout>
      )}
    </>
  );
}

type PanelKind = Panel['kind'];

function NavLink({ icon, text, name, href, active, onOpen, badge }: {
  icon: IconName; text: string; name?: string; href: string; active: boolean; onOpen: () => void; badge?: number;
}) {
  return (
    <li>
      <a
        class="navlink"
        href={href}
        aria-label={name ?? text}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          onOpen();
        }}
      >
        <Icon name={icon} />
        <span class="label">{text}</span>
        {badge ? (
          <span class="badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </a>
    </li>
  );
}

function MainNav() {
  const s = useStore();
  const [busy, run] = useBusy();
  const operator = s.me?.role === 'operator';
  const panelLink = (kind: PanelKind, icon: IconName, text: string, name?: string, badge?: number) => (
    <NavLink
      key={kind}
      icon={icon}
      text={text}
      name={name}
      badge={badge}
      href={`?panel=${kind}`}
      active={s.panel?.kind === kind}
      onOpen={() => openPanel(s.panel?.kind === kind ? null : ({ kind } as Panel))}
    />
  );
  const routeLink = (path: string, icon: IconName, text: string, active: boolean) => (
    <NavLink key={path} icon={icon} text={text} href={path} active={active} onOpen={() => navigate(path)} />
  );
  return (
    <nav class="mainnav" aria-label="Main">
      <ul>
        {routeLink('/', 'village', 'Village', s.path === '/')}
        {operator ? routeLink('/ops', 'ops', 'Operations', s.path === '/ops') : routeLink('/scout', 'raid', 'Raid', s.path.startsWith('/scout') || s.path.startsWith('/raids/'))}
        {!operator && panelLink('raid-log', 'raidLog', 'Raid log')}
        {!operator && panelLink('clan', 'clan', 'Clan', s.unread > 0 ? `Clan (${s.unread} unread)` : 'Clan', s.unread)}
        {panelLink('league', 'league', 'League')}
        {!operator && panelLink('rewards', 'rewards', 'Rewards')}
        {panelLink('profile', 'profile', 'Profile')}
        <li>
          <button
            type="button"
            class="navlink"
            aria-label="Sign out"
            aria-busy={busy ? 'true' : undefined}
            onClick={() => void run({ pending: 'Signing out…', run: signOut })}
          >
            <Icon name="signOut" />
            <span class="label">Sign out</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** Publishes the band's real height as --top-h, so the rail, panels, banner and toasts start below it. */
function useTopHeight(header: RefObject<HTMLElement>): void {
  useEffect(() => {
    const root = document.documentElement;
    const observer = new ResizeObserver(([entry]) => {
      root.style.setProperty('--top-h', `${Math.ceil(entry?.borderBoxSize[0]?.blockSize ?? 0)}px`);
    });
    if (header.current) observer.observe(header.current);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--top-h');
    };
  }, []);
}

const PHONE = '(max-width: 700px)';

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const change = (): void => setPhone(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return phone;
}

type Edges = { over: boolean; start: boolean; end: boolean };

/** Whether the strip is wider than its row, and whether more of it lies past its left (start) or right (end) edge. */
function useEdges(strip: RefObject<HTMLElement>): Edges {
  const [edges, setEdges] = useState<Edges>({ over: false, start: false, end: false });
  useEffect(() => {
    const el = strip.current;
    if (!el) return undefined;
    const measure = (): void => {
      const max = el.scrollWidth - el.clientWidth;
      // A row-reverse strip counts scrollLeft from 0 at its right end down to -max.
      const fromLeft = getComputedStyle(el).flexDirection === 'row-reverse' ? el.scrollLeft + max : el.scrollLeft;
      const next = { over: max > 1, start: fromLeft > 1, end: fromLeft < max - 1 };
      setEdges((prev) => (prev.over === next.over && prev.start === next.start && prev.end === next.end ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const content = new MutationObserver(measure);
    content.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      content.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);
  return edges;
}

/** A band row that scrolls sideways inside itself when its content outgrows it. A solid marker shows each edge with more
    beyond it and scrolls that way when pressed; the wheel scrolls it too. A readouts-only strip takes keyboard focus then. */
function Strip({ children, class: cls, readouts }: { children: ComponentChildren; class: string; readouts: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  const edges = useEdges(strip);
  const page = (direction: number): void => {
    const el = strip.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  return (
    <div class={`strip-wrap ${cls}`}>
      <div
        ref={strip}
        class="band-strip"
        role={readouts ? 'group' : undefined}
        aria-label={readouts ? 'Island readouts' : undefined}
        tabIndex={readouts && edges.over ? 0 : undefined}
        onWheel={(e) => {
          const el = strip.current;
          if (!el || !edges.over || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }}
      >
        {children}
      </div>
      {edges.start && (
        <span class="more more-start" aria-hidden="true" onClick={() => page(-1)}>
          <Icon name="back" />
        </span>
      )}
      {edges.end && (
        <span class="more more-end" aria-hidden="true" onClick={() => page(1)}>
          <Icon name="next" />
        </span>
      )}
    </div>
  );
}

/** Laptops and tablets: one row, the raid clock first, then the readouts, navigation at the right end. */
function OneRow() {
  return (
    <>
      <Strip class="one-row" readouts>
        <RaidClock />
        <Resources />
        <Stats />
      </Strip>
      <MainNav />
    </>
  );
}

/** Phones: the resources on the first row; on the second the icon navigation holds the right end and the other
    readouts, the raid clock first, scroll in from its left. */
function TwoRows() {
  return (
    <>
      <Strip class="band-row" readouts>
        <Resources />
      </Strip>
      <Strip class="band-row from-end" readouts={false}>
        <MainNav />
        <div class="stats">
          <RaidClock />
          <Stats />
        </div>
      </Strip>
    </>
  );
}

export function TopRule() {
  const header = useRef<HTMLElement>(null);
  useTopHeight(header);
  const phone = usePhone();
  return (
    <header ref={header} class={phone ? 'toprule two-rows' : 'toprule'}>
      {phone ? <TwoRows /> : <OneRow />}
    </header>
  );
}

function BuilderQueue() {
  const s = useStore();
  const jobs = (s.village?.buildings ?? [])
    .filter((b) => b.upgrade !== null)
    .sort((a, b) => Date.parse(a.upgrade?.finishesAt ?? '') - Date.parse(b.upgrade?.finishesAt ?? ''));
  const now = serverNow();
  return (
    <section>
      <h3>Builders</h3>
      <ul class="queue" aria-label="Builder queue">
        {jobs.map((b) => (
          <li key={b.id}>
            <span>
              {BUILDINGS[b.type].name} → level <span class="num">{b.upgrade?.toLevel}</span> ·{' '}
              <span class="num">{mss(Date.parse(b.upgrade?.finishesAt ?? '') - now)}</span>
            </span>
          </li>
        ))}
      </ul>
      {jobs.length === 0 && <Empty>Every builder is resting.</Empty>}
    </section>
  );
}

function ArmyRow({ batch, running }: { batch: Army['training'][number]; running: boolean }) {
  const s = useStore();
  const [busy, run] = useBusy();
  const unit = UNITS[batch.unit].name;
  const now = serverNow();
  return (
    <li>
      <span>
        <span class="num">{batch.count}</span> × {unit} ·{' '}
        {running ? <span class="num">{mss(Date.parse(batch.finishesAt) - now)}</span> : <>starts <span class="num">{localTime(batch.startsAt, s.me?.timeZone ?? 'UTC')}</span></>}
      </span>
      <button
        type="button"
        class="btn quiet"
        aria-label={`Cancel training of ${batch.count} ${unit}`}
        aria-busy={busy ? 'true' : undefined}
        onClick={() =>
          void run({
            pending: 'Cancelling training…',
            run: () => api.post<{ army: Army; refunded: Record<Resource, number> }>(`/api/army/training/${batch.id}/cancel`),
            success: (r) => `Training of ${batch.count} ${unit} cancelled. Refunded ${amountsText(r.refunded)}.`,
            errors: { batch_already_finished: 'That training already finished. Nothing was refunded.' },
          }).then(() => loadVillage().catch(() => undefined))
        }
      >
        <Icon name="close" />
      </button>
    </li>
  );
}

function ArmyQueue() {
  const s = useStore();
  const batches = s.village?.army.training ?? [];
  const now = serverNow();
  return (
    <section>
      <h3>Army</h3>
      <ul class="queue" aria-label="Army queue">
        {batches.map((b) => (
          <ArmyRow key={b.id} batch={b} running={Date.parse(b.startsAt) <= now} />
        ))}
      </ul>
      {batches.length === 0 && <Empty>No training under way.</Empty>}
    </section>
  );
}

export function QueuesRail() {
  useSecondTick();
  const [open, setOpen] = useState(() => window.innerWidth >= 1180);
  return (
    <section class={open ? 'rail' : 'rail collapsed'} aria-label="Queues">
      <div class="rail-head">
        {open && <h2>Queues</h2>}
        <button type="button" class="btn quiet" aria-expanded={open ? 'true' : 'false'} aria-controls="rail-body" onClick={() => setOpen(!open)}>
          <Icon name="queues" />
          {open ? 'Hide queues' : 'Show queues'}
        </button>
      </div>
      <div class="rail-body" id="rail-body" hidden={!open}>
        <BuilderQueue />
        <ArmyQueue />
      </div>
    </section>
  );
}

