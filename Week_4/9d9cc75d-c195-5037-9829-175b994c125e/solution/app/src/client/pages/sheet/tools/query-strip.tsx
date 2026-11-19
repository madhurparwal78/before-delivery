import { QUERY_ORDER } from './query-order.ts';

/** The published query order as plump chips; the step the formula lands at (1-based) deepens to bubblegum. */
export function QueryStrip({ landed }: { landed: number | null }) {
  return (
    <ol className="query-strip" aria-label="Query order">
      {QUERY_ORDER.map((step, index) => (
        <li
          key={step}
          className="query-chip"
          data-landed={landed === index + 1 ? 'true' : undefined}
          aria-current={landed === index + 1 ? 'step' : undefined}
        >
          {step}
        </li>
      ))}
    </ol>
  );
}
