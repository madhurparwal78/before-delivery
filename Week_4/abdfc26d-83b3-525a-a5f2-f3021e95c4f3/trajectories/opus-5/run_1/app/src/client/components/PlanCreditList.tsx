import { useEffect, useState } from 'react';
import type { CreditPackPurchase, CreditsResponse, PlanResponse } from '../../shared/api.js';
import { planStatus } from '../../shared/copy.js';
import { CREDIT_PACK, PLANS, planByCode, type PlanCode } from '../../shared/plans.js';
import { formatUsd } from '../../shared/money.js';
import { api, ApiFailure, createKeyHolder } from '../lib/api.js';
import { useInterval, useLoader } from '../lib/hooks.js';
import { useSession } from '../lib/session.js';
import { StatusRegion } from './StatusRegion.js';

/** Rows divided by one-pixel borders, each with a title, note, price and action. */
export function PlanCreditList({ compact = false }: { compact?: boolean }): JSX.Element {
  const session = useSession();
  const plan = useLoader(
    () => (session.isCreator ? api.get<PlanResponse>('/api/me/plan') : Promise.resolve({ plan: null })),
    [session.isCreator],
  );
  const credits = useLoader(
    () =>
      session.isCreator
        ? api.get<CreditsResponse>('/api/me/credits')
        : Promise.resolve({ available: 0, held: 0, entries: [] }),
    [session.isCreator],
  );

  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [packId, setPackId] = useState<string | null>(null);
  const [packKey] = useState(() => createKeyHolder());

  const current = plan.data?.plan ?? null;
  const awaitingPlan = current?.state === 'pending_payment';

  useEffect(() => {
    if (!current) return;
    if (current.state === 'pending_payment') setMessage(planStatus.pending);
    else if (current.state === 'active') {
      setMessage(planStatus.active(planByCode(current.code).name));
    } else if (current.state === 'cancelling' && current.ends_on) {
      setMessage(planStatus.cancelled(current.ends_on));
    }
  }, [current?.state, current?.ends_on, current?.code, current]);

  useInterval(
    () => {
      plan.refresh();
      credits.refresh();
    },
    awaitingPlan ? 2000 : null,
  );

  useInterval(
    () => {
      if (!packId) return;
      void api
        .get<CreditPackPurchase>(`/api/me/credit-packs/${packId}`)
        .then((purchase) => {
          if (purchase.state === 'paid') {
            setMessage(planStatus.packConfirmed);
            setPackId(null);
            credits.refresh();
          } else if (purchase.state === 'failed') {
            setMessage('That credit pack payment failed.');
            setPackId(null);
          }
        })
        .catch(() => undefined);
    },
    packId ? 2000 : null,
  );

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === 'plan_not_confirmed') setMessage(planStatus.cancelBeforeConfirmation);
        else setMessage(error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const choosePlan = (code: PlanCode): void => {
    void run(async () => {
      await api.post<PlanResponse>('/api/me/plan', { body: { plan: code } });
      setMessage(planStatus.pending);
      plan.refresh();
    });
  };

  const buyPack = (): void => {
    void run(async () => {
      let status: number | null = null;
      try {
        const response = await api.post<{ purchase: CreditPackPurchase }>('/api/me/credit-packs', {
          idempotencyKey: packKey.next(),
          body: { pack: CREDIT_PACK.code },
        });
        setPackId(response.purchase.id);
        setMessage(planStatus.pending);
      } catch (error) {
        if (error instanceof ApiFailure) status = error.status;
        throw error;
      } finally {
        packKey.reuseAfterFailure(status);
      }
    });
  };

  const cancelPlan = (): void => {
    void run(async () => {
      const response = await api.post<PlanResponse>('/api/me/plan/cancel');
      if (response.plan?.ends_on) setMessage(planStatus.cancelled(response.plan.ends_on));
      plan.refresh();
    });
  };

  return (
    <div className="plan-list">
      {!compact && (
        <div className="plan-list__balance tabular">
          <p>
            <span className="muted">Available credits</span>{' '}
            <strong>{credits.data?.available ?? 0}</strong>
          </p>
          <p>
            <span className="muted">Reserved</span> <strong>{credits.data?.held ?? 0}</strong>
          </p>
        </div>
      )}

      <ul className="plan-list__rows" aria-label="Plans and credits">
        {PLANS.map((plan) => (
          <li key={plan.code} className="plan-list__row">
            <div className="plan-list__text">
              <h3 className="plan-list__title display">{plan.name}</h3>
              <p className="plan-list__note muted">{plan.description}</p>
            </div>
            <p className="plan-list__price tabular">${formatUsd(plan.priceCents)}</p>
            <button
              type="button"
              className="ghost-button"
              disabled={busy || !session.isCreator || current !== null}
              onClick={() => choosePlan(plan.code)}
            >
              {plan.action}
            </button>
          </li>
        ))}

        <li className="plan-list__row">
          <div className="plan-list__text">
            <h3 className="plan-list__title display">Credit pack</h3>
            <p className="plan-list__note muted">{CREDIT_PACK.note}</p>
          </div>
          <p className="plan-list__price tabular">${formatUsd(CREDIT_PACK.priceCents)}</p>
          <button
            type="button"
            className="ghost-button"
            disabled={busy || !session.isCreator}
            onClick={buyPack}
          >
            {CREDIT_PACK.action}
          </button>
        </li>

        {current && (current.state === 'active' || current.state === 'pending_payment') && (
          <li className="plan-list__row">
            <div className="plan-list__text">
              <h3 className="plan-list__title display">Your plan</h3>
              <p className="plan-list__note muted">
                {planByCode(current.code).name} · {current.state.replace('_', ' ')}
              </p>
            </div>
            <p className="plan-list__price tabular">
              ${formatUsd(planByCode(current.code).priceCents)}
            </p>
            <button type="button" className="ghost-button" disabled={busy} onClick={cancelPlan}>
              Cancel plan
            </button>
          </li>
        )}
      </ul>

      <StatusRegion label="Plan status" message={message} />
    </div>
  );
}
