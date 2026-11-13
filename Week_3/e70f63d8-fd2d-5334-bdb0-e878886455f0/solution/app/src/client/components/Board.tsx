import type { JSX } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { CommentaryItem, DeliveryItem, MatchState } from '../../shared/wire.js';
import { configStore } from '../lib/config.js';

interface Section { name: 'runs' | 'wickets' | 'overs'; digits: string[]; value: number }

const sectionsOf = (state: MatchState): Section[] => [
  { name: 'runs', digits: [...String(state.runs)], value: state.runs },
  { name: 'wickets', digits: [...String(state.wickets)], value: state.wickets },
  { name: 'overs', digits: [...state.overs_text].filter((char) => char !== '.'), value: state.legal_balls },
];

interface Change { index: number; previous: string | null; direction: 'up' | 'down'; delayStep: number }

/** The digits that differ between two displayed states, right-aligned within each of runs, wickets and overs. */
const changesBetween = (before: Section[] | null, after: Section[]): Change[] => {
  if (!before) return [];
  const changes: Change[] = [];
  let offset = 0;
  after.forEach((section, position) => {
    const old = before[position];
    section.digits.forEach((digit, index) => {
      const previous = old.digits[old.digits.length - (section.digits.length - index)] ?? null;
      if (previous !== digit) {
        changes.push({ index: offset + index, previous, direction: section.value < old.value ? 'down' : 'up', delayStep: position });
      }
    });
    offset += section.digits.length;
  });
  return changes;
};

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ROLL_EASING = 'cubic-bezier(0.2, 0.9, 0.3, 1)';

/** The characters of `text`; each digit is its own element so Ball tick can roll it, and a dot is plain text. */
const Digits = ({ text, changed }: { text: string; changed: Set<number> }): JSX.Element => {
  let position = -1;
  return (
    <>
      {[...text].map((char) => {
        if (char === '.') return <span class="dot">.</span>;
        position += 1;
        return <span class="digit-cell"><span class="digit" data-changed={changed.has(position) ? 'true' : undefined}>{char}</span></span>;
      })}
    </>
  );
};

/** The poster total. A digit that changed rolls once as a `ball-tick`, in the published order; unchanged digits never move. */
export const Scoreboard = ({ state }: { state: MatchState }): JSX.Element => {
  const root = useRef<HTMLElement>(null);
  const shown = useRef<Section[] | null>(null);
  const sections = sectionsOf(state);
  const changes = useMemo(() => changesBetween(shown.current, sections), [state]);
  const changedIn = (name: Section['name']): Set<number> => {
    let offset = 0;
    const found = new Set<number>();
    for (const section of sections) {
      if (section.name === name) for (const change of changes) if (change.index >= offset && change.index < offset + section.digits.length) found.add(change.index - offset);
      offset += section.digits.length;
    }
    return found;
  };

  useLayoutEffect(() => {
    shown.current = sections;
    const settings = configStore.get();
    if (!settings || changes.length === 0 || reducedMotion() || !root.current) return;
    const digits = root.current.querySelectorAll<HTMLElement>('.digit');
    for (const change of changes) {
      const digit = digits[change.index];
      digit.dataset['prev'] = change.previous ?? '';
      digit.dataset['dir'] = change.direction;
      digit.setAttribute('data-ticking', 'true');
      const from = change.direction === 'up' ? '100%' : '-100%';
      const roll = digit.animate([{ transform: `translateY(${from})` }, { transform: 'translateY(0)' }], {
        id: 'ball-tick', duration: settings.tick_ms, delay: change.delayStep * settings.tick_stagger_ms, easing: ROLL_EASING, fill: 'backwards',
      });
      const done = (): void => digit.removeAttribute('data-ticking');
      roll.addEventListener('finish', done);
      roll.addEventListener('cancel', done);
    }
  }, [state]);

  const logo = state.batting_team.logo_url;
  return (
    <section
      id="scoreboard" ref={root} class="scoreboard" aria-label="Scoreboard" data-runs={state.runs} data-wickets={state.wickets}
      data-legal-balls={state.legal_balls} data-innings={state.innings ?? undefined}
    >
      <p class="board-team">
        {logo ? <img class="board-logo" src={logo} alt={`${state.batting_team.name} logo`} width="40" height="40" /> : null}
        <span>{state.batting_team.name}</span>
      </p>
      {' '}
      <p class="board-total">
        <Digits text={String(state.runs)} changed={changedIn('runs')} />
        <span class="slash">/</span>
        <Digits text={String(state.wickets)} changed={changedIn('wickets')} />
      </p>
      {' ('}
      <span class="board-overs"><Digits text={state.overs_text} changed={changedIn('overs')} /></span>
      {' ov)'}
    </section>
  );
};

