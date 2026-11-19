import { useEffect, useState } from 'react';
import { CARS, type CarSpec } from '../../shared/catalogue.js';
import { formatMeter, formatThousands, type Units } from '../../shared/format.js';
import { apiPostRaw, newIdempotencyKey } from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { Page } from '../components/Page.js';
import { carAnnouncement, copy, shortfallCopy } from '../copy.js';
import { balance, refreshGarage, useGarage, useLatestBalance, useMe } from '../store.js';

type Phase = 'buy' | 'pending' | 'unconfirmed' | 'insufficient';

interface CarDialogState {
  instance: number;
  carId: string;
  name: string;
  price: number;
  phase: Phase;
  key: string | null;
  bytes: string;
}

export function Dealer() {
  const garage = useGarage();
  const { me } = useMe();
  const latestBalance = useLatestBalance();
  const units: Units = me?.units ?? 'kmh';
  const [dialog, setDialog] = useState<CarDialogState | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    void refreshGarage();
  }, []);

  // On opening, focus goes to Buy, or to Cancel in the not-enough-coins state.
  useEffect(() => {
    if (dialog === null) return;
    const target = dialog.phase === 'insufficient' ? 'car-cancel' : 'car-confirm';
    document.getElementById(target)?.focus();
  }, [dialog?.instance]);

  useEffect(() => {
    if (dialog === null) return;
    if (dialog.phase === 'pending' || dialog.phase === 'unconfirmed') return;
    if (latestBalance < dialog.price && dialog.phase !== 'insufficient') {
      setDialog({ ...dialog, phase: 'insufficient' });
    } else if (latestBalance >= dialog.price && dialog.phase === 'insufficient') {
      setDialog({ ...dialog, phase: 'buy' });
    }
  }, [latestBalance, dialog]);

  const owned = new Set(garage?.cars.map((car) => car.carId) ?? []);

  const send = async (state: CarDialogState, key: string) => {
    setDialog({ ...state, phase: 'pending', key });
    const result = await apiPostRaw<{ carId: string; balance: number }>(
      '/v1/garage/cars',
      state.bytes,
      { 'content-type': 'application/json', 'Idempotency-Key': key },
    );
    if (result.kind === 'unconfirmed') {
      setDialog({ ...state, phase: 'unconfirmed', key });
      return;
    }
    if (result.kind === 'ok') {
      setDialog(null);
      balance.learn(result.data.balance);
      balance.release();
      await refreshGarage();
      setAnnouncement(carAnnouncement(state.name, result.data.balance));
      window.setTimeout(() => document.getElementById(`car-${state.carId}`)?.focus(), 0);
      return;
    }
    if (result.status === 402) {
      balance.release();
      await refreshGarage();
      setDialog({ ...state, phase: 'insufficient', key: null });
      window.setTimeout(() => document.getElementById('car-cancel')?.focus(), 0);
      return;
    }
    setDialog(null);
    balance.release();
    const fresh = await refreshGarage();
    setAnnouncement(copy.garageRefreshed);
    const target = fresh?.cars.some((car) => car.carId === state.carId)
      ? `car-${state.carId}`
      : `buy-${state.carId}`;
    window.setTimeout(() => document.getElementById(target)?.focus(), 0);
  };

  const close = async (state: CarDialogState) => {
    setDialog(null);
    if (state.phase !== 'unconfirmed') {
      document.getElementById(`buy-${state.carId}`)?.focus();
      return;
    }
    balance.release();
    const fresh = await refreshGarage();
    setAnnouncement(copy.garageRefreshed);
    const target = fresh?.cars.some((car) => car.carId === state.carId)
      ? `car-${state.carId}`
      : `buy-${state.carId}`;
    window.setTimeout(() => document.getElementById(target)?.focus(), 0);
  };

  const cell = (car: CarSpec) => (
    <div className="cell" key={car.carId} id={`car-${car.carId}`} tabIndex={-1}>
      <h3>{car.name}</h3>
      <p>
        class {car.class} · <span className="mono">PI {car.pi}</span>
      </p>
      <ul>
        <li className="mono">{formatMeter('accel', car.stats.accelMps2, units)}</li>
        <li className="mono">{formatMeter('brake', car.stats.brakeMps2, units)}</li>
        <li className="mono">{formatMeter('top', car.stats.topMps, units)}</li>
        <li className="mono">{formatMeter('grip', car.stats.gripPct, units)}</li>
        <li className="mono">{formatMeter('lane', car.stats.laneChangeSteps, units)}</li>
      </ul>
      {owned.has(car.carId) ? (
        <p>Owned</p>
      ) : car.price === null ? (
        <p>Starter only</p>
      ) : (
        <>
          <p className="mono">{formatThousands(car.price)} coins</p>
          <button
            type="button"
            className="primary"
            id={`buy-${car.carId}`}
            onClick={() =>
              setDialog({
                instance: Date.now(),
                carId: car.carId,
                name: car.name,
                price: car.price!,
                phase: balance.getLatest() >= car.price! ? 'buy' : 'insufficient',
                key: null,
                bytes: JSON.stringify({ carId: car.carId }),
              })
            }
          >
            Buy {car.name} for {formatThousands(car.price)} coins
          </button>
        </>
      )}
    </div>
  );

  return (
    <Page gutter={['Cars', 'Prices']}>
      <h1>Dealer</h1>
      <div className="dealer-grid">{CARS.map(cell)}</div>
      <div className="cell" role="status" aria-label="Garage updates">
        {announcement}
      </div>
      {dialog !== null && (
        <Dialog label="Confirm car purchase" onEscape={() => void close(dialog)}>
          <h2>Confirm car purchase</h2>
          <p>
            {dialog.name} · <span className="mono">{formatThousands(dialog.price)} coins</span>
          </p>
          {dialog.phase === 'insufficient' && (
            <>
              <h3>{copy.notEnoughHeading}</h3>
              <p>{shortfallCopy(dialog.price - latestBalance)}</p>
            </>
          )}
          {dialog.phase === 'unconfirmed' && <p>{copy.unconfirmed}</p>}
          <div className="dialog-actions">
            {dialog.phase === 'unconfirmed' ? (
              <button
                type="button"
                className="primary"
                id="car-confirm"
                onClick={() => void send(dialog, dialog.key!)}
              >
                Check again
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                id="car-confirm"
                disabled={dialog.phase === 'pending' || dialog.phase === 'insufficient'}
                onClick={() => {
                  balance.hold();
                  void send(dialog, newIdempotencyKey());
                }}
              >
                {dialog.phase === 'pending'
                  ? copy.buying
                  : `Buy for ${formatThousands(dialog.price)} coins`}
              </button>
            )}
            <button
              type="button"
              className="secondary"
              id="car-cancel"
              onClick={() => void close(dialog)}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </Page>
  );
}
