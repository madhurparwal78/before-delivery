import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BadgeCheck, CalendarClock, CircleDashed, FileSignature, Truck } from 'lucide-react';
import { formatMoney } from '../../shared/money';
import { deliveryStatusWord } from '../../shared/labels';
import type { DeliveryStatus } from '../../shared/types';
import { animateValue, SPEED } from '../lib/motion';

/** A money figure that rolls to its new value and always settles on the exact amount. */
export function RollingMoney({ cents, className }: { cents: number; className?: string }): ReactNode {
  const [shown, setShown] = useState(cents);
  const previous = useRef(cents);

  useEffect(() => {
    if (previous.current === cents) return;
    const stop = animateValue(previous.current, cents, SPEED.medium, (value) => setShown(Math.round(value)));
    previous.current = cents;
    return stop;
  }, [cents]);

  return <span className={className ?? 'figure'}>{formatMoney(shown === cents ? cents : shown)}</span>;
}

const ICONS: Record<DeliveryStatus, typeof Truck> = {
  no_instrument: CircleDashed,
  awaiting_agreement: FileSignature,
  scheduled: CalendarClock,
  delivered: Truck,
  owned: BadgeCheck,
};

export function DeliveryStatusCell({ status, count }: { status: DeliveryStatus; count?: number }): ReactNode {
  const Icon = ICONS[status];
  const word = deliveryStatusWord(status);
  return (
    <span className="status-cell">
      <Icon size={18} aria-hidden="true" focusable="false" />
      <span>{count === undefined ? word : `${word}: ${count}`}</span>
    </span>
  );
}
