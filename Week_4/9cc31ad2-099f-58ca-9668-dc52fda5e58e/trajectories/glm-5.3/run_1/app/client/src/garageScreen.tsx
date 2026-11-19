// The garage: the 3D view, the upgrade slots, the setup sheet, purchases and the sweep.
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { api, ApiError, type Garage, type GarageCar, type Reference } from './api';
import { useApp, usePush } from './appState';
import { Dialog, navigate, prefersReducedMotion } from './ui';
import { fmtAccel, fmtBrake, fmtGrip, fmtSteps, fmtCoins, fmtDelta, fmtTime, fmtSpeed } from './formats';
import { SYSTEM_IDS, SYSTEM_NAMES, UPGRADE_PRICES, upgradePrice, type SystemId } from '../../shared/domain';
import { CarView3D } from './carView3d';
import { UpgradeDialog, SweepController, upgradeKey, type PurchasePhase } from './purchaseFlow';
import { ReferenceLapFigure, summaryOf } from './referenceLap';

type DialogState =
  | { kind: 'none' }
  | { kind: 'upgrade'; system: SystemId; stage: number }
  | { kind: 'car'; carId: string; price: number }
  | { kind: 'refit'; system: SystemId };

type PurchaseState =
  | { phase: 'buy' }
  | { phase: 'pending' }
  | { phase: 'unconfirmed' }
  | { phase: 'insufficient'; shortfall: number };

