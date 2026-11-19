import { PillLink, EmptyCard } from '../components/ui';
import { ERROR_COPY } from '../../../shared/errors';

/** A screen whose role is not allowed: one tinted card with the forbidden copy. */
export function Forbidden() {
  return (
    <div className="solo-card">
      <EmptyCard title={ERROR_COPY.forbidden} tone="rose">
        <PillLink to="/today" variant="blue">
          Back to today
        </PillLink>
      </EmptyCard>
    </div>
  );
}

/** Unknown routes, unknown records and records outside the caller's clinic. */
export function NotFound() {
  return (
    <div className="solo-card">
      <EmptyCard title="We couldn't find that page." tone="sky">
        <PillLink to="/today">Back to today</PillLink>
      </EmptyCard>
    </div>
  );
}