/** The batters, the bowler, the run rate and the chase line, as the server worded them. */
export const MatchLines = ({ state }: { state: MatchState }): JSX.Element => (
  <div class="lines">
    <ul id="batters" class="batters">
      {state.batters.map((batter) => (
        <li key={batter.player} data-player={batter.player} data-on-strike={batter.on_strike ? 'true' : 'false'}>{batter.text}</li>
      ))}
    </ul>
    {state.bowler ? <p id="bowler">{state.bowler.text}</p> : null}
    <p id="run-rate">{state.run_rate}</p>
    <div class="slot slot-chase">{state.chase ? <p id="chase">{state.chase.text}</p> : null}</div>
  </div>
);

/** The chips of the over in progress (kept after it ends), and the free-hit badge in its reserved slot. */
export const ThisOver = ({ state }: { state: MatchState }): JSX.Element => (
  <>
    <ol id="this-over" class="chips" aria-label="This over">
      {state.this_over.map((chip, index) => <li key={index}>{chip}</li>)}
    </ol>
    <div class="slot slot-free-hit">{state.free_hit ? <p id="free-hit" class="badge">FREE HIT</p> : null}</div>
  </>
);

/** The innings-break region and the result band, present only when the match is there. */
export const Bands = ({ state }: { state: MatchState }): JSX.Element => (
  <>
    {state.innings_break ? (
      <section id="innings-break" class="band">
        <h2>{state.innings_break.heading}</h2>
        <p>{state.innings_break.text}</p>
      </section>
    ) : null}
    {state.result ? <div id="result" class="band result">{state.result}</div> : null}
  </>
);

const MAP_WIDTH = 220;
const MAP_HEIGHT = 64;
const MARK_BASE = 3;
const MARK_PER_RUN = 1.3;

/** One mark per delivery of an over along a drawn pitch, larger for more runs; hidden from assistive technology. */
const PitchMap = ({ deliveries }: { deliveries: DeliveryItem[] }): JSX.Element => {
  const step = MAP_WIDTH / (Math.max(deliveries.length, 6) + 1);
  return (
    <svg class="pitch-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} width={MAP_WIDTH} height={MAP_HEIGHT} aria-hidden="true" focusable="false">
      <rect class="map-strip" x="0" y="16" width={MAP_WIDTH} height="32" />
      <rect class="map-crease" x="6" y="14" width="2" height="36" />
      <rect class="map-crease" x={MAP_WIDTH - 8} y="14" width="2" height="36" />
      {deliveries.map((delivery, index) => {
        const radius = MARK_BASE + delivery.runs * MARK_PER_RUN;
        const x = step * (index + 1);
        return delivery.wicket === 'none'
          ? <circle key={delivery.seq} class={delivery.runs === 0 ? 'map-dot' : 'map-mark'} cx={x} cy={MAP_HEIGHT / 2} r={radius} />
          : <path key={delivery.seq} class="map-wicket" d={`M${x - 6} ${MAP_HEIGHT / 2 - 6}L${x + 6} ${MAP_HEIGHT / 2 + 6}M${x + 6} ${MAP_HEIGHT / 2 - 6}L${x - 6} ${MAP_HEIGHT / 2 + 6}`} />;
      })}
    </svg>
  );
};

interface CommentaryProps {
  items: CommentaryItem[];
  /** The Change delivery button of each delivery, on the scoring page. */
  change?: { enabled: boolean; open: (seq: number) => void };
}

/** Newest first. Each over-end item heads its over's flat panel with a drawn pitch map above one caption line. */
export const Commentary = ({ items, change }: CommentaryProps): JSX.Element => (
  <ol id="commentary" class="commentary" aria-label="Commentary">
    {items.map((item) => {
      if (item.kind === 'over-end') {
        return (
          <li key={`over-${item.over}`} data-kind="over-end" data-over={item.over} class="over-end">
            <PitchMap deliveries={items.filter((candidate): candidate is DeliveryItem => candidate.kind === 'delivery' && candidate.over === item.over).reverse()} />
            <span class="line">{item.line}</span>
          </li>
        );
      }
      if (item.kind === 'retirement') {
        return <li key={`retire-${item.player}-${item.line}`} data-kind="retirement" data-player={item.player}><span class="line">{item.line}</span></li>;
      }
      return (
        <li
          key={`delivery-${item.seq}`} data-kind="delivery" data-seq={item.seq} data-over={item.over} data-ball={item.ball} data-label={item.label}
          data-runs={item.runs} data-bat-runs={item.bat_runs} data-extra={item.extra} data-extra-runs={item.extra_runs} data-wicket={item.wicket}
          data-free-hit={item.free_hit ? 'true' : 'false'} data-striker={item.striker} data-bowler={item.bowler}
        >
          <span class="line">{item.line}</span>
          {change ? (
            <button type="button" class="change-button" aria-label={`Change delivery ${item.seq}`} disabled={!change.enabled} onClick={() => change.open(item.seq)}>Change</button>
          ) : null}
        </li>
      );
    })}
  </ol>
);
