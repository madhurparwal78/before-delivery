import { useEffect, useMemo, useRef, useState } from 'react';
import { hueForUserId } from '../../shared/hue.js';
import { TICK_RATE, roundKindLabel, slotsLabel, timeLimitTicks } from '../../shared/rounds.js';
import {
  BUTTON_BACK,
  BUTTON_DIVE,
  BUTTON_FORWARD,
  BUTTON_JUMP,
  BUTTON_LEFT,
  BUTTON_RIGHT,
  isInPlay,
  rankOrder,
  slotsLeftFor,
} from '../../shared/sim/index.js';
import type { BeanState, Party, Round, TickBean } from '../../shared/types.js';
import { store, useApp, useLive } from '../lib/store.js';
import {
  Bean,
  formatClock,
  formatPosition,
  useCoarsePointer,
  useNarrowViewport,
} from '../lib/ui.js';
import { MatchCanvas } from '../three/MatchCanvas.js';
import { TouchControls } from './TouchControls.js';

interface Props {
  party: Party;
  round: Round;
  matchId: number;
}

interface Settled {
  qualifyTick: number | null;
  eliminatedTick: number | null;
  zAtEliminated: number;
}

const KEY_BUTTONS: Record<string, number> = {
  KeyW: BUTTON_FORWARD,
  ArrowUp: BUTTON_FORWARD,
  KeyS: BUTTON_BACK,
  ArrowDown: BUTTON_BACK,
  KeyA: BUTTON_LEFT,
  ArrowLeft: BUTTON_LEFT,
  KeyD: BUTTON_RIGHT,
  ArrowRight: BUTTON_RIGHT,
  Space: BUTTON_JUMP,
  ShiftLeft: BUTTON_DIVE,
  ShiftRight: BUTTON_DIVE,
};