export default function GarageScreen(): JSX.Element {
  const { me, garage, refreshGarage } = useApp();
  const [units, setUnits] = useState<'kmh' | 'mph'>(me?.units ?? 'kmh');
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [purchase, setPurchase] = useState<PurchaseState>({ phase: 'buy' });
  const [announcement, setAnnouncement] = useState('');
  const [refitBusy, setRefitBusy] = useState(false);
  const [preview, setPreview] = useState<SystemId | null>(null);
  const [referenceMap, setReferenceMap] = useState<string>('saltflat-ring');
  const [balanceOverride, setBalanceOverride] = useState<number | null>(null);
  const sweepRef = useRef<{ cancel: () => void } | null>(null);
  const openerRef = useRef<string>('');
  const latestBalanceRef = useRef<number | null>(null);
  const pendingAttemptRef = useRef(false);
  const heldPushesRef = useRef<{ balance: number; purchaseId: string | null }[]>([]);
  const dialogPurchaseIdRef = useRef<string | null>(null);

  const car = garage?.cars.find(c => c.carId === garage.selectedCarId) ?? null;
  const balance = balanceOverride ?? garage?.balance ?? 0;
  latestBalanceRef.current = balance;

  // Held pushes: while a purchase is pending or unconfirmed, pushes change nothing on screen.
  usePush((msg) => {
    if (dialog.kind === 'none' && !pendingAttemptRef.current) return;
    if (msg.type === 'balance' && typeof msg.balance === 'number') {
      if (pendingAttemptRef.current) {
        heldPushesRef.current.push({ balance: msg.balance, purchaseId: msg.purchaseId ?? null });
        return;
      }
    }
  });

  const applyHeldPushes = useCallback((atSweepStep: boolean): void => {
    const held = heldPushesRef.current;
    heldPushesRef.current = [];
    const newest = held.length > 0 ? held[held.length - 1].balance : null;
    if (newest !== null) {
      if (atSweepStep) {
        setBalanceOverride(newest);
      } else {
        setBalanceOverride(newest);
      }
    }
    void refreshGarage();
  }, [refreshGarage]);

  const announce = (text: string): void => setAnnouncement(text);

  const refreshAll = useCallback(async (): Promise<void> => {
    setBalanceOverride(null);
    await refreshGarage();
    announce('Garage refreshed from the server.');
  }, [refreshGarage]);

  const openDialog = (state: DialogState, opener: string): void => {
    setDialog(state);
    openerRef.current = opener;
    setPurchase({ phase: 'buy' });
  };

  const closeDialog = (): void => {
    const wasPending = pendingAttemptRef.current;
    pendingAttemptRef.current = false;
    setDialog({ kind: 'none' });
    if (wasPending) {
      // Closing while unconfirmed: re-read and show the committed garage at once.
      void refreshAll();
    }
    focusOpener();
  };

  const focusOpener = (): void => {
    const sel = openerRef.current;
    if (sel) {
      document.querySelector<HTMLElement>(sel)?.focus();
    }
  };

  // The purchase attempt: one idempotency key per attempt, byte-identical body.
  const attemptPurchase = async (rawBody: string,
    send: (key: string) => Promise<{ purchaseId: string; balance: number; reference: Reference }>): Promise<void> => {
    const key = upgradeKey();
    pendingAttemptRef.current = true;
    setPurchase({ phase: 'pending' });
    try {
      const out = await send(key);
      pendingAttemptRef.current = false;
      dialogPurchaseIdRef.current = out.purchaseId;
      // Confirmed: close, play the sweep, step the balance.
      setDialog({ kind: 'none' });
      await playSweep(out);
      focusOpener();
    } catch (err) {
      pendingAttemptRef.current = false;
      if (err instanceof ApiError) {
        if (err.status === 402) {
          // Insufficient coins: stay open, re-read the garage, show the shortfall.
          const g = await api.garage();
          const shortfall = err.message.match(/(\d[\d,]*)/);
          setPurchase({ phase: 'insufficient', shortfall: shortfall ? Number(shortfall[1].replace(/,/g, '')) : 0 });
          latestBalanceRef.current = g.balance;
          setBalanceOverride(g.balance);
          return;
        }
        // Any other answer: close, re-read, refresh announcement.
        setDialog({ kind: 'none' });
        await refreshAll();
        focusOpener();
        return;
      }
      // No HTTP response at all: unconfirmed.
      setPurchase({ phase: 'unconfirmed' });
    }
  };

  const playSweep = async (out: { purchaseId: string; balance: number; reference: Reference }): Promise<void> => {
    if (!car) return;
    const reference = out.reference;
    const stageText = `${SYSTEM_NAMES[dialog.kind === 'upgrade' ? dialog.system : 'engine']} stage ${dialog.kind === 'upgrade' ? dialog.stage : 1} fitted. Balance: ${fmtCoins(out.balance)} coins. ${summaryOf(reference)}`;
    const sweep = new SweepController(out.purchaseId, out.balance, applyHeldPushes,
      (text) => announce(text), stageText);
    sweepRef.current = { cancel: () => sweep.finishNow() };
    await sweep.play();
  };

  // Interrupted sweep: a car or map change or leaving the garage ends it at once.
  useEffect(() => {
    return () => { sweepRef.current?.cancel(); };
  }, []);

  const changeCar = async (carId: string): Promise<void> => {
    sweepRef.current?.cancel();
    await api.selectCar(carId);
    await refreshGarage();
  };

  const changeReferenceMap = (layoutId: string): void => {
    sweepRef.current?.cancel();
    setReferenceMap(layoutId);
  };

  // The dialog follows the live balance.
  useEffect(() => {
    if (dialog.kind === 'none' || purchase.phase === 'pending' || purchase.phase === 'unconfirmed') return;
    const price = dialogPrice(dialog, car);
    if (price === null) return;
    const bal = latestBalanceRef.current ?? 0;
    if (purchase.phase === 'buy' && bal < price) {
      setPurchase({ phase: 'insufficient', shortfall: price - bal });
    } else if (purchase.phase === 'insufficient' && bal >= price) {
      setPurchase({ phase: 'buy' });
    }
  }, [balance, dialog, purchase.phase, car]);

  if (!garage || !car || !me) {
    return <main className="page"><p>Loading…</p></main>;
  }

  const nextStage = (system: SystemId): number => car.stages[system] + 1;
  const slotFocus = (system: SystemId): string =>
    `[data-slot="${system}"] button[data-action="upgrade"]`;

  return (
    <main className="page" style={{ paddingTop: 20 }}>
      <div className="content-with-gutter">
        <aside className="gutter" aria-hidden="true">
          <span className="gutter-item"><b>01</b>Car</span>
          <span className="gutter-item"><b>02</b>Slots</span>
          <span className="gutter-item"><b>03</b>Setup</span>
        </aside>
        <section>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <h1 style={{ margin: 0 }}>Garage</h1>
            <div className="status" role="status" aria-live="polite">
              <span className="mono" data-region="coin-balance">{fmtCoins(balance)} coins</span>
            </div>
            <label className="field" style={{ margin: 0 }}>
              <span className="label">Car</span>
              <select
                aria-label="Car"
                value={garage.selectedCarId}
                onChange={e => { void changeCar(e.target.value); }}
              >
                {garage.cars.map(c => <option key={c.carId} value={c.carId}>{c.name}</option>)}
              </select>
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span className="label">Reference map</span>
              <select aria-label="Reference map" value={referenceMap} onChange={e => changeReferenceMap(e.target.value)}>
                <option value="saltflat-ring">Saltflat Ring</option>
                {(garage.cars.some(c => c.class === 'C') || me.playerId === 'unlocked') && (
                  <option value="quarry-switchbacks">Quarry Switchbacks</option>
                )}
              </select>
            </label>
            <fieldset className="field" style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
              <legend className="visually-hidden">Speed units</legend>
              <span className="label" style={{ margin: 0 }}>Speed units</span>
              <label><input type="radio" name="units" checked={units === 'kmh'} onChange={() => setUnits('kmh')} /> km/h</label>
              <label><input type="radio" name="units" checked={units === 'mph'} onChange={() => setUnits('mph')} /> mph</label>
            </fieldset>
          </div>
          <div className="status" role="status" aria-live="polite" aria-label="Garage updates"
               style={{ minHeight: '1.4em' }}>{announcement}</div>

          <div className="garage-grid" style={{ display: 'grid', gap: 14 }}>
            <div className="rule-cell" style={{ gridColumn: '1 / -1', minWidth: 0 }}>
              <section aria-label="Car" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <CarView3D carName={car.name} />
                <div>
                  <h2 style={{ marginTop: 0 }}>{car.name}</h2>
                  <div className="mono">class {car.class} · PI <span className="mono">{car.pi}</span></div>
                  {car.overClassLimit && (
                    <p className="notice" style={{ padding: '6px 10px' }}>Over the class {car.class} limit.</p>
                  )}
                </div>
              </section>
            </div>

            <div className="rule-cell">
              <section aria-label="Upgrade slots" data-region="slots">
                <h2 style={{ marginTop: 0 }}>Upgrade slots</h2>
                {SYSTEM_IDS.map(sys => {
                  const stage = car.stages[sys];
                  const price = stage < 3 ? upgradePrice(car.class as 'D' | 'C' | 'B', stage + 1) : null;
                  const paid = car.paid[sys];
                  return (
                    <div key={sys} data-slot={sys} role="group" aria-label={SYSTEM_NAMES[sys]}
                         style={{ borderBottom: '1px solid var(--rule)', padding: '10px 0', minWidth: 0 }}>
                      <strong>{SYSTEM_NAMES[sys]}</strong>{' '}
                      <span className="pips" role="img" aria-label={`Stage ${stage} of 3`}
                            style={{ marginLeft: 6 }}>
                        {[0, 1, 2].map(i => (
                          <span key={i} className={`pip ${i < stage ? 'on' : ''}`} data-pip={i < stage ? 'on' : 'off'} />
                        ))}
                      </span>
                      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                        {stage < 3 && (
                          <button
                            className="btn"
                            data-action="upgrade"
                            data-system={sys}
                            data-stage={stage + 1}
                            aria-label={`Upgrade ${SYSTEM_NAMES[sys]} to stage ${stage + 1}`}
                            onFocus={() => setPreview(sys)}
                            onBlur={() => setPreview(null)}
                            onMouseEnter={() => setPreview(sys)}
                            onMouseLeave={() => setPreview(null)}
                            onClick={() => openDialog(
                              { kind: 'upgrade', system: sys, stage: stage + 1 },
                              `[data-slot="${sys}"] button[data-action="upgrade"]`
                            )}
                          >
                            Upgrade {SYSTEM_NAMES[sys]} to stage {stage + 1}
                          </button>
                        )}
                        {stage > 0 && (
                          <button
                            className="btn btn-quiet"
                            data-action="refit"
                            disabled={refitBusy}
                            onClick={() => {
                              openDialog({ kind: 'refit', system: sys },
                                `[data-slot="${sys}"] button[data-action="upgrade"], [data-slot="${sys}"] button[data-action="refit"]`);
                            }}
                          >
                            Refit {SYSTEM_NAMES[sys]} to stock
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            </div>

            <div className="rule-cell">
              <section aria-label="Setup sheet">
                <h2 style={{ marginTop: 0 }}>Setup sheet</h2>
                <StatBars car={car} preview={preview} units={units} />
                <ReferenceLapFigure garage={garage} car={car} units={units} layoutId={referenceMap} />
              </section>
            </div>
          </div>

          <p style={{ marginTop: 20 }}>
            <a href="/garage/coins" onClick={e => { e.preventDefault(); navigate('/garage/coins'); }}>Coin history</a>
            {' · '}
            <a href="/garage/dealer" onClick={e => { e.preventDefault(); navigate('/garage/dealer'); }}>Dealer</a>
            {me.guest && (
              <>
                {' · '}
                <a href="/sign-in" onClick={e => { e.preventDefault(); navigate('/sign-in'); }}>Save my garage</a>
              </>
            )}
          </p>
        </section>
      </div>

      {dialog.kind === 'upgrade' && (
        <UpgradeDialog
          car={car}
          system={dialog.system}
          stage={dialog.stage}
          layoutId={referenceMap}
          phase={purchase.phase}
          shortfall={purchase.phase === 'insufficient' ? purchase.shortfall : 0}
          balance={balance}
          onCancel={closeDialog}
          onBuy={(key, rawBody) => {
            void attemptPurchase(rawBody, (k) => api.upgrade(car.carId, dialog.system, dialog.stage, referenceMap, k, rawBody));
          }}
          onCheckAgain={(key, rawBody) => {
            void attemptPurchase(rawBody, (k) => api.upgrade(car.carId, dialog.system, dialog.stage, referenceMap, k, rawBody));
          }}
        />
      )}
      {dialog.kind === 'refit' && car && (
        <RefitDialog
          car={car}
          system={dialog.system}
          busy={refitBusy}
          onCancel={closeDialog}
          onRefit={async () => {
            setRefitBusy(true);
            try {
              const out = await api.refit(car.carId, dialog.system, upgradeKey());
              setBalanceOverride(out.balance);
              await refreshGarage();
              setBalanceOverride(out.balance);
              announce(`${SYSTEM_NAMES[dialog.system]} refitted to stock. Refund: ${fmtCoins(out.refund)} coins. Balance: ${fmtCoins(out.balance)} coins.`);
            } catch { /* ignored */ }
            setRefitBusy(false);
            setDialog({ kind: 'none' });
            focusOpener();
          }}
        />
      )}
    </main>
  );
}

/** The Confirm refit dialog: Enter refits, Escape or Cancel closes it. */
function RefitDialog({ car, system, busy, onCancel, onRefit }: {
  car: GarageCar; system: SystemId; busy: boolean;
  onCancel: () => void; onRefit: () => Promise<void>;
}): JSX.Element {
  const paid = car.paid[system] ?? 0;
  const refund = Math.floor(paid / 2);
  return (
    <Dialog title="Confirm refit" onClose={onCancel}>
      <h2>Confirm refit</h2>
      <p>
        Refit <strong>{SYSTEM_NAMES[system]}</strong> to stock and refund{' '}
        <span className="mono">{fmtCoins(refund)} coins</span>.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => void onRefit()}>
          {busy ? 'Refitting…' : `Refit and refund ${fmtCoins(refund)} coins`}
        </button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </Dialog>
  );
}

function dialogPrice(dialog: DialogState, car: GarageCar | null): number | null {
  if (!car) return null;
  if (dialog.kind === 'upgrade') return upgradePrice(car.class as 'D' | 'C' | 'B', dialog.stage);
  if (dialog.kind === 'car') return dialog.price;
  return null;
}

function StatBars({ car, preview, units }: { car: GarageCar; preview: SystemId | null; units: 'kmh' | 'mph' }): JSX.Element {
  const current = car.stats;
  // Stage preview: focus or hover extends the bars to the next stage's values.
  const previewStats = useMemo(() => {
    if (!preview) return null;
    const s = { ...current };
    if (preview === 'engine') { s.accelMps2 += 1.0; s.topMps += 2; }
    if (preview === 'tires') s.gripPct += 4;
    if (preview === 'brakes') s.brakeMps2 += 1.5;
    if (preview === 'suspension') s.laneChangeSteps = Math.max(6, s.laneChangeSteps - 6);
    return s;
  }, [preview, current]);

  const rows: { key: string; label: string; value: number; display: string; previewDisplay?: string; max: number }[] = [
    { key: 'accel', label: 'Acceleration', value: current.accelMps2, display: fmtAccel(current.accelMps2),
      previewDisplay: previewStats ? fmtAccel(previewStats.accelMps2) : undefined, max: 10 },
    { key: 'brake', label: 'Braking', value: current.brakeMps2, display: fmtBrake(current.brakeMps2),
      previewDisplay: previewStats ? fmtBrake(previewStats.brakeMps2) : undefined, max: 15 },
    { key: 'top', label: 'Top speed', value: current.topMps, display: `${fmtSpeed(current.topMps, units)} ${units === 'kmh' ? 'km/h' : 'mph'}`,
      previewDisplay: previewStats ? `${fmtSpeed(previewStats.topMps, units)} ${units === 'kmh' ? 'km/h' : 'mph'}` : undefined, max: 70 },
    { key: 'grip', label: 'Grip', value: current.gripPct, display: fmtGrip(current.gripPct),
      previewDisplay: previewStats ? fmtGrip(previewStats.gripPct) : undefined, max: 130 },
    { key: 'lane', label: 'Lane change', value: current.laneChangeSteps, display: fmtSteps(current.laneChangeSteps),
      previewDisplay: previewStats ? fmtSteps(previewStats.laneChangeSteps) : undefined, max: 30 }
  ];

  return (
    <div>
      {rows.map(r => (
        <div key={r.key} className="meter-row">
          <span className="label">{r.label}</span>
          <span className="meter-track" aria-hidden="true">
            <span className="meter-fill" style={{
              width: `${Math.min(100, (r.value / r.max) * 100)}%`,
              transition: prefersReducedMotion() ? 'none' : 'width 0.25s ease-out'
            }} />
            {previewStats && r.previewDisplay && (
              <span className="meter-fill" style={{
                position: 'absolute', inset: 0, opacity: 0.25,
                background: 'var(--green)',
                clipPath: `inset(0 0 0 ${Math.min(100, (r.value / r.max) * 100)}%)`,
                width: `${Math.min(100, (r.value / r.max) * 100)}%`,
                transition: prefersReducedMotion() ? 'none' : 'clip-path 0.25s ease-out, width 0.25s ease-out'
              }} />
            )}
          </span>
          <meter
            aria-label={r.label}
            min={0} max={r.max} value={r.value}
            aria-valuetext={r.previewDisplay ? `${r.display} → ${r.previewDisplay}` : r.display}
            className="visually-hidden"
          >
            {r.display}
          </meter>
          <span className="meter-value mono">
            {r.previewDisplay ? `${r.display} → ${r.previewDisplay}` : r.display}
          </span>
        </div>
      ))}
    </div>
  );
}
