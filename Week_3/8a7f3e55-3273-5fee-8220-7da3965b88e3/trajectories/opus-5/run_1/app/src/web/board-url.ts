import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate, useLocationHref } from './hooks.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface BoardAddress {
  date: string;
  bookingId: string | null;
  cameFromHistory: boolean;
}

function addressFor(date: string, bookingId: string | null): string {
  const params = new URLSearchParams({ date });
  if (bookingId !== null) params.set('booking', bookingId);
  return `/?${params.toString()}`;
}

/**
 * The coverage board's agency-local day and selected booking live in the address, so reload,
 * Back and Forward restore them while the periodic refresh never touches it.
 */
export function useBoardAddress(today: string): {
  address: BoardAddress;
  goToDay: (date: string) => void;
  select: (bookingId: string | null) => void;
  selectOnDay: (date: string, bookingId: string) => void;
  consumeHistoryFlag: () => void;
} {
  const href = useLocationHref();
  const [fromHistory, setFromHistory] = useState(false);

  useEffect(() => {
    const onPop = (): void => setFromHistory(true);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const params = new URLSearchParams(href.includes('?') ? href.slice(href.indexOf('?')) : '');
  const rawDate = params.get('date');
  const rawBooking = params.get('booking');
  const date = rawDate !== null && DATE_PATTERN.test(rawDate) ? rawDate : today;

  useEffect(() => {
    if (rawDate === null || !DATE_PATTERN.test(rawDate)) {
      navigate(addressFor(today, rawBooking), 'replace');
    }
  }, [rawDate, rawBooking, today]);


  const goToDay = useCallback((next: string) => {
    navigate(addressFor(next, null), 'push');
  }, []);
  const select = useCallback(
    (bookingId: string | null) => {
      navigate(addressFor(date, bookingId), 'replace');
    },
    [date],
  );
  const selectOnDay = useCallback(
    (day: string, bookingId: string) => {
      navigate(addressFor(day, bookingId), day === date ? 'replace' : 'push');
    },
    [date],
  );
  const consumeHistoryFlag = useCallback(() => setFromHistory(false), []);

  return useMemo(
    () => ({
      address: { date, bookingId: rawBooking, cameFromHistory: fromHistory },
      goToDay,
      select,
      selectOnDay,
      consumeHistoryFlag,
    }),
    [date, rawBooking, fromHistory, goToDay, select, selectOnDay, consumeHistoryFlag],
  );
}