function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function MatchView({ party, round, matchId }: Props) {
  const { me, banner, pending, participants } = useApp();
  const live = useLive();
  const coarse = useCoarsePointer();
  const narrow = useNarrowViewport();
  const [buttons, setButtons] = useState(0);
  const [spectateOffset, setSpectateOffset] = useState(0);
  const settled = useRef(new Map<number, Settled>());
  const roundNumber = round.n;
  const held = useRef(new Set<string>());
  const touchButtons = useRef(0);
  const tickRef = useRef(live.tick);
  tickRef.current = live.tick;

  const handleOf = (userId: number): string => {
    const fromMatch = participants.find((user) => user.id === userId);
    if (fromMatch !== undefined) return fromMatch.handle;
    return party.members.find((member) => member.user.id === userId)?.user.handle ?? `#${userId}`;
  };

  useEffect(() => {
    settled.current = new Map();
    setSpectateOffset(0);
  }, [roundNumber]);

  for (const bean of live.beans) {
    const record = settled.current.get(bean.userId) ?? {
      qualifyTick: null,
      eliminatedTick: null,
      zAtEliminated: 0,
    };
    if (bean.state === 'qualified' && record.qualifyTick === null) {
      settled.current.set(bean.userId, { ...record, qualifyTick: live.tick });
    } else if (bean.state === 'eliminated' && record.eliminatedTick === null) {
      settled.current.set(bean.userId, {
        ...record,
        eliminatedTick: live.tick,
        zAtEliminated: bean.z,
      });
    } else if (!settled.current.has(bean.userId)) {
      settled.current.set(bean.userId, record);
    }
  }

  const byUser = useMemo(() => {
    const map = new Map<number, TickBean>();
    for (const bean of live.beans) map.set(bean.userId, bean);
    return map;
  }, [live]);

  const ranked = useMemo(() => {
    const inputs = live.beans.map((bean) => {
      const record = settled.current.get(bean.userId);
      return {
        userId: bean.userId,
        z: bean.z,
        state: bean.state,
        qualifyTick: record?.qualifyTick ?? null,
        eliminatedTick: record?.eliminatedTick ?? null,
        zAtEliminated: record?.zAtEliminated ?? 0,
      };
    });
    return rankOrder(round.kind, inputs);
  }, [live, round.kind]);

  const myBean = me === null ? undefined : byUser.get(me.id);
  const myState: BeanState | null = myBean?.state ?? null;
  const inPlay = myState !== null && isInPlay(myState);

  const playing = ranked.filter((userId) => {
    const state = byUser.get(userId)?.state;
    return state !== undefined && isInPlay(state);
  });

  const partyIds = new Set(party.members.map((member) => member.user.id));
  let following: number | null = null;
  if (me !== null && inPlay) following = me.id;
  else if (playing.length > 0) {
    const friends = playing
      .filter((userId) => partyIds.has(userId) && userId !== me?.id)
      .sort((a, b) => a - b);
    const base = friends.length > 0 ? friends[0] : playing[0];
    const index = (playing.indexOf(base) + spectateOffset + playing.length * 8) % playing.length;
    following = playing[index];
  }

  useEffect(() => {
    const send = (value: number): void => {
      setButtons(value);
      store.send({
        type: 'input',
        matchId,
        round: roundNumber,
        tick: tickRef.current,
        buttons: value,
      });
    };
    const combine = (): number => {
      let value = touchButtons.current;
      for (const code of held.current) value |= KEY_BUTTONS[code] ?? 0;
      return value;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextTarget(event.target)) return;
      const bit = KEY_BUTTONS[event.code];
      if (bit === undefined) return;
      event.preventDefault();
      if (held.current.has(event.code)) return;
      held.current.add(event.code);
      send(combine());
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!held.current.has(event.code)) return;
      held.current.delete(event.code);
      send(combine());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [matchId, roundNumber]);

  const onTouchButtons = (value: number): void => {
    touchButtons.current = value;
    let next = value;
    for (const code of held.current) next |= KEY_BUTTONS[code] ?? 0;
    setButtons(next);
    store.send({
      type: 'input',
      matchId,
      round: roundNumber,
      tick: tickRef.current,
      buttons: next,
    });
  };

  const states = live.beans.map((bean) => bean.state);
  const slotsLeft = slotsLeftFor(round.kind, round.slots, states);
  const secondsLeft = (timeLimitTicks(round.kind) - live.tick) / TICK_RATE;
  const followedHandle = following === null ? null : handleOf(following);

  return (
    <section
      className="match-view"
      aria-label="Match"
      data-match-id={matchId}
      data-round={roundNumber}
      data-tick={live.tick}
      data-buttons={buttons}
      data-following-user-id={following ?? ''}
    >
      <div className="canvas-holder">
        <MatchCanvas
          kind={round.kind}
          seed={round.seed}
          starters={round.starters}
          beans={live.beans}
          tick={live.tick}
          followingUserId={following}
        />
      </div>
      <div className="hud">
        <div className="hud-top">
          <div role="status" aria-label="Round" className="hud-round display">
            {`${round.name} · ${roundKindLabel(round.kind)}`}
          </div>
          <div role="timer" aria-label="Round clock" className="hud-clock">
            {formatClock(secondsLeft)}
          </div>
          <div className="hud-slots" data-slots-left={slotsLeft}>
            <span className="hud-slots-label">{slotsLabel(round.kind)}</span>{' '}
            <span className="hud-slots-value">{slotsLeft}</span>
          </div>
        </div>
        <ol className="standings-live" aria-label="Live standings">
          {ranked.map((userId, index) => {
            const bean = byUser.get(userId);
            if (bean === undefined) return null;
            return (
              <li
                key={userId}
                data-user-id={userId}
                data-rank={index + 1}
                data-state={bean.state}
                data-hue={hueForUserId(userId)}
                data-x={formatPosition(bean.x)}
                data-y={formatPosition(bean.y)}
                data-z={formatPosition(bean.z)}
                className={`standing-live state-${bean.state}`}
              >
                <span className="rank-number">{index + 1}</span>
                <Bean hue={hueForUserId(userId)} size={24} />
                <span className="handle">{handleOf(userId)}</span>
              </li>
            );
          })}
        </ol>
        {inPlay ? (
          <button
            type="button"
            className="forfeit"
            disabled={pending.forfeit === true}
            aria-busy={pending.forfeit === true}
            onClick={() => void store.forfeit()}
          >
            Forfeit
          </button>
        ) : following !== null ? (
          <div className="spectating">
            <div role="status" aria-label="Spectating">
              {`Spectating ${followedHandle ?? ''}`}
            </div>
            <button type="button" onClick={() => setSpectateOffset((value) => value - 1)}>
              Previous player
            </button>
            <button type="button" onClick={() => setSpectateOffset((value) => value + 1)}>
              Next player
            </button>
          </div>
        ) : null}
        {banner === null ? null : (
          <div role="alert" aria-label="Round result" className="round-banner">
            {banner.text}
          </div>
        )}
      </div>
      <TouchControls shown={coarse || narrow} onButtons={onTouchButtons} />
    </section>
  );
}
