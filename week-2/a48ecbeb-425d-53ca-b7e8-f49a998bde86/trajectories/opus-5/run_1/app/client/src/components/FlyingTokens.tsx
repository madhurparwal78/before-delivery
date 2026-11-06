import { useEffect, useState, type ReactElement } from 'react';
import { subscribeFlights, type Flight } from '../state/flights.js';
import { CanThumbnail } from './CanThumbnail.js';

const DROP_MS = 420;
const RETURN_MS = 300;

interface LivePhase extends Flight {
  arrived: boolean;
}

/**
 * The flying can tokens of Crate Drop: a token lifts off its flavour card, grows
 * a little and flies along an arc into its slot, or flies back when the server
 * refuses the reservation.
 */
export function FlyingTokens(): ReactElement {
  const [flights, setFlights] = useState<LivePhase[]>([]);

  useEffect(
    () =>
      subscribeFlights((flight) => {
        setFlights((current) => [...current, { ...flight, arrived: false }]);
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            setFlights((current) =>
              current.map((item) => (item.id === flight.id ? { ...item, arrived: true } : item)),
            ),
          ),
        );
        window.setTimeout(
          () => setFlights((current) => current.filter((item) => item.id !== flight.id)),
          flight.mode === 'drop' ? DROP_MS + 80 : RETURN_MS + 80,
        );
      }),
    [],
  );

  return (
    <div className="flights" aria-hidden="true">
      {flights.map((flight) => {
        const target = flight.arrived ? flight.to : flight.from;
        const lift = flight.arrived ? 1 : 1.08;
        const arc = flight.arrived ? 0 : -Math.min(90, Math.abs(flight.to.y - flight.from.y) * 0.4 + 28);
        return (
          <span
            key={flight.id}
            className="flights__token"
            style={{
              width: flight.from.width,
              height: flight.from.height,
              transform: `translate3d(${target.x}px, ${target.y + arc}px, 0) scale(${lift})`,
              transitionDuration: `${flight.mode === 'drop' ? DROP_MS : RETURN_MS}ms`,
              transitionTimingFunction:
                flight.mode === 'drop'
                  ? 'cubic-bezier(0.22, 0.9, 0.24, 1)'
                  : 'cubic-bezier(0.4, 0, 0.6, 1)',
            }}
          >
            <CanThumbnail flavour={flight.flavour} />
          </span>
        );
      })}
    </div>
  );
}
