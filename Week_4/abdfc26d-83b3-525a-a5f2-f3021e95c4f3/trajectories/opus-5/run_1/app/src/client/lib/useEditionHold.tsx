import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditionEntry, EditionsResponse, Order } from '../../shared/api.js';
import { checkoutStatus } from '../../shared/copy.js';
import { api, ApiFailure, createKeyHolder } from './api.js';
import { useInterval } from './hooks.js';
import { signInTo, useRouter } from './router.js';
import { useSession } from './session.js';
import { CheckoutSheet } from '../components/CheckoutSheet.js';

const EDITION_REFRESH_MS = 5000;
const SERVER_RESYNC_MS = 30000;

export interface EditionHold {
  readonly edition: number | null;
  readonly editions: readonly EditionEntry[];
  readonly locked: boolean;
  readonly message: string | null;
  setEdition(edition: number): void;
  claim(edition: number): void;
  readonly sheet: JSX.Element | null;
  readonly lensRef: React.RefObject<HTMLDivElement>;
}

/**
 * Owns one piece's lens selection, its server-timed hold and its checkout
 * sheet, including the hold announcements and the one-winner recovery.
 */
export function useEditionHold(slug: string | null, editionCount: number): EditionHold {
  const session = useSession();
  const { search, setQuery } = useRouter();
  const lensRef = useRef<HTMLDivElement>(null);

  const urlEdition = useMemo(() => {
    const raw = new URLSearchParams(search).get('edition');
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }, [search]);

  const [edition, setEditionState] = useState<number | null>(urlEdition);
  const [editions, setEditions] = useState<readonly EditionEntry[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);

  const payKey = useRef(createKeyHolder());
  const announced = useRef(new Set<number>());

  const loadEditions = useCallback(async () => {
    if (!slug) return;
    try {
      const response = await api.get<EditionsResponse>(`/api/pieces/${slug}/editions`);
      setEditions(response.editions);
    } catch {
      // The lens keeps its last known statuses while a refresh fails.
    }
  }, [slug]);

  useEffect(() => {
    void loadEditions();
  }, [loadEditions]);
  useInterval(() => void loadEditions(), slug ? EDITION_REFRESH_MS : null);

  // Reloading a held piece page locks the lens and reopens the sheet with the
  // server's remaining time.
  const loadCurrentOrder = useCallback(async () => {
    if (!slug || !session.isCollector) return;
    try {
      const current = await api.get<Order>(`/api/orders/current?piece=${slug}`);
      announced.current = new Set<number>([current.seconds_left ?? 0]);
      setOrder(current);
      setEditionState(current.edition);
      setSecondsLeft(current.seconds_left ?? 0);
      setSheetOpen(true);
    } catch {
      // No open order for this piece.
    }
  }, [slug, session.isCollector]);

  useEffect(() => {
    void loadCurrentOrder();
  }, [loadCurrentOrder]);

  const setEdition = useCallback(
    (next: number) => {
      setEditionState(next);
      setQuery('edition', String(next));
    },
    [setQuery],
  );

  const refreshOrder = useCallback(async () => {
    if (!order) return;
    try {
      const fresh = await api.get<Order>(`/api/orders/${order.id}`);
      setOrder(fresh);
      if (fresh.seconds_left !== null) setSecondsLeft(fresh.seconds_left);
      return fresh;
    } catch {
      return undefined;
    }
  }, [order]);

  // The countdown ticks every second and resyncs from the server every 30.
  const held = order?.state === 'held';
  useInterval(() => {
    if (!held) return;
    setSecondsLeft((value) => Math.max(0, value - 1));
  }, held ? 1000 : null);
  useInterval(() => void refreshOrder(), held ? SERVER_RESYNC_MS : null);

  // Announcements at each whole minute remaining and at 30 seconds.
  useEffect(() => {
    if (!held || !order) return;
    if (secondsLeft <= 0) {
      if (!announced.current.has(0)) {
        announced.current.add(0);
        setMessage(checkoutStatus.holdExpired(order.edition));
        setSheetOpen(false);
        setOrder(null);
        void loadEditions();
      }
      return;
    }
    if (secondsLeft === 30 && !announced.current.has(30)) {
      announced.current.add(30);
      setMessage(checkoutStatus.thirtySecondsLeft(order.edition));
      return;
    }
    if (secondsLeft % 60 === 0) {
      const minutes = secondsLeft / 60;
      if (!announced.current.has(secondsLeft)) {
        announced.current.add(secondsLeft);
        setMessage(checkoutStatus.minutesLeft(minutes, order.edition));
      }
    }
  }, [secondsLeft, held, order, loadEditions]);

  // While an order is paying, watch for Kill Bill's answer.
  const settling = order?.state === 'paying';
  useInterval(
    () => {
      void refreshOrder().then((fresh) => {
        if (!fresh) return;
        if (fresh.state === 'failed') {
          setMessage(checkoutStatus.paymentFailed(fresh.edition));
          setOrder(null);
          setSheetOpen(false);
          void loadEditions();
          return;
        }
        if (['paid', 'invoiced', 'receipted'].includes(fresh.state)) {
          setMessage(
            fresh.invoice_status === 'ready'
              ? checkoutStatus.confirmed(fresh.edition, fresh.edition_count)
              : checkoutStatus.invoicePending(fresh.invoice_number ?? ''),
          );
          void loadEditions();
        }
      });
    },
    settling ? 2000 : null,
  );

  // A paid order whose invoice is still rendering keeps reporting until ready.
  const awaitingInvoice =
    order !== null &&
    ['paid', 'invoiced'].includes(order.state) &&
    order.invoice_status !== 'ready';
  useInterval(
    () => {
      void refreshOrder().then((fresh) => {
        if (fresh && fresh.invoice_status === 'ready') {
          setMessage(checkoutStatus.confirmed(fresh.edition, fresh.edition_count));
        }
      });
    },
    awaitingInvoice ? 5000 : null,
  );

  const claim = useCallback(
    (requested: number) => {
      if (!slug) return;

      if (!session.user) {
        signInTo(`/pieces/${slug}?edition=${requested}`);
        return;
      }
      if (!session.isCollector) {
        setMessage('Only collector accounts can hold editions.');
        return;
      }

      // The hold already granted just reopens the sheet.
      if (order && order.edition === requested && order.state === 'held') {
        setSheetOpen(true);
        return;
      }

      void (async () => {
        try {
          const response = await api.post<{ order: Order }>(
            `/api/pieces/${slug}/editions/${requested}/holds`,
            { idempotencyKey: crypto.randomUUID() },
          );
          announced.current = new Set<number>([response.order.seconds_left ?? 0]);
          setOrder(response.order);
          setEditionState(response.order.edition);
          setQuery('edition', String(response.order.edition));
          setSecondsLeft(response.order.seconds_left ?? 0);
          setSheetOpen(true);
          setMessage(
            checkoutStatus.holdGranted(
              response.order.edition,
              response.order.edition_count,
              response.order.seconds_left ?? 0,
            ),
          );
          void loadEditions();
        } catch (error) {
          if (!(error instanceof ApiFailure)) return;
          if (error.code === 'edition_taken') {
            const nextFree = error.detail.next_free ?? null;
            if (typeof nextFree === 'number') {
              setMessage(checkoutStatus.editionTaken(requested, nextFree));
              setEdition(nextFree);
            } else {
              setMessage(checkoutStatus.runSoldOut);
            }
            void loadEditions();
            return;
          }
          if (error.code === 'own_piece') {
            setMessage('You cannot collect your own piece.');
            return;
          }
          setMessage(error.message);
        }
      })();
    },
    [slug, session.user, session.isCollector, order, setQuery, setEdition, loadEditions],
  );

  const pay = useCallback(
    (values: { billingName: string; email: string; billingCountry: string }) => {
      if (!order) return;
      setPaying(true);
      setFieldErrors({});
      void (async () => {
        let status: number | null = null;
        try {
          const updated = await api.post<Order>(`/api/orders/${order.id}/buy`, {
            idempotencyKey: payKey.current.next(),
            body: {
              billing_name: values.billingName,
              email: values.email,
              billing_country: values.billingCountry,
            },
          });
          setOrder(updated);
          setMessage(checkoutStatus.paying);
        } catch (error) {
          if (error instanceof ApiFailure) {
            status = error.status;
            if (error.status === 422) {
              setFieldErrors(error.fields);
            } else if (error.code === 'payments_unavailable') {
              setMessage(checkoutStatus.paymentsOffline);
            } else if (error.code === 'hold_expired') {
              setMessage(checkoutStatus.holdExpired(order.edition));
              setSheetOpen(false);
              setOrder(null);
            } else {
              setMessage(error.message);
            }
          }
        } finally {
          payKey.current.reuseAfterFailure(status);
          setPaying(false);
        }
      })();
    },
    [order],
  );

  const release = useCallback(() => {
    if (!order) return;
    void (async () => {
      try {
        await api.delete(`/api/orders/${order.id}/hold`);
      } catch {
        // The hold was already gone.
      }
      setOrder(null);
      setSheetOpen(false);
      void loadEditions();
      lensRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
    })();
  }, [order, loadEditions]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    lensRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
  }, []);

  const sheet =
    order && sheetOpen ? (
      <CheckoutSheet
        open
        order={order}
        secondsLeft={secondsLeft}
        paying={paying}
        fieldErrors={fieldErrors}
        defaultEmail={session.user?.email ?? ''}
        defaultName={session.user?.display_name ?? ''}
        returnFocusTo={lensRef}
        onClose={closeSheet}
        onRelease={release}
        onPay={pay}
      />
    ) : null;

  const resolvedEdition =
    edition === null
      ? editionCount > 0
        ? Math.min(14, editionCount)
        : null
      : Math.min(Math.max(1, edition), Math.max(1, editionCount));

  return {
    edition: resolvedEdition,
    editions,
    locked: order !== null && order.state !== 'expired' && order.state !== 'failed',
    message,
    setEdition,
    claim,
    sheet,
    lensRef,
  };
}
