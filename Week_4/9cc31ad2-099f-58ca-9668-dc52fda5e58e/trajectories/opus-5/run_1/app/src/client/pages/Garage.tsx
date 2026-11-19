import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CarStats,
  CLASS_LIMITS,
  LAYOUTS,
  LAYOUT_IDS,
  MAX_STAGE,
  SYSTEMS,
  SYSTEM_LABELS,
  type LayoutId,
  type SystemName,
  carSpec,
  piWithStages,
  stagePrice,
  statsWithStages,
} from '../../shared/catalogue.js';
import {
  formatDelta,
  formatRaceTime,
  formatThousands,
  referenceSummary,
  type MeterKey,
  type Units,
  SECTOR_LABELS,
  meterValue,
} from '../../shared/format.js';
import { refitRefund } from '../../shared/payouts.js';
import { apiPatch, apiPostRaw, newIdempotencyKey, type ApiResult } from '../api.js';
import { CarView } from '../components/CarView.js';
import { Dialog } from '../components/Dialog.js';
import { Meter, StagePips } from '../components/Meters.js';
import { Page } from '../components/Page.js';
import { TrackOutline, type SectorTint } from '../components/TrackOutline.js';
import {
  balanceCopy,
  copy,
  piWarning,
  refitAnnouncement,
  shortfallCopy,
  upgradeAnnouncement,
} from '../copy.js';
import { useReducedMotion } from '../hooks.js';
import { Link } from '../router.js';
import {
  balance,
  refreshChampionship,
  refreshGarage,
  refreshMe,
  useChampionship,
  useGarage,
  useLatestBalance,
  useMe,
  useVisibleBalance,
} from '../store.js';
import type { GarageCar, ReferenceBody, RefitResponse, UpgradeResponse } from '../types.js';

const METER_KEYS: MeterKey[] = ['accel', 'brake', 'top', 'grip', 'lane'];
const MARKER_MS = 1200;
/** The marker eases out, so the chips flip as it passes one third, two thirds and the end. */
const CHIP_MS = [220, 507, MARKER_MS];
const COUNT_START_MS = 1450;
const COUNT_END_MS = 1700;

type Phase = 'buy' | 'pending' | 'unconfirmed' | 'insufficient';

interface UpgradeDialogState {
  instance: number;
  carId: string;
  system: SystemName;
  stage: number;
  price: number;
  phase: Phase;
  key: string | null;
  bytes: string;
}

interface RefitDialogState {
  carId: string;
  system: SystemName;
  refund: number;
  pending: boolean;
}

interface SweepState {
  carId: string;
  reference: ReferenceBody;
  announcement: string;
  responseBalance: number;
  chips: number;
  counted: boolean;
  /** The predicted lap time while it counts from the old time to the new one. */
  countingMs: number | null;
  marker: number | null;
  done: boolean;
}

function tintFor(deltaMs: number): SectorTint {
  if (deltaMs < 0) return 'gain';
  if (deltaMs > 0) return 'loss';
  return 'ink';
}

