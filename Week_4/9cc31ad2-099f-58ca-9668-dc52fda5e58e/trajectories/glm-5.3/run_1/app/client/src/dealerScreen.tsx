// The dealer: the six cars as ruled cells.
import { useEffect, useState, type JSX } from 'react';
import { api, ApiError, type CatalogCar } from './api';
import { useApp } from './appState';
import { navigate } from './ui';
import { upgradeKey } from './purchaseFlow';
import { fmtCoins } from './formats';

export default function DealerScreen(): JSX.Element {
  const { garage, refreshGarage } = useApp();
  const [cars, setCars] = useState<CatalogCar[]>([]);
  const [dialog, setDialog] = useState<CatalogCar | null>(null);
  const [phase, setPhase] = useState<'buy' | 'pending' | 'insufficient' | 'unconfirmed'>('buy');
  const [shortfall, setShortfall] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    void api.cars().then(c => setCars(c.cars));
  }, []);

  const attempt = async (car: CatalogCar, key: string, rawBody: string): Promise<void> => {
    setPhase('pending');
    try {
      const out = await api.buyCar(car.carId, key);
      await refreshGarage();
      setDialog(null);
      setPhase('buy');
      setAnnouncement(`${car.name} added to your garage. Balance: ${fmtCoins(out.balance)} coins.`);
      document.querySelector(`[data-car="${car.carId}"]`)?.scrollIntoView();
      (document.querySelector(`[data-car="${car.carId}"]`) as HTMLElement | null)?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        const g = await api.garage();
        setShortfall(car.price ?? 0 - g.balance);
        setPhase('insufficient');
        return;
      }
      if (err instanceof ApiError) {
        setDialog(null);
        await refreshGarage();
        setAnnouncement('Garage refreshed from the server.');
        return;
      }
      setPhase('unconfirmed');
    }
  };

  const owned = (carId: string): boolean => (garage?.cars ?? []).some(c => c.carId === carId);

  return (
    <main className="page" style={{ paddingTop: 20 }}>
      <h1>Dealer</h1>
      <div className="status" role="status" aria-live="polite" aria-label="Garage updates">{announcement}</div>
      <div className="rule-grid" style={{ marginTop: 16 }}>
        {cars.map(c => (
          <div key={c.carId} className="rule-cell" data-car={c.carId} tabIndex={-1}>
            <h3>{c.name}</h3>
            <div className="mono">class {c.class} · PI {c.pi}</div>
            <div className="mono">
              accel {c.stats.accelMps2} m/s² · brake {c.stats.brakeMps2} m/s² · top {c.stats.topMps} m/s · grip {c.stats.gripPct}% · {c.stats.laneChangeSteps} steps
            </div>
            {owned(c.carId) ? (
              <p><strong>Owned</strong></p>
            ) : c.starter ? (
              <p>Starter only</p>
            ) : (
              <button className="btn" onClick={() => { setDialog(c); setPhase('buy'); }}>
                Buy {c.name} for {fmtCoins(c.price ?? 0)} coins
              </button>
            )}
          </div>
        ))}
      </div>
      {dialog && (
        <div className="dialog-backdrop">
          <div role="dialog" aria-modal="true" aria-label="Confirm car purchase" className="dialog">
            <h2>Confirm car purchase</h2>
            <p>
              <strong>{dialog.name}</strong> for <span className="mono">{fmtCoins(dialog.price ?? 0)} coins</span>.
            </p>
            {phase === 'insufficient' && (
              <div>
                <h3 className="loss">Not enough coins</h3>
                <p>You need <span className="mono">{fmtCoins(shortfall)}</span> more coins.</p>
              </div>
            )}
            {phase === 'unconfirmed' && (
              <p>We couldn't confirm the purchase. Nothing changes here until it is confirmed.</p>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              {phase === 'unconfirmed' ? (
                <button className="btn btn-primary" onClick={() => void attempt(dialog, upgradeKey(), JSON.stringify({ carId: dialog.carId }))}>Check again</button>
              ) : (
                <button className="btn btn-primary" disabled={phase === 'pending' || phase === 'insufficient'}
                        onClick={() => void attempt(dialog, upgradeKey(), JSON.stringify({ carId: dialog.carId }))}>
                  {phase === 'pending' ? 'Buying…' : `Buy for ${fmtCoins(dialog.price ?? 0)} coins`}
                </button>
              )}
              <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
