// Scout and Raid: the scout report, the live raid (unit picker, deploys on the tidal ring, the raid
// clock, End raid) and the Raid result. The browser sends only intents; the server resolves.
import { useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import { RAID_TICKS, simulateBattle, spawnOrder, type BattleFrame, type Deploy } from '../shared/battle';
import { UNIT_KEYS, UNITS, type UnitKey } from '../shared/catalog';
import { api, ApiFailure, newIdempotencyKey } from './api';
import { amountsText, failureCopy, fmt, mss, RAID_ABANDONED, START_RAID_ERRORS } from './copy';
import { stageHandlers, useStage } from './island';
import { Panel } from './panel';
import type { SceneBuilding, SceneUnit } from './scene/types';
import { loadVillage, navigate, openPanel, reducedMotion, serverNow, warn } from './store';
import type { Raid, Scout } from './types';
import { Button, perform, useBusy, useRerender, useStore } from './ui';

const TICK_MS = 100;

/** Scene buildings for a layout at one battle frame (or untouched when no frame is given). */
export function layoutScene(raid: Pick<Raid, 'layout'>, frame: BattleFrame | null): SceneBuilding[] {
  return raid.layout.map((b, i) => ({
    id: b.id, type: b.type, x: b.x, y: b.y, rotation: b.rotation, level: b.level, working: false,
    destroyed: frame !== null && frame.buildingHp[i] === 0,
  }));
}

/** Scene units for a frame, positions in thousandths of a cell, optionally eased toward the next frame. */
export function unitScene(deploys: readonly Deploy[], frame: BattleFrame, next: BattleFrame | null = null, t = 0): SceneUnit[] {
  const kinds = spawnOrder(deploys);
  return frame.unitHp.map((hp, i) => {
    const x = frame.unitX[i] as number;
    const y = frame.unitY[i] as number;
    const nx = next?.unitX[i] ?? x;
    const ny = next?.unitY[i] ?? y;
    return { unit: kinds[i] as UnitKey, x: x + (nx - x) * t, y: y + (ny - y) * t, alive: hp > 0 };
  });
}

// Scout ---------------------------------------------------------------------------------------------

const NO_MATCH = 'No island is in reach right now. Try again in a minute.';

export function ScoutScreen({ villageId }: { villageId: string | null }) {
  const s = useStore();
  const stage = useStage();
  const [scout, setScout] = useState<Scout | null>(null);
  const [searching, search] = useBusy();
  const [locking, lock] = useBusy();
  const findNext = (): void => {
    void search({
      pending: 'Searching the tide for an island…',
      run: () => api.get<{ match: Scout | null }>('/api/scout/next'),
    }).then((r) => {
      if (!r) return;
      if (r.match === null) warn(NO_MATCH);
      else {
        setScout(r.match);
        openPanel({ kind: 'scout' });
        navigate(`/scout/${r.match.villageId}`, true);
      }
    });
  };
  useEffect(() => {
    if (villageId === null) {
      findNext();
      return;
    }
    if (scout?.villageId === Number(villageId)) return;
    void perform({ run: () => api.get<Scout>(`/api/villages/${villageId}/scout`), errors: START_RAID_ERRORS }).then((r) => {
      if (!r) return;
      setScout(r);
      openPanel({ kind: 'scout' });
    });
  }, [villageId]);
  useLayoutEffect(() => {
    if (!stage || !scout) return;
    stage.setBuildings(scout.buildings.map((b) => ({ ...b, working: false, destroyed: false })));
  }, [stage, scout]);
  const start = (): void => {
    if (!scout) return;
    const key = newIdempotencyKey();
    void lock({
      pending: 'Locking the island…',
      run: () => api.post<Raid>('/api/raids', { villageId: scout.villageId }, { idempotencyKey: key }),
      success: () => 'Island locked. Deploy before the finalize countdown runs out.',
      errors: START_RAID_ERRORS,
    }).then((raid) => {
      if (raid) navigate(`/raids/${raid.id}`);
    });
  };
  if (!scout || s.panel?.kind !== 'scout') return null;
  return (
    <Panel label="Scout report" title={scout.displayName}>
      <section>
        <p>
          Trophies <span class="num">{fmt(scout.trophies)}</span>
        </p>
        <p>League {scout.league}</p>
      </section>
      <section>
        <h3>Lootable</h3>
        <ul class="plain-list" aria-label="Lootable">
          <li>
            <span class="num">{fmt(scout.lootable.brine)}</span> brine
          </li>
          <li>
            <span class="num">{fmt(scout.lootable.peat)}</span> peat
          </li>
          <li>
            <span class="num">{fmt(scout.lootable.copper)}</span> copper
          </li>
        </ul>
        <p class="hint">A fifth of each store, taken again when the raid resolves.</p>
      </section>
      <section class="button-row">
        <Button variant="primary" busy={locking} onClick={start}>
          Start raid
        </Button>
        <Button busy={searching} onClick={findNext}>
          Next island
        </Button>
      </section>
    </Panel>
  );
}

// Live raid ---------------------------------------------------------------------------------------

interface LiveRaid {
  raid: Raid;
  pending: Deploy[];
}

let live: LiveRaid | null = null;
const liveListeners = new Set<() => void>();
function setLive(next: LiveRaid | null): void {
  live = next;
  liveListeners.forEach((fn) => fn());
}

function useLive(): LiveRaid | null {
  const rerender = useRerender();
  useLayoutEffect(() => {
    liveListeners.add(rerender);
    return () => void liveListeners.delete(rerender);
  }, []);
  return live;
}

const isOpen = (raid: Raid): boolean => raid.state === 'locked' || raid.state === 'deploying';

/** The raid tick now: simulated time since the lock, one tick per tenth of a second. */
function currentTick(raid: Raid): number {
  return Math.min(RAID_TICKS - 1, Math.max(0, Math.floor((serverNow() - Date.parse(raid.lockedAt)) / TICK_MS)));
}

/** In the top rule while a raid is live: the raid clock and the finalize countdown. */
export function RaidClock() {
  const l = useLive();
  const rerender = useRerender();
  useEffect(() => {
    const timer = window.setInterval(rerender, 250);
    return () => clearInterval(timer);
  }, []);
  if (!l || !isOpen(l.raid)) return null;
  const remaining = (RAID_TICKS - currentTick(l.raid)) * TICK_MS;
  return (
    <>
      <span class="readout raid-clock">
        <span class="rl" aria-hidden="true">
          Raid clock
        </span>{' '}
        <span class="rv">
          <span role="timer" aria-label="Raid clock" class="num">
            {mss(remaining)}
          </span>
        </span>
      </span>
      <span class="readout">
        <span class="rl">Finalize by</span>{' '}
        <span class="rv">
          <span class="num">{mss(Date.parse(l.raid.finalizeBy) - serverNow())}</span>
        </span>
      </span>
    </>
  );
}

let sending: Promise<void> | null = null;

/** Sends queued deploys one batch at a time; a lost batch is retried with the same key and body. */
function flush(): Promise<void> {
  if (sending) return sending;
  sending = (async () => {
    while (live && live.pending.length > 0) {
      const batch = live.pending.slice(0, 50);
      const raidId = live.raid.id;
      const key = newIdempotencyKey();
      for (;;) {
        try {
          const raid = await api.post<Raid>(`/api/raids/${raidId}/deploys`, { deploys: batch }, { idempotencyKey: key });
          if (live?.raid.id === raidId) setLive({ raid, pending: live.pending.slice(batch.length) });
          break;
        } catch (error) {
          if (error instanceof ApiFailure && error.status > 0 && error.status < 500) {
            warn(failureCopy(error, { units_unavailable: 'You have no more of that unit in this raid.', raid_abandoned: RAID_ABANDONED }));
            if (live?.raid.id === raidId) setLive({ raid: live.raid, pending: [] });
            return;
          }
          warn("Deploys didn't reach the tide. Retrying…");
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
      }
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

export function RaidScreen({ raidId }: { raidId: string }) {
  const s = useStore();
  const stage = useStage();
  const l = useLive();
  const [unit, setUnit] = useState<UnitKey>('saltjack');
  const [ending, end] = useBusy();
  const raid = l?.raid.id === Number(raidId) ? l.raid : null;
  useEffect(() => {
    let alive = true;
    void perform({ run: () => api.get<Raid>(`/api/raids/${raidId}`) }).then((r) => {
      if (!r || !alive) return;
      setLive({ raid: r, pending: [] });
      if (r.state === 'resolved') openPanel({ kind: 'raid-result' });
      if (r.state === 'abandoned') warn(RAID_ABANDONED);
    });
    return () => {
      alive = false;
      setLive(null);
    };
  }, [raidId]);
  const mine = raid !== null && s.me?.villageId === raid.attacker.villageId && isOpen(raid);
  const deploys = useMemo(() => (raid ? [...raid.deploys, ...(l?.pending ?? [])] : []), [raid, l?.pending]);
  const left = (key: UnitKey): number => (raid ? raid.army[key] - deploys.filter((d) => d.unit === key).length : 0);
  const frames = useMemo(() => {
    if (!raid) return null;
    const lootable = raid.result?.lootable ?? raid.lootable;
    return simulateBattle({ seed: raid.seed, layout: raid.layout, deploys, lootable });
  }, [raid?.id, raid?.result, deploys]);

  useLayoutEffect(() => {
    stageHandlers.pickUnit = (i) => {
      const key = UNIT_KEYS[i];
      if (key) setUnit(key);
    };
    stageHandlers.deploy = (x, y) => {
      if (!live || !isOpen(live.raid) || live.raid.id !== Number(raidId)) return;
      const all = [...live.raid.deploys, ...live.pending];
      if (live.raid.army[unit] - all.filter((d) => d.unit === unit).length <= 0) {
        warn('You have no more of that unit in this raid.');
        return;
      }
      const last = all.length > 0 ? (all[all.length - 1] as Deploy).tick : 0;
      setLive({ raid: live.raid, pending: [...live.pending, { tick: Math.max(last, currentTick(live.raid)), unit, x, y }] });
      void flush();
    };
  }, [raidId, unit]);

  // The scene follows the preview battle at the raid clock; after resolution it shows the final tick.
  useEffect(() => {
    if (!stage || !raid || !frames) return undefined;
    const last = frames[frames.length - 1] as BattleFrame;
    if (!isOpen(raid)) {
      const shown = raid.state === 'resolved' ? last : (frames[0] as BattleFrame);
      stage.setBuildings(layoutScene(raid, shown), false);
      stage.setUnits(raid.state === 'resolved' ? unitScene(deploys, shown) : []);
      return undefined;
    }
    let frame = 0;
    let shownTick = -1;
    const draw = (): void => {
      const exact = (serverNow() - Date.parse(raid.lockedAt)) / TICK_MS;
      const tick = Math.min(frames.length - 1, Math.max(0, Math.floor(exact)));
      const f = frames[tick] as BattleFrame;
      if (tick !== shownTick) {
        shownTick = tick;
        stage.setBuildings(layoutScene(raid, f));
      }
      const t = reducedMotion() ? 0 : Math.min(1, exact - tick);
      stage.setUnits(unitScene(deploys, f, frames[tick + 1] ?? null, t));
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [stage, raid, frames]);

  const finish = (): void => {
    if (!raid) return;
    const key = newIdempotencyKey();
    void end({
      pending: 'Resolving the raid on the server…',
      run: async () => {
        await flush();
        return api.post<Raid>(`/api/raids/${raid.id}/finalize`, {}, { idempotencyKey: key });
      },
      success: (r) => `Raid resolved: ${r.result?.stars ?? 0} stars, ${r.result?.destruction ?? 0}% destroyed.`,
      errors: {
        raid_abandoned: RAID_ABANDONED,
        nothing_deployed: 'Deploy at least one unit first.',
        raid_not_active: 'This raid is already over.',
      },
    }).then((r) => {
      if (r) {
        setLive({ raid: r, pending: [] });
        openPanel({ kind: 'raid-result' });
        void loadVillage().catch(() => undefined);
      } else if (live) {
        void api.get<Raid>(`/api/raids/${raid.id}`).then((fresh) => setLive({ raid: fresh, pending: [] })).catch(() => undefined);
      }
    });
  };

  return (
    <>
      {mine && (
        <>
          <div class="raid-dock" role="radiogroup" aria-label="Units">
            {UNIT_KEYS.map((key, i) => (
              <label key={key} class="radio-chip">
                <input type="radio" name="raid-unit" checked={unit === key} onChange={() => setUnit(key)} aria-label={`${UNITS[key].name} (${left(key)} left)`} />
                <span>
                  <kbd class="num">{i + 1}</kbd> {UNITS[key].name} <span class="num">({left(key)} left)</span>
                </span>
              </label>
            ))}
          </div>
          <Button variant="primary" class="end-raid" busy={ending} onClick={finish}>
            End raid
          </Button>
        </>
      )}
      {raid?.result && s.panel?.kind === 'raid-result' && <RaidResult raid={raid} />}
    </>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

function RaidResult({ raid }: { raid: Raid }) {
  const s = useStore();
  const result = raid.result;
  if (!result) return null;
  const attacking = s.me?.villageId === raid.attacker.villageId;
  const change = attacking ? result.trophies.attacker : result.trophies.defender;
  const replay = `/raids/${raid.id}/replay`;
  return (
    <Panel label="Raid result" title={attacking ? `Raid on ${raid.defender.displayName}` : `Raid by ${raid.attacker.displayName}`}>
      <section class="result-figures">
        <p class="big num">{result.stars} stars</p>
        <p class="num danger-text">{result.destruction}% destroyed</p>
        <p>
          Loot <span class="num">{amountsText(result.transferred)}</span>
        </p>
        <p>
          Trophies <span class="num">{signed(change)}</span>
        </p>
        {attacking && result.starBonus > 0 && (
          <p class="hint">
            Star bonus <span class="num">{fmt(result.starBonus)}</span> brine
          </p>
        )}
      </section>
      <section>
        <a
          class="btn primary"
          href={replay}
          onClick={(e) => {
            e.preventDefault();
            navigate(replay);
          }}
        >
          Open replay
        </a>
      </section>
    </Panel>
  );
}