export function Garage() {
  const garage = useGarage();
  const championship = useChampionship();
  const { me } = useMe();
  const visibleBalance = useVisibleBalance();
  const latestBalance = useLatestBalance();
  const reduced = useReducedMotion();
  const units: Units = me?.units ?? 'kmh';

  const [referenceMap, setReferenceMap] = useState<LayoutId>('saltflat-ring');
  const [upgradeDialog, setUpgradeDialog] = useState<UpgradeDialogState | null>(null);
  const [refitDialog, setRefitDialog] = useState<RefitDialogState | null>(null);
  const [preview, setPreview] = useState<{ system: SystemName; stage: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [sweep, setSweep] = useState<SweepState | null>(null);

  const timers = useRef<number[]>([]);
  const frame = useRef(0);
  const sweepRef = useRef<SweepState | null>(null);
  const buyButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const refitButton = useRef<HTMLButtonElement>(null);
  const openerId = useRef<string | null>(null);

  sweepRef.current = sweep;

  useEffect(() => {
    void refreshGarage();
    void refreshChampionship();
  }, []);

  const quarryUnlocked =
    championship?.leagues.some(
      (league) => league.leagueId === 'rookie' && league.status === 'complete',
    ) ?? false;

  const car: GarageCar | null =
    garage?.cars.find((entry) => entry.carId === garage.selectedCarId) ?? garage?.cars[0] ?? null;

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    cancelAnimationFrame(frame.current);
  }, []);

  /** Ends a sweep by applying everything it would still do, at once. */
  const finishSweep = useCallback(() => {
    clearTimers();
    const current = sweepRef.current;
    if (current === null || current.done) return;
    const ended: SweepState = {
      ...current,
      chips: 3,
      counted: true,
      countingMs: null,
      marker: null,
      done: true,
    };
    sweepRef.current = ended;
    balance.setVisible(current.responseBalance);
    balance.release();
    setAnnouncement(current.announcement);
    setSweep(ended);
  }, [clearTimers]);

  const startSweep = useCallback(
    (state: SweepState) => {
      finishSweep();
      if (reduced) {
        const ended: SweepState = {
          ...state,
          chips: 3,
          counted: true,
          countingMs: null,
          marker: null,
          done: true,
        };
        sweepRef.current = ended;
        setSweep(ended);
        balance.setVisible(state.responseBalance);
        balance.release();
        setAnnouncement(state.announcement);
        return;
      }
      const started = performance.now();
      const fresh: SweepState = {
        ...state,
        chips: 0,
        counted: false,
        countingMs: state.reference.oldLapMs,
        marker: 0,
        done: false,
      };
      setSweep(fresh);
      sweepRef.current = fresh;
      const length = LAYOUTS[state.reference.layoutId].lengthM;
      const step = () => {
        const progress = Math.min((performance.now() - started) / MARKER_MS, 1);
        const eased = 1 - Math.pow(1 - progress, 2);
        setSweep((current) => (current === null ? current : { ...current, marker: eased * length }));
        if (progress < 1) frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
      CHIP_MS.forEach((at, index) => {
        timers.current.push(
          window.setTimeout(() => {
            setSweep((current) => (current === null ? current : { ...current, chips: index + 1 }));
          }, at),
        );
      });
      timers.current.push(
        window.setTimeout(() => {
          const from = balance.getVisible();
          const to = state.responseBalance;
          const oldLap = state.reference.oldLapMs;
          const newLap = state.reference.newLapMs;
          const countStarted = performance.now();
          const count = () => {
            const progress = Math.min(
              (performance.now() - countStarted) / (COUNT_END_MS - COUNT_START_MS),
              1,
            );
            balance.setVisible(Math.round(from + (to - from) * progress));
            setSweep((current) =>
              current === null
                ? current
                : {
                    ...current,
                    counted: true,
                    countingMs:
                      progress < 1 ? Math.round(oldLap + (newLap - oldLap) * progress) : null,
                  },
            );
            if (progress < 1) requestAnimationFrame(count);
            else {
              balance.release();
              setAnnouncement(state.announcement);
              setSweep((current) => (current === null ? current : { ...current, done: true }));
              if (sweepRef.current !== null) sweepRef.current = { ...sweepRef.current, done: true };
            }
          };
          requestAnimationFrame(count);
        }, COUNT_START_MS),
      );
    },
    [finishSweep, reduced],
  );

  // Leaving the garage ends any sweep at once.
  useEffect(() => () => finishSweep(), [finishSweep]);

  // The dialog follows the live balance while it is neither pending nor unconfirmed.
  useEffect(() => {
    if (upgradeDialog === null) return;
    if (upgradeDialog.phase === 'pending' || upgradeDialog.phase === 'unconfirmed') return;
    if (latestBalance < upgradeDialog.price && upgradeDialog.phase !== 'insufficient') {
      setUpgradeDialog({ ...upgradeDialog, phase: 'insufficient' });
      cancelButton.current?.focus();
    } else if (latestBalance >= upgradeDialog.price && upgradeDialog.phase === 'insufficient') {
      setUpgradeDialog({ ...upgradeDialog, phase: 'buy' });
    }
  }, [latestBalance, upgradeDialog]);

  const closeUpgradeDialog = useCallback(
    async (state: UpgradeDialogState, refresh: boolean) => {
      setUpgradeDialog(null);
      if (!refresh) {
        document.getElementById(openerId.current ?? '')?.focus();
        return;
      }
      balance.release();
      const fresh = await refreshGarage();
      setAnnouncement(copy.garageRefreshed);
      const refreshedCar = fresh?.cars.find((entry) => entry.carId === state.carId);
      const stage = refreshedCar?.stages[state.system] ?? 0;
      const target =
        stage >= MAX_STAGE ? `refit-${state.system}` : `upgrade-${state.system}`;
      window.setTimeout(() => document.getElementById(target)?.focus(), 0);
    },
    [],
  );

  const handleUpgradeAnswer = useCallback(
    async (state: UpgradeDialogState, result: ApiResult<UpgradeResponse>) => {
      if (result.kind === 'unconfirmed') {
        setUpgradeDialog({ ...state, phase: 'unconfirmed' });
        window.setTimeout(() => buyButton.current?.focus(), 0);
        return;
      }
      if (result.kind === 'ok') {
        const response = result.data;
        setUpgradeDialog(null);
        balance.learn(response.balance);
        const updated = await refreshGarage();
        const summary = referenceSummary(
          response.reference.deltaMs,
          response.reference.sectorDeltasMs,
        );
        startSweep({
          carId: response.carId,
          reference: response.reference,
          responseBalance: response.balance,
          announcement: upgradeAnnouncement(
            SYSTEM_LABELS[response.system],
            response.stage,
            response.balance,
            summary,
          ),
          chips: 0,
          counted: false,
          countingMs: null,
          marker: 0,
          done: false,
        });
        const stage = updated?.cars.find((entry) => entry.carId === response.carId)?.stages[
          response.system
        ];
        const target =
          (stage ?? response.stage) >= MAX_STAGE
            ? `refit-${response.system}`
            : `upgrade-${response.system}`;
        window.setTimeout(() => document.getElementById(target)?.focus(), 0);
        return;
      }
      if (result.status === 402) {
        balance.release();
        await refreshGarage();
        setUpgradeDialog({ ...state, phase: 'insufficient', key: null });
        window.setTimeout(() => cancelButton.current?.focus(), 0);
        return;
      }
      await closeUpgradeDialog(state, true);
    },
    [closeUpgradeDialog, startSweep],
  );

  const sendUpgrade = useCallback(
    async (state: UpgradeDialogState, key: string) => {
      setUpgradeDialog({ ...state, phase: 'pending', key });
      const result = await apiPostRaw<UpgradeResponse>(
        `/v1/garage/cars/${state.carId}/upgrades/${state.system}`,
        state.bytes,
        { 'content-type': 'application/json', 'Idempotency-Key': key },
      );
      await handleUpgradeAnswer({ ...state, key }, result);
    },
    [handleUpgradeAnswer],
  );

  const openUpgrade = (target: GarageCar, system: SystemName) => {
    const stage = target.stages[system] + 1;
    const price = stagePrice(carSpec(target.carId).class, stage);
    openerId.current = `upgrade-${system}`;
    setUpgradeDialog({
      instance: Date.now(),
      carId: target.carId,
      system,
      stage,
      price,
      phase: balance.getLatest() >= price ? 'buy' : 'insufficient',
      key: null,
      bytes: JSON.stringify({ stage, layoutId: referenceMap }),
    });
  };

  // On opening, focus goes to Buy, or to Cancel in the not-enough-coins state.
  useEffect(() => {
    if (upgradeDialog === null) return;
    if (upgradeDialog.phase === 'insufficient') cancelButton.current?.focus();
    else buyButton.current?.focus();
  }, [upgradeDialog?.instance]);

  useEffect(() => {
    if (refitDialog !== null) refitButton.current?.focus();
  }, [refitDialog === null]);

  const refit = async (state: RefitDialogState) => {
    setRefitDialog({ ...state, pending: true });
    const result = await apiPostRaw<RefitResponse>(
      `/v1/garage/cars/${state.carId}/refits/${state.system}`,
      '{}',
      { 'content-type': 'application/json', 'Idempotency-Key': newIdempotencyKey() },
    );
    setRefitDialog(null);
    if (result.kind === 'ok') {
      balance.learn(result.data.balance);
      await refreshGarage();
      setAnnouncement(
        refitAnnouncement(
          SYSTEM_LABELS[result.data.system],
          result.data.refund,
          result.data.balance,
        ),
      );
    } else {
      await refreshGarage();
      setAnnouncement(copy.garageRefreshed);
    }
    window.setTimeout(() => document.getElementById(`upgrade-${state.system}`)?.focus(), 0);
  };

  if (garage === null || car === null) {
    return (
      <Page gutter={['Car', 'Slots', 'Setup']}>
        <h1>Garage</h1>
      </Page>
    );
  }

  const spec = carSpec(car.carId);
  const previewStats =
    preview === null
      ? null
      : statsWithStages(car.carId, { ...car.stages, [preview.system]: preview.stage });
  const reference = sweep?.carId === car.carId ? sweep.reference : car.latestReference;
  const chipsShown = sweep?.carId === car.carId ? sweep.chips : 3;
  const counted = sweep?.carId === car.carId ? sweep.counted : true;
  const countingMs = sweep?.carId === car.carId ? sweep.countingMs : null;
  const markerAt = sweep?.carId === car.carId ? sweep.marker : null;
  const tints: [SectorTint, SectorTint, SectorTint] | undefined =
    reference === null
      ? undefined
      : ([0, 1, 2].map((index) =>
          index < chipsShown ? tintFor(reference.sectorDeltasMs[index] ?? 0) : 'ink',
        ) as [SectorTint, SectorTint, SectorTint]);
  const summary =
    reference === null
      ? ''
      : referenceSummary(reference.deltaMs, reference.sectorDeltasMs);

  return (
    <Page gutter={['Car', 'Slots', 'Setup']}>
      <h1>Garage</h1>
      <div className="cell row" style={{ justifyContent: 'space-between' }}>
        <span role="status" aria-label="Coin balance" className="coin-balance">
          {balanceCopy(visibleBalance)}
        </span>
        <label className="filter-field">
          <span className="label">Car</span>
          <select
            aria-label="Car"
            value={car.carId}
            onChange={(event) => {
              finishSweep();
              setSweep(null);
              void apiPatch('/v1/garage', { selectedCarId: event.target.value }).then(() =>
                refreshGarage(),
              );
            }}
          >
            {garage.cars.map((entry) => (
              <option key={entry.carId} value={entry.carId}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="label">Reference map</span>
          <select
            aria-label="Reference map"
            value={referenceMap}
            onChange={(event) => {
              finishSweep();
              setSweep(null);
              setReferenceMap(event.target.value as LayoutId);
            }}
          >
            {LAYOUT_IDS.filter(
              (layoutId) => layoutId === 'saltflat-ring' || quarryUnlocked,
            ).map((layoutId) => (
              <option key={layoutId} value={layoutId}>
                {LAYOUTS[layoutId].name}
              </option>
            ))}
          </select>
        </label>
        <fieldset role="radiogroup" aria-label="Speed units" className="row">
          <legend className="label">Speed units</legend>
          {(['kmh', 'mph'] as Units[]).map((unit) => (
            <label className="choice" key={unit}>
              <input
                type="radio"
                name="units"
                aria-label={unit === 'kmh' ? 'km/h' : 'mph'}
                checked={units === unit}
                onChange={() => {
                  void apiPatch('/v1/me', { units: unit }).then(() => refreshMe());
                }}
              />
              {unit === 'kmh' ? 'km/h' : 'mph'}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="garage-grid">
        <section className="cell" role="region" aria-label="Car">
          <h2>Car</h2>
          <CarView carName={car.name} />
          <p>
            {car.name} · class {spec.class} ·{' '}
            <span className="mono">PI {car.pi}</span>
          </p>
        </section>

        <section className="cell" role="region" aria-label="Upgrade slots">
          <h2>Upgrade slots</h2>
          {SYSTEMS.map((system) => {
            const stage = car.stages[system];
            return (
              <div className="slot" role="group" aria-label={SYSTEM_LABELS[system]} key={system}>
                <span className="label">{SYSTEM_LABELS[system]}</span>
                <StagePips stage={stage} />
                <div className="slot-actions">
                  {stage < MAX_STAGE && (
                    <button
                      type="button"
                      className="primary"
                      id={`upgrade-${system}`}
                      onClick={() => openUpgrade(car, system)}
                      onFocus={() => setPreview({ system, stage: stage + 1 })}
                      onBlur={() => setPreview(null)}
                      onMouseEnter={() => setPreview({ system, stage: stage + 1 })}
                      onMouseLeave={() => setPreview(null)}
                    >
                      Upgrade {SYSTEM_LABELS[system]} to stage {stage + 1}
                    </button>
                  )}
                  {stage > 0 && (
                    <button
                      type="button"
                      className="secondary"
                      id={`refit-${system}`}
                      onClick={() =>
                        setRefitDialog({
                          carId: car.carId,
                          system,
                          refund: refitRefund(car.paid[system]),
                          pending: false,
                        })
                      }
                    >
                      Refit {SYSTEM_LABELS[system]} to stock
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section className="cell setup-region" role="region" aria-label="Setup sheet">
          <h2>Setup sheet</h2>
          {METER_KEYS.map((key) => (
            <Meter
              key={key}
              meterKey={key}
              value={meterValue(car.stats, key)}
              preview={previewOf(car.stats, previewStats, key)}
              units={units}
            />
          ))}
          <figure aria-label="Reference lap">
            <span className="label">Reference lap</span>
            <TrackOutline
              layoutId={reference?.layoutId ?? referenceMap}
              sectorTints={tints}
              markerAt={markerAt ?? 0}
            />
            <div className="sector-chips">
              {SECTOR_LABELS.map((label, index) => (
                <span className="chip" key={label}>
                  {reference !== null && index < chipsShown
                    ? `${label} ${formatDelta(reference.sectorDeltasMs[index] ?? 0)}`
                    : label}
                </span>
              ))}
            </div>
            <p className="figure">
              Predicted lap{' '}
              {reference === null
                ? '—'
                : formatRaceTime(
                    countingMs ?? (counted ? reference.newLapMs : reference.oldLapMs),
                  )}{' '}
              {reference !== null && counted && (
                <span className="struck">{formatRaceTime(reference.oldLapMs)}</span>
              )}
            </p>
            {reference !== null && (
              <>
                <p className="figure">Cost −{formatThousands(reference.price)} coins</p>
                <p>{summary}</p>
              </>
            )}
          </figure>
        </section>
      </div>

      <div className="cell" role="status" aria-label="Garage updates">
        {announcement}
      </div>

      <div className="row">
        <Link to="/garage/coins" className="secondary">
          Coin history
        </Link>
        <Link to="/garage/dealer" className="secondary">
          Dealer
        </Link>
        {me?.guest === true && (
          <Link to="/sign-in" className="secondary">
            Save my garage
          </Link>
        )}
      </div>

      {upgradeDialog !== null && (
        <Dialog
          label="Confirm upgrade"
          onEscape={() =>
            void closeUpgradeDialog(upgradeDialog, upgradeDialog.phase === 'unconfirmed')
          }
        >
          <h2>Confirm upgrade</h2>
          <p>
            {SYSTEM_LABELS[upgradeDialog.system]} stage {upgradeDialog.stage} ·{' '}
            <span className="mono">{formatThousands(upgradeDialog.price)} coins</span>
          </p>
          <UpgradeChanges
            car={car}
            system={upgradeDialog.system}
            stage={upgradeDialog.stage}
            units={units}
          />
          {piWithStages(car.carId, { ...car.stages, [upgradeDialog.system]: upgradeDialog.stage }) >
            CLASS_LIMITS[spec.class].max && (
            <p>
              {piWarning(
                piWithStages(car.carId, {
                  ...car.stages,
                  [upgradeDialog.system]: upgradeDialog.stage,
                }),
                spec.class,
                CLASS_LIMITS[spec.class].max,
              )}
            </p>
          )}
          {upgradeDialog.phase === 'insufficient' && (
            <>
              <h3>{copy.notEnoughHeading}</h3>
              <p>{shortfallCopy(upgradeDialog.price - latestBalance)}</p>
            </>
          )}
          {upgradeDialog.phase === 'unconfirmed' && <p>{copy.unconfirmed}</p>}
          <div className="dialog-actions">
            {upgradeDialog.phase === 'unconfirmed' ? (
              <button
                type="button"
                className="primary"
                ref={buyButton}
                onClick={() => void sendUpgrade(upgradeDialog, upgradeDialog.key!)}
              >
                Check again
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                ref={buyButton}
                disabled={
                  upgradeDialog.phase === 'pending' || upgradeDialog.phase === 'insufficient'
                }
                onClick={() => {
                  balance.hold();
                  void sendUpgrade(upgradeDialog, newIdempotencyKey());
                }}
              >
                {upgradeDialog.phase === 'pending'
                  ? copy.buying
                  : `Buy for ${formatThousands(upgradeDialog.price)} coins`}
              </button>
            )}
            <button
              type="button"
              className="secondary"
              ref={cancelButton}
              onClick={() =>
                void closeUpgradeDialog(upgradeDialog, upgradeDialog.phase === 'unconfirmed')
              }
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}

      {refitDialog !== null && (
        <Dialog
          label="Confirm refit"
          onEscape={() => {
            setRefitDialog(null);
            document.getElementById(`refit-${refitDialog.system}`)?.focus();
          }}
        >
          <h2>Confirm refit</h2>
          <p>
            {SYSTEM_LABELS[refitDialog.system]} back to stock ·{' '}
            <span className="mono">refund {formatThousands(refitDialog.refund)} coins</span>
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              ref={refitButton}
              disabled={refitDialog.pending}
              onClick={() => void refit(refitDialog)}
            >
              {refitDialog.pending
                ? copy.refitting
                : `Refit and refund ${formatThousands(refitDialog.refund)} coins`}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setRefitDialog(null);
                document.getElementById(`refit-${refitDialog.system}`)?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </Page>
  );
}

/** A meter previews only when the next stage changes its value. */
function previewOf(
  current: CarStats,
  preview: CarStats | null,
  key: MeterKey,
): number | null {
  if (preview === null) return null;
  const next = meterValue(preview, key);
  return next === meterValue(current, key) ? null : next;
}

function UpgradeChanges({
  car,
  system,
  stage,
  units,
}: {
  car: GarageCar;
  system: SystemName;
  stage: number;
  units: Units;
}) {
  const after = statsWithStages(car.carId, { ...car.stages, [system]: stage });
  return (
    <ul>
      {METER_KEYS.filter((key) => meterValue(after, key) !== meterValue(car.stats, key)).map(
        (key) => (
          <li key={key}>
            <Meter
              meterKey={key}
              value={meterValue(car.stats, key)}
              preview={meterValue(after, key)}
              units={units}
            />
          </li>
        ),
      )}
    </ul>
  );
}
