// The purchase flow's shared rules: keys, the dialog, the sweep controller.
import { useEffect, useRef, useState, type JSX } from 'react';
import { api, type GarageCar } from './api';
import { Dialog } from './ui';
import { fmtCoins, fmtDelta, fmtTime } from './formats';
import { LAYOUTS, SYSTEM_NAMES, UPGRADE_PRICES, upgradePrice, type SystemId, type LayoutId } from '../../shared/domain';
import { prefersReducedMotion } from './ui';

let keyCounter = 0;

/** Each new purchase attempt generates a new idempotency key. */
export function upgradeKey(): string {
  keyCounter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `k_${Date.now().toString(36)}_${keyCounter}_${rand}`;
}

export type PurchasePhase = 'buy' | 'pending' | 'unconfirmed' | 'insufficient';

export function UpgradeDialog({ car, system, stage, layoutId, phase, shortfall, balance,
                                onCancel, onBuy, onCheckAgain }: {
  car: GarageCar;
  system: SystemId;
  stage: number;
  layoutId: string;
  phase: PurchasePhase;
  shortfall: number;
  balance: number;
  onCancel: () => void;
  onBuy: (key: string, rawBody: string) => void;
  onCheckAgain: (key: string, rawBody: string) => void;
}): JSX.Element {
  const price = upgradePrice(car.class as 'D' | 'C' | 'B', stage);
  const newPi = piAfter(car, system, stage);
  const overLimit = newPi > (car.class === 'D' ? 299 : car.class === 'C' ? 499 : 699);
  const rawBody = JSON.stringify({ stage, layoutId });
  const attemptRef = useRef<{ key: string; rawBody: string } | null>(null);

  if (attemptRef.current === null) attemptRef.current = { key: upgradeKey(), rawBody };

  const confirm = (): void => {
    if (attemptRef.current) {
      onBuy(attemptRef.current.key, attemptRef.current.rawBody);
    }
  };

  const checkAgain = (): void => {
    if (attemptRef.current) {
      onCheckAgain(attemptRef.current.key, attemptRef.current.rawBody);
    }
  };

  const initialFocus = phase === 'insufficient' ? 'last' : 'first';

  return (
    <Dialog title="Confirm upgrade" onClose={onCancel} initialFocus={phase === 'insufficient' ? 'last' : 'first'}>
      <h2>Confirm upgrade</h2>
      <p>
        <strong>{SYSTEM_NAMES[system]}</strong> to stage {stage} for{' '}
        <span className="mono">{fmtCoins(price)} coins</span>.
      </p>
      {overLimit && (
        <p className="notice" style={{ padding: '8px 12px' }}>
          This upgrade takes PI to {newPi}, over the class {car.class} limit of{' '}
          {car.class === 'D' ? 299 : car.class === 'C' ? 499 : 699}. The car can no longer enter class {car.class} events.
        </p>
      )}
      {phase === 'insufficient' && (
        <div>
          <h3 className="loss">Not enough coins</h3>
          <p>You need <span className="mono">{fmtCoins(shortfall)}</span> more coins.</p>
        </div>
      )}
      {phase === 'unconfirmed' && (
        <p>We couldn't confirm the purchase. Nothing changes here until it is confirmed.</p>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {phase === 'unconfirmed' ? (
          <button className="btn btn-primary" onClick={checkAgain}>Check again</button>
        ) : (
          <button className="btn btn-primary" disabled={phase === 'pending' || phase === 'insufficient'} onClick={confirm}>
            {phase === 'pending' ? 'Buying…' : `Buy for ${fmtCoins(price)} coins`}
          </button>
        )}
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
      {initialFocus === 'last' && phase === 'insufficient' && <span className="visually-hidden" />}
    </Dialog>
  );
}

function piAfter(car: GarageCar, system: SystemId, stage: number): number {
  const effects: Record<SystemId, number> = { engine: 20, tires: 15, brakes: 10, suspension: 5 };
  return car.pi + effects[system];
}

/**
 * The Reference lap sweep: the signature motion. Plays in the published order
 * and timing, or jumps to its end state under reduced motion or interruption.
 */
export class SweepController {
  private cancelled = false;
  private timers: number[] = [];
  private resolve: (() => void) | null = null;
  private appliedHeld = false;

  constructor(
    private readonly purchaseId: string,
    private readonly newBalance: number,
    private readonly applyHeldPushes: (atStep4: boolean) => void,
    private readonly announce: (text: string) => void,
    private readonly announcementText: string
  ) {}

  /** Renders the sweep's end state at once, with no animation. */
  finishNow(): void {
    this.cancelled = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.applyEnd();
    this.resolve?.();
  }

  private applyEnd(): void {
    // The garage screen applies the committed result; this controller only
    // sequences the timing, the balance step and the purchase announcement.
    if (!this.appliedHeld) {
      this.appliedHeld = true;
      this.applyHeldPushes(true);
      this.announce(this.announcementText);
    }
    window.dispatchEvent(new CustomEvent('kerb-sweep-end', { detail: { purchaseId: this.purchaseId } }));
  }


  private wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      const t = window.setTimeout(() => {
        if (!this.cancelled) resolve();
      }, ms);
      this.timers.push(t);
    });
  }

  async play(): Promise<void> {
    if (prefersReducedMotion()) {
      this.applyEnd();
      return;
    }
    // Step 1-3: the marker runs the outline over 1.2s, chips flip at thirds.
    window.dispatchEvent(new CustomEvent('kerb-sweep-start', {
      detail: { purchaseId: this.purchaseId }
    }));
    await this.wait(400);
    if (this.cancelled) return;
    window.dispatchEvent(new CustomEvent('kerb-sweep-chip', { detail: { index: 0 } }));
    await this.wait(400);
    if (this.cancelled) return;
    window.dispatchEvent(new CustomEvent('kerb-sweep-chip', { detail: { index: 1 } }));
    await this.wait(400);
    if (this.cancelled) return;
    // Step 4: balance and predicted lap count to their new values, then hold pushes apply.
    window.dispatchEvent(new CustomEvent('kerb-sweep-chip', { detail: { index: 2 } }));
    await this.wait(250);
    if (this.cancelled) return;
    this.applyEnd();
    window.dispatchEvent(new CustomEvent('kerb-sweep-balance', {
      detail: { balance: this.newBalance }
    }));
    await this.wait(500);
  }
}
