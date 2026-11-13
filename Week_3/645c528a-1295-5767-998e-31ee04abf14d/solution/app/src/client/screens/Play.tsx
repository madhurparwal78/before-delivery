import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyEvent, type ReactNode, type TouchEvent } from 'react';
import { MODES, NO_GUIDELINES_MIN_LEVEL, TIERS, formatNumber, type Mode, type Tier } from '../../shared/domain';
import { api, ApiFailure } from '../api';
import { subscribe } from '../live';
import { navigate, useLocation } from '../router';
import { reducedMotion, type Store } from '../store';
import { Figures, Link, Screen } from '../ui';

const CARD_WIDTH = 268;
const CROSSFADE_MS = 200;

interface QueueState {
  queued: boolean;
  text: string;
}

function searching(band: number): string {
  return `Searching within ${band} levels`;
}

function TierCard({ tier, selected, level, coins, refillsLeft, onJoin, onLower, joinRef, lowerIndex }: {
  tier: Tier; selected: boolean; level: number; coins: number; refillsLeft: number;
  onJoin: () => void; onLower: () => void; joinRef: React.RefObject<HTMLButtonElement | null>; lowerIndex: number | null;
}): ReactNode {
  const locked = level < tier.minLevel;
  const short = !locked && coins < tier.entry;
  const refillLink = short && coins < 100 && refillsLeft > 0;
  const lowerLink = short && !refillLink && tier.tier > 1 && lowerIndex !== null;
  return (
    <div role="group" aria-label={tier.name} className={`tier-card${selected ? ' selected' : ''}`}>
      <h2>{tier.name}</h2>
      <p><span className="caption">Entry </span><span className="tier-figure"><Figures text={formatNumber(tier.entry)} /></span></p>
      <p><span className="caption">Pot </span><span className="tier-figure"><Figures text={formatNumber(tier.pot)} /></span></p>
      {locked && <p className="tier-state">Reach level {tier.minLevel}</p>}
      {short && <p className="tier-state">Short by {formatNumber(tier.entry - coins)} Coins</p>}
      {(refillLink || lowerLink) && (
        <div className="tier-links">
          {refillLink && <Link href="/home">Refill</Link>}
          {lowerLink && <Link href="/play" onClick={(event) => {
            event.preventDefault();
            onLower();
          }}>Lower tier</Link>}
        </div>
      )}
      {selected && !locked && !short && <button ref={joinRef} type="button" className="primary" onClick={onJoin}>Join table</button>}
    </div>
  );
}

