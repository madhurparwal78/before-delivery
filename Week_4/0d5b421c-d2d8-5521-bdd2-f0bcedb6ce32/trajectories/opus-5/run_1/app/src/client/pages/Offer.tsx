import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  ConfirmResponse,
  FloorResponse,
  OfferResponse,
  PlanResponse,
  RulesResponse,
} from '../../shared/types';
import { FloorPlan, type PlanOption } from '../components/FloorPlan';
import { LiveRegion, OutageBanners, PinnedTitle } from '../components/Shell';
import { ApiFailure, apiGet, apiPost } from '../lib/api';
import { COPY, bookingSummaryLine, countdownText, euros } from '../lib/format';
import { useCountdown, useOutage, useReducedMotion } from '../lib/hooks';

export function Offer(): JSX.Element {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const outage = useOutage();
  const reducedMotion = useReducedMotion();
  const [offer, setOffer] = useState<OfferResponse | null>(null);
  const [floor, setFloor] = useState<FloorResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [dead, setDead] = useState(false);
  const [ended, setEnded] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await apiGet<OfferResponse>(`/api/offers/${token}`);
      setOffer(response);
      setPlan(
        await apiGet<PlanResponse>(
          `/api/plan?date=${response.date}&time=${response.time}&party=${response.party_size}`,
        ),
      );
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'offer_expired') {
        setEnded(true);
        setAnnouncement(COPY.offerEnded);
        return;
      }
      setDead(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
    void apiGet<FloorResponse>('/api/floor')
      .then(setFloor)
      .catch(() => undefined);
    void apiGet<RulesResponse>('/api/rules')
      .then(setRules)
      .catch(() => undefined);
  }, [load]);

  const offerSeconds = rules?.offer_seconds ?? 900;
  const countdown = useCountdown(offer ? offer.expires_at : null, offerSeconds, reducedMotion);

  useEffect(() => {
    if (offer && countdown.msLeft <= 0 && !ended) {
      setEnded(true);
      setAnnouncement(COPY.offerEnded);
    }
  }, [countdown.msLeft, ended, offer]);

  const claim = async (): Promise<void> => {
    setClaiming(true);
    try {
      const result = await apiPost<ConfirmResponse>(
        `/api/offers/${token}/claim`,
        {},
        `claim-${token}`,
      );
      navigate(new URL(result.manage_url).pathname);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === 'offer_expired') {
        setEnded(true);
        setAnnouncement(COPY.offerEnded);
      } else if (failure.code === 'offer_claimed') {
        setDead(true);
      } else if (failure.status === 503) {
        outage.reportOutage(failure.code);
      } else if (failure.code === 'payment_failed') {
        setAnnouncement(COPY.paymentFailed);
      }
    } finally {
      setClaiming(false);
    }
  };

  if (dead) {
    return (
      <div className="page">
        <OutageBanners />
        <PinnedTitle>{COPY.deadOfferLink}</PinnedTitle>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="page">
        <OutageBanners />
        <PinnedTitle>{ended ? COPY.offerEnded : COPY.planLoading}</PinnedTitle>
        <LiveRegion label="Booking updates" message={announcement} />
      </div>
    );
  }

  const options: PlanOption[] =
    floor && plan
      ? floor.rooms.flatMap((room) =>
          room.tables.flatMap((table) => {
            const planTable = plan.tables.find((entry) => entry.table_id === table.table_id);
            if (!planTable) return [];
            const offered = offer.table_id === table.table_id;
            const statusText = offered
              ? 'Held by you'
              : planTable.status === 'fits'
                ? 'Fits your party'
                : planTable.status === 'taken'
                  ? 'Taken'
                  : 'Not for your party';
            return [
              {
                unitId: table.table_id,
                roomId: room.room_id,
                tableIds: [table.table_id],
                accessibleName: `Table ${table.table_id}, ${room.name}, ${table.min_seats} to ${table.max_seats} seats, ${statusText}`,
                statusText,
                variant: offered
                  ? ('held' as const)
                  : planTable.status === 'fits'
                    ? ('fits' as const)
                    : planTable.status === 'taken'
                      ? ('taken' as const)
                      : ('muted' as const),
                maxSeats: table.max_seats,
                settings: offered ? offer.party_size : 0,
                ring: null,
              },
            ];
          }),
        )
      : [];

  return (
    <div className="page offer">
      <OutageBanners />
      <PinnedTitle heading={false}>
        {`${bookingSummaryLine(offer.date, offer.time, offer.party_size)} · Table ${offer.table_id}, ${offer.room}`}
      </PinnedTitle>
      <LiveRegion label="Booking updates" message={announcement} />
      <div className="offer-grid">
        <section className="offer-column">
          <h1 className="heading">{COPY.offerHeading}</h1>
          <p>{`Table ${offer.table_id}, ${offer.room}`}</p>
          <div className="hold-status">
            <span
              role="progressbar"
              aria-label="Offer time remaining"
              aria-valuemin={0}
              aria-valuemax={offerSeconds}
              aria-valuenow={countdown.secondsLeft}
              className={`ring${reducedMotion ? ' ring--stepped' : ''}`}
              style={{
                ['--ring-fraction' as string]: `${countdown.fraction * 360}deg`,
              }}
            />
            <span className="tabular">{`Offer ends in ${countdownText(countdown.msLeft)}`}</span>
          </div>
          <p>
            {offer.deposit_cents > 0
              ? `Claiming charges a deposit of €${euros(offer.deposit_cents)}.`
              : 'No deposit'}
          </p>
          <button
            type="button"
            className="button button--accent"
            disabled={claiming || ended}
            onClick={() => void claim()}
          >
            {claiming ? 'Claiming...' : 'Claim table'}
          </button>
          {ended ? <p className="notice">{COPY.offerEnded}</p> : null}
        </section>
        <section className="region region--plan" aria-label="Floor plan">
          {floor && plan ? (
            <FloorPlan
              floor={floor}
              label="Tables"
              options={options}
              reducedMotion={reducedMotion}
              onActivate={() => undefined}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
