// The islander's own village: Build and Train, the Build dialog, Building details, Train army, and
// the placement and move intents sent from the ghost.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BUILDING_TYPES, BUILDINGS, levelCost, MAX_LEVEL, saltmarkThreshold, UNIT_KEYS, UNITS, type Amounts, type BuildingType, type UnitKey } from '../shared/catalog';
import { footprint } from '../shared/grid';
import { api } from './api';
import { amountsText, fmt, localTime, mss, PLACE_ERRORS } from './copy';
import { Icon } from './icons';
import { stageHandlers, useStage } from './island';
import { Panel } from './panel';
import type { Ghost } from './scene/types';
import { loadVillage, openPanel, state, update } from './store';
import type { Army, Building, Village } from './types';
import { Button, Field, invalid, perform, useBusy, useStore, type FieldErrors } from './ui';

/** Applied durations from /api/catalog (published seconds ÷ the divisor), read once. */
interface AppliedTimes {
  build: Record<BuildingType, number[]>;
  train: Record<UnitKey, number>;
}
let applied: AppliedTimes | null = null;
let appliedLoad: Promise<void> | null = null;

function useAppliedTimes(): AppliedTimes | null {
  const [times, setTimes] = useState(applied);
  useEffect(() => {
    if (applied) return;
    appliedLoad ??= api
      .get<{ buildings: { type: BuildingType; levels: { buildSeconds: number }[] }[]; units: { key: UnitKey; trainSeconds: number }[] }>('/api/catalog')
      .then((c) => {
        applied = {
          build: Object.fromEntries(c.buildings.map((b) => [b.type, b.levels.map((l) => l.buildSeconds)])) as Record<BuildingType, number[]>,
          train: Object.fromEntries(c.units.map((u) => [u.key, u.trainSeconds])) as Record<UnitKey, number>,
        };
      })
      .catch(() => {
        appliedLoad = null;
      });
    void appliedLoad.then(() => setTimes(applied));
  }, []);
  return times;
}

const zone = (): string => state.me?.timeZone ?? 'UTC';

function seconds(n: number): string {
  return n >= 60 ? `${mss(n * 1000)} min` : `${n} s`;
}

let placing = false;

/** "Confirm placement" or Enter on a valid ghost: a new building, or a move of an existing one. */
async function confirmGhost(ghost: Ghost): Promise<void> {
  if (placing) return;
  placing = true;
  const name = BUILDINGS[ghost.type].name;
  const intent = { x: ghost.x, y: ghost.y, rotation: ghost.rotation };
  try {
    const done = ghost.movingId === null
      ? await perform({
          pending: `Placing ${name}…`,
          run: () => api.post<Building>('/api/village/buildings', { type: ghost.type, ...intent }),
          success: (b) => `${name} placed. Done at ${localTime(b.upgrade?.finishesAt ?? Date.now(), zone())}.`,
          errors: PLACE_ERRORS,
        })
      : await perform({
          pending: `Moving ${name}…`,
          run: () => api.patch<Building>(`/api/village/buildings/${ghost.movingId}`, intent),
          success: () => `${name} moved.`,
          errors: PLACE_ERRORS,
        });
    if (done) {
      stageCancelGhost();
      await loadVillage().catch(() => undefined);
    }
  } finally {
    placing = false;
  }
}

let stageCancelGhost: () => void = () => undefined;

/** Pushes the village into the scene and wires the ghost to the placement intents. */
export function VillageStage() {
  const s = useStore();
  const stage = useStage();
  useLayoutEffect(() => {
    stageHandlers.confirmGhost = (g) => void confirmGhost(g);
    stageCancelGhost = () => stage?.cancelGhost();
  }, [stage]);
  useLayoutEffect(() => {
    if (!stage || !s.village) return;
    stage.setBuildings(s.village.buildings.map((b) => ({ id: b.id, type: b.type, x: b.x, y: b.y, rotation: b.rotation, level: b.level, working: b.upgrade !== null, destroyed: false })));
  }, [stage, s.village]);
  return null;
}