export function TierPicker({ store }: { store: Store }): ReactNode {
  const { me } = store;
  const search = useLocation();
  const requested = new URLSearchParams(search.split('?')[1]).get('mode') as Mode | null;
  const mode: Mode = requested !== null && MODES.includes(requested) ? requested : 'eight-ball';
  const [selected, setSelected] = useState(0);
  const [queue, setQueue] = useState<QueueState>({ queued: false, text: '' });
  const [drag, setDrag] = useState<number | null>(null);
  const stage = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const join = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const swipeStart = useRef(0);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const ready = me !== null;

  useLayoutEffect(() => {
    if (ready) stage.current?.focus();
  }, [ready]);
  useLayoutEffect(() => {
    if (queue.queued) cancel.current?.focus();
  }, [queue.queued]);

  useEffect(() => {
    void api<{ status: string; band?: number; tableUrl?: string }>('GET', '/api/queue').then((state) => {
      if (state.status === 'queued') setQueue({ queued: true, text: searching(state.band as number) });
      if (state.status === 'paired') navigate(state.tableUrl as string, true);
    }).catch(() => undefined);
    return subscribe('queue', (message) => {
      if (message.status === 'paired') navigate(String(message.tableUrl));
      if (message.status === 'queued') setQueue({ queued: true, text: searching(Number(message.band)) });
      if (message.status === 'refused') {
        setQueue({ queued: false, text: String(message.message) });
        stage.current?.focus();
      }
    });
  }, []);

  const leaveQueue = async (): Promise<void> => {
    try {
      await api('DELETE', '/api/queue');
      setQueue({ queued: false, text: 'Left the queue. No Coins moved.' });
      stage.current?.focus();
    } catch (error) {
      setQueue({ queued: false, text: (error as ApiFailure).message });
    }
  };

  useEffect(() => {
    if (!queue.queued) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void leaveQueue();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [queue.queued]);

  if (me === null) return <Screen store={store} title="Stake tables"><p className="note">–</p></Screen>;

  const available = (tier: Tier): boolean => me.level >= tier.minLevel && me.coins >= tier.entry;
  const lowerFor = (index: number): number | null => {
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) if (available(TIERS[candidate])) return candidate;
    return null;
  };

  const crossfade = (): void => {
    if (reducedMotion()) track.current?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: 'linear' });
  };
  const select = (index: number): void => {
    setSelected(index);
    crossfade();
  };
  const moveTier = (step: number): void => {
    if (queueRef.current.queued) return;
    const next = selected + step;
    if (next < 0 || next >= TIERS.length) return;
    if (document.activeElement === join.current) stage.current?.focus();
    select(next);
  };
  const joinQueue = async (): Promise<void> => {
    if (queue.queued || !available(TIERS[selected])) return;
    try {
      await api('POST', '/api/queue', { mode, tier: TIERS[selected].tier });
      setQueue((current) => (current.queued ? current : { queued: true, text: searching(3) }));
    } catch (error) {
      setQueue({ queued: false, text: (error as ApiFailure).message });
    }
  };

  const onKeyDown = (event: ReactKeyEvent): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveTier(event.key === 'ArrowRight' ? 1 : -1);
    }
    if (event.key === 'Enter' && event.target === stage.current) void joinQueue();
  };
  const onTouchStart = (event: TouchEvent): void => {
    swipeStart.current = event.touches[0].clientX;
  };
  const onTouchMove = (event: TouchEvent): void => {
    if (!queue.queued && !reducedMotion()) setDrag(event.touches[0].clientX - swipeStart.current);
  };
  const onTouchEnd = (event: TouchEvent): void => {
    const moved = event.changedTouches[0].clientX - swipeStart.current;
    setDrag(null);
    if (Math.abs(moved) >= CARD_WIDTH / 4) moveTier(moved < 0 ? 1 : -1);
  };

  return (
    <Screen store={store} title={mode === 'nine-ball' ? '9-Ball' : mode === 'no-guidelines' ? 'No Guidelines' : '1-on-1'}>
      <section
        ref={stage}
        className="stage"
        role="region"
        aria-label="Stake tiers"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ containerType: 'inline-size' }}
      >
        <div
          ref={track}
          className={`track${drag === null ? '' : ' dragging'}`}
          style={{ transform: `translateX(calc(var(--tier-anchor) - ${selected * (CARD_WIDTH + 16)}px + ${drag ?? 0}px))` }}
        >
          {TIERS.map((tier, index) => (
            <TierCard
              key={tier.tier}
              tier={tier}
              selected={index === selected}
              level={me.level}
              coins={me.coins}
              refillsLeft={me.refillsLeft}
              onJoin={() => void joinQueue()}
              onLower={() => select(lowerFor(index) as number)}
              joinRef={join}
              lowerIndex={lowerFor(index)}
            />
          ))}
        </div>
      </section>
      <div className="queue-row">
        <span>Selected <strong role="status" aria-label="Selected tier">{TIERS[selected].name}</strong></span>
        <span role="status" aria-label="Queue" className="notice">{queue.text}</span>
        {queue.queued && <button ref={cancel} type="button" onClick={() => void leaveQueue()}>Cancel</button>}
      </div>
    </Screen>
  );
}

export function ModePicker({ store }: { store: Store }): ReactNode {
  const locked = (store.me?.level ?? 1) < NO_GUIDELINES_MIN_LEVEL;
  return (
    <Screen store={store} title="Play Special">
      <div className="modes">
        <button type="button" aria-label="9-Ball" className="mode-card" style={{ gridTemplateColumns: '1fr' }} onClick={() => navigate('/play?mode=nine-ball')}>
          <span className="mode-title">9-Ball</span>
        </button>
        <button type="button" aria-label="No Guidelines" className="mode-card" style={{ gridTemplateColumns: '1fr' }} disabled={locked} onClick={() => navigate('/play?mode=no-guidelines')}>
          <span className="mode-title">No Guidelines</span>
          {locked && <span className="mode-mark">Unlocks at level {NO_GUIDELINES_MIN_LEVEL}</span>}
        </button>
      </div>
    </Screen>
  );
}