export function Dock() {
  const s = useStore();
  const trainOpen = s.panel?.kind === 'train';
  return (
    <div class="dock">
      <Button
        id="build-button"
        variant="primary"
        onClick={() => update({ dialog: { kind: 'build' } })}
      >
        <Icon name="build" />
        Build
      </Button>
      <Button aria-expanded={trainOpen ? 'true' : 'false'} onClick={() => openPanel(trainOpen ? null : { kind: 'train' })}>
        <Icon name="raid" />
        Train
      </Button>
    </div>
  );
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside an open dialog. */
export function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
  if (items.length === 0) return;
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function countOf(village: Village, type: BuildingType): number {
  return village.buildings.filter((b) => b.type === type).length;
}

export function BuildDialog() {
  const s = useStore();
  const stage = useStage();
  const times = useAppliedTimes();
  const ref = useRef<HTMLDivElement>(null);
  const close = (): void => {
    update({ dialog: null });
    document.getElementById('build-button')?.focus();
  };
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('.place-list button')?.focus();
  }, []);
  const place = (type: BuildingType): void => {
    update({ dialog: null });
    const cell = stage?.cursorCell ?? { x: 20, y: 20 };
    stage?.startGhost(type, cell.x, cell.y, 0, null);
  };
  const village = s.village;
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={ref}
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="build-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          } else trapTab(e, e.currentTarget);
        }}
      >
        <header class="panel-head">
          <h2 id="build-title">Build</h2>
          <Button variant="quiet" onClick={close}>
            Close
          </Button>
        </header>
        <ul class="place-list">
          {BUILDING_TYPES.map((type) => {
            const spec = BUILDINGS[type];
            const held = village ? countOf(village, type) : 0;
            return (
              <li key={type}>
                <button type="button" class="btn" aria-label={`Place ${spec.name}`} aria-describedby={`place-${type}`} onClick={() => place(type)}>
                  <span class="place-name">Place {spec.name}</span>
                  <span class="meta" id={`place-${type}`}>
                    <span class="num">{amountsText(levelCost(type, 1))}</span> · {spec.width}×{spec.depth} cells
                    {times ? ` · ${seconds(times.build[type][0] as number)}` : ''} · <span class="num">{held}/{spec.maxCount}</span> held
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function collectCopy(r: { collected: Amounts; lost: Amounts }): string {
  const got = amountsText(r.collected);
  const lost = amountsText(r.lost);
  if (got === 'nothing' && lost === 'nothing') return 'Nothing to collect yet.';
  return lost === 'nothing' ? `Collected ${got}.` : `Collected ${got}. Storage full — ${lost} lost.`;
}

export function BuildingDetails({ id, focus }: { id: number; focus: boolean }) {
  const s = useStore();
  const stage = useStage();
  const times = useAppliedTimes();
  const [upgrading, upgrade] = useBusy();
  const [cancelling, cancel] = useBusy();
  const [collecting, collect] = useBusy();
  const b = s.village?.buildings.find((x) => x.id === id);
  useLayoutEffect(
    () => () => {
      stage?.setSelected(null);
      stage?.clearFraming();
    },
    [stage],
  );
  useEffect(() => {
    if (!b) openPanel(null);
  }, [b === undefined]);
  if (!b) return null;
  const spec = BUILDINGS[b.type];
  const name = spec.name;
  const next = b.level + 1;
  const canUpgrade = b.level >= 1 && b.level < MAX_LEVEL && b.upgrade === null;
  const f = footprint(b.type, b.x, b.y, b.rotation);
  const frame = (rect: DOMRect): void => {
    stage?.setSelected(b.id);
    stage?.frameCell(f.x + f.width / 2, f.y + f.depth / 2, rect);
  };
  const refresh = (): Promise<void> => loadVillage().catch(() => undefined);
  return (
    <Panel label="Building details" title={`${name} · level ${b.level}`} focus={focus} onShown={frame}>
      <section>
        <dl>
          <div class="kv">
            <dt>Footprint</dt>
            <dd class="num">
              {f.width}×{f.depth} at {b.x}, {b.y}
            </dd>
          </div>
          <div class="kv">
            <dt>Hit points</dt>
            <dd class="num">{fmt(spec.hp[Math.max(0, b.level - 1)] as number)}</dd>
          </div>
          {spec.producer && b.level > 0 && (
            <div class="kv">
              <dt>Output</dt>
              <dd class="num">
                {fmt(spec.producer.perHour[b.level - 1] as number)} {spec.producer.resource}/h
              </dd>
            </div>
          )}
        </dl>
        {spec.producer && (
          <p>
            Uncollected <span class="num">{fmt(b.uncollected ?? 0)}</span>
          </p>
        )}
      </section>
      {b.upgrade && (
        <section>
          <p>
            Builder at work → level <span class="num">{b.upgrade.toLevel}</span>, done at{' '}
            <span class="num">{localTime(b.upgrade.finishesAt, zone())}</span>
          </p>
        </section>
      )}
      {canUpgrade && (
        <section>
          <p class="hint">
            Level {next} costs <span class="num">{amountsText(levelCost(b.type, next))}</span>
            {times ? ` and takes ${seconds(times.build[b.type][next - 1] as number)}` : ''}; it needs a saltmark of {saltmarkThreshold(next)}.
          </p>
        </section>
      )}
      <section class="button-row">
        {canUpgrade && (
          <Button
            variant="primary"
            busy={upgrading}
            onClick={() =>
              void upgrade({
                pending: 'Starting upgrade…',
                run: () => api.post<Building>(`/api/village/buildings/${b.id}/upgrade`),
                success: (r) => `${name} upgrading to level ${r.upgrade?.toLevel ?? next}. Done at ${localTime(r.upgrade?.finishesAt ?? Date.now(), zone())}.`,
                errors: {
                  saltmark_too_low: "Raise your island's saltmark first — finish more building levels.",
                  max_level: 'Already at the highest level.',
                  upgrade_in_progress: 'A builder is already on it.',
                  no_free_builder: PLACE_ERRORS.no_free_builder,
                  insufficient_resources: PLACE_ERRORS.insufficient_resources,
                },
              }).then(refresh)
            }
          >
            Upgrade to level {next}
          </Button>
        )}
        {b.upgrade && (
          <Button
            variant="danger"
            busy={cancelling}
            onClick={() =>
              void cancel({
                pending: 'Cancelling…',
                run: () => api.post<{ building: Building | null; refunded: Amounts }>(`/api/village/buildings/${b.id}/cancel`),
                success: (r) => `${name} job cancelled. Refunded ${amountsText(r.refunded)}.`,
                errors: { job_already_finished: 'That job already finished. Nothing was refunded.' },
              }).then(refresh)
            }
          >
            Cancel job
          </Button>
        )}
        <Button onClick={() => stage?.startGhost(b.type, b.x, b.y, b.rotation, b.id)}>Move</Button>
        {spec.producer && (
          <Button
            busy={collecting}
            onClick={() =>
              void collect({
                pending: 'Collecting…',
                run: () => api.post<{ collected: Amounts; lost: Amounts }>(`/api/village/buildings/${b.id}/collect`),
                success: collectCopy,
                errors: { not_a_producer: 'Only producers can be collected.' },
              }).then(refresh)
            }
          >
            Collect
          </Button>
        )}
      </section>
    </Panel>
  );
}

export function TrainPanel() {
  const s = useStore();
  const times = useAppliedTimes();
  const [unit, setUnit] = useState<UnitKey>('saltjack');
  const [count, setCount] = useState('1');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const housing = s.village?.army.housing;
  const submit = (e: Event): void => {
    e.preventDefault();
    const n = Number(count);
    void run({
      pending: 'Queuing training…',
      run: () => api.post<{ army: Army }>('/api/army/train', { unit, count: Number.isInteger(n) && count.trim() !== '' ? n : count }),
      success: (r) => {
        const batch = r.army.training[r.army.training.length - 1];
        return `Training ${n} ${UNITS[unit].name}. Ready at ${localTime(batch?.finishesAt ?? Date.now(), zone())}.`;
      },
      errors: {
        housing_full: 'Your camps are full.',
        barracks_required: 'Build a Tide Barracks first.',
        barracks_level_too_low: 'Upgrade your Tide Barracks first.',
        insufficient_resources: PLACE_ERRORS.insufficient_resources,
      },
      fields: setErrors,
    }).then(() => loadVillage().catch(() => undefined));
  };
  return (
    <Panel label="Train army" title="Train army">
      <form onSubmit={submit} noValidate>
        <section>
          <fieldset class="stack bare">
            <legend class="sr-only">Unit</legend>
            {UNIT_KEYS.map((key) => {
              const u = UNITS[key];
              return (
                <label key={key} class="radio-chip">
                  <input type="radio" name="train-unit" value={key} checked={unit === key} onChange={() => setUnit(key)} {...invalid('train-unit', errors.unit)} />
                  <span>{u.name}</span>
                  <span class="meta num">
                    {amountsText(u.cost)} · {times ? `${times.train[key]} s` : ''}
                  </span>
                </label>
              );
            })}
            {errors.unit && (
              <p class="field-error" id="train-unit-error">
                {errors.unit}
              </p>
            )}
          </fieldset>
        </section>
        <section>
          <Field id="train-count" label="Count" error={errors.count}>
            <input id="train-count" type="number" min={1} max={20} step={1} inputMode="numeric" value={count} onInput={(e) => setCount(e.currentTarget.value)} {...invalid('train-count', errors.count)} />
          </Field>
          {housing && (
            <p class="hint">
              Camps hold <span class="num">{housing.used}</span> of <span class="num">{housing.capacity}</span>.
            </p>
          )}
          <Button type="submit" variant="primary" busy={busy}>
            Train
          </Button>
        </section>
      </form>
    </Panel>
  );
}
