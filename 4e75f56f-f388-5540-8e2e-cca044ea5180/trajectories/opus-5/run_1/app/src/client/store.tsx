import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  BenchesResponse,
  ContentResponse,
  HoldResponse,
  MeResponse,
  Reservation,
} from '../shared/api.js';
import { tierName, type Tier } from '../shared/benches.js';
import {
  BILLING_OFFLINE,
  DEPOSITS_CLOSED_LINE,
  benchUpdates,
  confirmationHeading,
  groupConfirmationHeading,
} from '../shared/copy.js';
import { ApiFailure, api, idempotencyKey, statusOf } from './api.js';

const POLL_MS = 1_500;

export type NoticeKind = 'none' | 'message' | 'pending' | 'confirmed' | 'billing';

export interface Notice {
  readonly kind: NoticeKind;
  readonly text: string;
  readonly heading: string | null;
}

const QUIET: Notice = { kind: 'none', text: '', heading: null };

function sticky(notice: Notice): boolean {
  return notice.kind === 'pending' || notice.kind === 'confirmed' || notice.kind === 'billing';
}

interface HoldClock {
  readonly seconds: number;
  readonly duration: number;
  readonly at: number;
}

export interface LabStore {
  readonly benches: BenchesResponse | null;
  readonly me: MeResponse | null;
  readonly content: ContentResponse | null;
  readonly contentFailed: boolean;
  readonly tier: Tier;
  readonly selection: readonly string[];
  readonly pendingBenches: readonly string[] | null;
  readonly holdReservations: readonly Reservation[];
  readonly holdSecondsRemaining: number;
  readonly holdDuration: number;
  readonly holdExpiredLocally: boolean;
  readonly notice: Notice;
  readonly holdEndedBench: string | null;
  readonly activeBench: string | null;
  readonly signInWanted: boolean;
  readonly billingOffline: boolean;
  readonly setTier: (tier: Tier) => void;
  readonly toggleSelection: (bench: string) => void;
  readonly clearSelection: () => void;
  readonly announce: (text: string) => void;
  readonly holdBenches: (benches: readonly string[]) => Promise<void>;
  readonly releaseHold: () => Promise<void>;
  readonly pay: (kind: 'deposit' | 'full', billingName: string) => Promise<boolean>;
  readonly payGroup: (
    billingName: string,
    assignments: readonly { bench: string; name: string; email: string }[],
  ) => Promise<boolean>;
  readonly joinWaitlist: (tier: Tier) => Promise<void>;
  readonly acceptOffer: (offerId: string) => Promise<void>;
  readonly declineOffer: (offerId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly dismissHoldEnded: () => void;
  readonly openSignIn: () => void;
  readonly closeSignIn: () => void;
  readonly signedIn: (me: MeResponse) => void;
  readonly signOut: () => Promise<void>;
  readonly clearNotice: () => void;
}

const LabContext = createContext<LabStore | null>(null);

export function useLab(): LabStore {
  const store = useContext(LabContext);
  if (store === null) throw new Error('the lab store is not mounted');
  return store;
}

export function LabProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [benches, setBenches] = useState<BenchesResponse | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [contentFailed, setContentFailed] = useState(false);
  const [tier, setTier] = useState<Tier>('bench');
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [pendingBenches, setPendingBenches] = useState<readonly string[] | null>(null);
  const [notice, setNotice] = useState<Notice>(QUIET);
  const [holdEndedBench, setHoldEndedBench] = useState<string | null>(null);
  const [activeBench, setActiveBench] = useState<string | null>(null);
  const [signInWanted, setSignInWanted] = useState(false);
  const [billingOffline, setBillingOffline] = useState(false);
  const [clock, setClock] = useState<HoldClock | null>(null);
  const [, setTick] = useState(0);

  const paymentSent = useRef(false);
  const wantedBenches = useRef<readonly string[] | null>(null);
  const lastHold = useRef<{ id: string; bench: string } | null>(null);
  const noticeRef = useRef<Notice>(QUIET);
  noticeRef.current = notice;

  const holdReservations = useMemo(
    () => (me === null ? [] : me.reservations.filter((seat) => seat.state === 'held')),
    [me],
  );

  const setNoticeIfAllowed = useCallback((next: Notice, background: boolean) => {
    if (background && sticky(noticeRef.current)) return;
    noticeRef.current = next;
    setNotice(next);
  }, []);

  const readClock = useCallback((reservations: readonly Reservation[]) => {
    const held = reservations.find((seat) => seat.hold !== null);
    if (held?.hold === undefined || held.hold === null) {
      setClock(null);
      return;
    }
    setClock({
      seconds: held.hold.seconds_remaining,
      duration: held.hold.duration_seconds,
      at: performance.now(),
    });
  }, []);

  const loadBenches = useCallback(async () => {
    const next = await api<BenchesResponse>('/api/benches');
    setBenches(next);
    return next;
  }, []);

  const loadMe = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const next = await api<MeResponse>('/api/me');
      setMe(next);
      readClock(next.reservations);
      return next;
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        setMe(null);
        setClock(null);
        return null;
      }
      throw error;
    }
  }, [readClock]);

  const refresh = useCallback(async () => {
    const [next] = await Promise.all([loadBenches(), loadMe()]);
    void next;
  }, [loadBenches, loadMe]);

  useEffect(() => {
    void api<ContentResponse>('/api/content')
      .then((next) => setContent(next))
      .catch(() => setContentFailed(true));
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const previous = lastHold.current;
        const nextBenches = await loadBenches().catch(() => null);
        const nextMe = await loadMe().catch(() => null);
        if (nextBenches !== null && nextMe !== null) {
          const stillHeld = nextMe.reservations.some((seat) => seat.state === 'held');
          if (previous !== null && !stillHeld && !paymentSent.current) {
            const released = await api<{ reservation: Reservation }>(
              `/api/reservations/${previous.id}`,
            ).catch(() => null);
            if (released !== null && released.reservation.state === 'released') {
              lastHold.current = null;
              setActiveBench(null);
              setHoldEndedBench(previous.bench);
              setNoticeIfAllowed(
                {
                  kind: 'message',
                  text: benchUpdates.holdEnded(previous.bench, nextBenches.seats_remaining),
                  heading: null,
                },
                false,
              );
            }
          }
          const paid = nextMe.reservations.find(
            (seat) =>
              previous !== null && seat.id === previous.id && seat.state !== 'held',
          );
          if (
            paid !== undefined &&
            noticeRef.current.kind === 'pending' &&
            paid.payment_pending === null
          ) {
            setNoticeIfAllowed(
              {
                kind: 'confirmed',
                text: benchUpdates.paid(paid.bench, nextBenches.seats_remaining),
                heading: confirmationHeading(paid.bench),
              },
              false,
            );
          }
        }
      })();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadBenches, loadMe, setNoticeIfAllowed]);

  useEffect(() => {
    const held = holdReservations[0];
    if (held !== undefined) {
      lastHold.current = { id: held.id, bench: held.bench };
    }
  }, [holdReservations]);

  useEffect(() => {
    if (clock === null) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [clock]);

  const holdSecondsRemaining =
    clock === null ? 0 : Math.max(0, clock.seconds - (performance.now() - clock.at) / 1000);
  const holdDuration = clock?.duration ?? 0;
  const holdExpiredLocally =
    clock !== null && holdSecondsRemaining <= 0 && holdReservations.length > 0;

  const announce = useCallback(
    (text: string) => setNoticeIfAllowed({ kind: 'message', text, heading: null }, false),
    [setNoticeIfAllowed],
  );

  const holdBenches = useCallback(
    async (wanted: readonly string[]) => {
      if (wanted.length === 0) return;
      if (me === null) {
        wantedBenches.current = wanted;
        setSignInWanted(true);
        return;
      }
      paymentSent.current = false;
      setHoldEndedBench(null);
      setPendingBenches(wanted);
      setNoticeIfAllowed(
        {
          kind: 'message',
          text:
            wanted.length === 1
              ? benchUpdates.pendingHold(wanted[0] as string)
              : benchUpdates.pendingGroupHold(wanted.length),
          heading: null,
        },
        false,
      );
      try {
        const result = await api<HoldResponse>('/api/holds', { body: { benches: wanted } });
        setPendingBenches(null);
        setSelection([]);
        setActiveBench(result.reservations[0]?.bench ?? null);
        await refresh();
        setNoticeIfAllowed(
          {
            kind: 'message',
            text:
              result.reservations.length === 1
                ? benchUpdates.holdPlaced(
                    result.reservations[0]?.bench as string,
                    result.seats_remaining,
                  )
                : benchUpdates.groupHoldPlaced(result.reservations.length, result.seats_remaining),
            heading: null,
          },
          false,
        );
      } catch (error) {
        setPendingBenches(null);
        const next = await loadBenches().catch(() => benches);
        const remaining = next?.seats_remaining ?? 0;
        if (error instanceof ApiFailure) {
          if (error.code === 'bench_taken') {
            announce(benchUpdates.benchTaken(wanted[0] as string, remaining));
            return;
          }
          if (error.code === 'atelier_sold_out') {
            announce(benchUpdates.atelierSoldOut(remaining));
            return;
          }
          announce(error.body.message);
          return;
        }
        throw error;
      }
    },
    [announce, benches, loadBenches, me, refresh, setNoticeIfAllowed],
  );

  const releaseHold = useCallback(async () => {
    const held = holdReservations[0];
    if (held === undefined) {
      setSelection([]);
      return;
    }
    const groupId = held.group_id;
    try {
      const result =
        groupId === null
          ? await api<{ seats_remaining: number }>(`/api/reservations/${held.id}/release`, {
              method: 'POST',
            })
          : await api<{ seats_remaining: number }>(`/api/groups/${groupId}/release`, {
              method: 'POST',
            });
      lastHold.current = null;
      setActiveBench(null);
      await refresh();
      announce(benchUpdates.released(held.bench, result.seats_remaining));
    } catch (error) {
      await refresh();
      if (error instanceof ApiFailure) {
        announce(error.body.message);
        return;
      }
      throw error;
    }
  }, [announce, holdReservations, refresh]);

  const pay = useCallback(
    async (kind: 'deposit' | 'full', billingName: string): Promise<boolean> => {
      const held = holdReservations[0];
      if (held === undefined) return false;
      paymentSent.current = true;
      try {
        const result = await api<{ reservation: Reservation }>(
          `/api/reservations/${held.id}/${kind}`,
          { body: { billing_name: billingName }, idempotencyKey: idempotencyKey(kind) },
        );
        const status = statusOf(result);
        const next = await loadBenches().catch(() => benches);
        await loadMe().catch(() => null);
        if (status === 202) {
          setNoticeIfAllowed(
            { kind: 'pending', text: benchUpdates.paymentPending(held.bench), heading: null },
            false,
          );
          return true;
        }
        setBillingOffline(false);
        setNoticeIfAllowed(
          {
            kind: 'confirmed',
            text: benchUpdates.paid(held.bench, next?.seats_remaining ?? 0),
            heading: confirmationHeading(held.bench),
          },
          false,
        );
        return true;
      } catch (error) {
        if (error instanceof ApiFailure) {
          if (error.code === 'billing_unavailable') {
            setBillingOffline(true);
            setNoticeIfAllowed({ kind: 'billing', text: BILLING_OFFLINE, heading: null }, false);
            return false;
          }
          if (error.code === 'deposits_closed') {
            announce(DEPOSITS_CLOSED_LINE);
            await refresh();
            return false;
          }
          announce(error.body.message);
          return false;
        }
        throw error;
      }
    },
    [announce, benches, holdReservations, loadBenches, loadMe, refresh, setNoticeIfAllowed],
  );

  const payGroup = useCallback(
    async (
      billingName: string,
      assignments: readonly { bench: string; name: string; email: string }[],
    ): Promise<boolean> => {
      const groupId = holdReservations[0]?.group_id ?? null;
      if (groupId === null) return false;
      const count = holdReservations.length;
      paymentSent.current = true;
      try {
        const result = await api<{ group: { reservations: Reservation[] } }>(
          `/api/groups/${groupId}/checkout`,
          {
            body: { billing_name: billingName, assignments },
            idempotencyKey: idempotencyKey('group'),
          },
        );
        const status = statusOf(result);
        const next = await loadBenches().catch(() => benches);
        await loadMe().catch(() => null);
        if (status === 202) {
          setNoticeIfAllowed(
            { kind: 'pending', text: benchUpdates.groupPaymentPending(count), heading: null },
            false,
          );
          return true;
        }
        setBillingOffline(false);
        setNoticeIfAllowed(
          {
            kind: 'confirmed',
            text: benchUpdates.groupPaid(count, next?.seats_remaining ?? 0),
            heading: groupConfirmationHeading(count),
          },
          false,
        );
        return true;
      } catch (error) {
        if (error instanceof ApiFailure) {
          if (error.code === 'billing_unavailable') {
            setBillingOffline(true);
            setNoticeIfAllowed({ kind: 'billing', text: BILLING_OFFLINE, heading: null }, false);
            return false;
          }
          announce(error.body.message);
          return false;
        }
        throw error;
      }
    },
    [announce, benches, holdReservations, loadBenches, loadMe, setNoticeIfAllowed],
  );

  const joinWaitlist = useCallback(
    async (wanted: Tier) => {
      if (me === null) {
        setSignInWanted(true);
        return;
      }
      try {
        const result = await api<{ tier: Tier; position: number }>('/api/waitlist', {
          body: { tier: wanted },
        });
        await refresh();
        announce(benchUpdates.waitlistJoined(tierName(result.tier), result.position));
      } catch (error) {
        if (error instanceof ApiFailure) {
          announce(error.body.message);
          return;
        }
        throw error;
      }
    },
    [announce, me, refresh],
  );

  const acceptOffer = useCallback(
    async (offerId: string) => {
      try {
        const result = await api<HoldResponse>(`/api/offers/${offerId}/accept`, {
          method: 'POST',
        });
        paymentSent.current = false;
        setHoldEndedBench(null);
        setActiveBench(result.reservations[0]?.bench ?? null);
        await refresh();
        announce(
          benchUpdates.holdPlaced(
            result.reservations[0]?.bench as string,
            result.seats_remaining,
          ),
        );
      } catch (error) {
        if (error instanceof ApiFailure) {
          announce(error.body.message);
          await refresh();
          return;
        }
        throw error;
      }
    },
    [announce, refresh],
  );

  const declineOffer = useCallback(
    async (offerId: string) => {
      await api(`/api/offers/${offerId}/decline`, { method: 'POST' });
      await refresh();
    },
    [refresh],
  );

  const signedIn = useCallback(
    (next: MeResponse) => {
      setMe(next);
      setSignInWanted(false);
      const wanted = wantedBenches.current;
      wantedBenches.current = null;
      void refresh();
      if (wanted !== null) void holdBenches(wanted);
    },
    [holdBenches, refresh],
  );

  const signOut = useCallback(async () => {
    await api('/api/auth/signout', { method: 'POST' });
    setMe(null);
    setClock(null);
    await refresh();
  }, [refresh]);

  const store: LabStore = {
    benches,
    me,
    content,
    contentFailed,
    tier,
    selection,
    pendingBenches,
    holdReservations,
    holdSecondsRemaining,
    holdDuration,
    holdExpiredLocally,
    notice,
    holdEndedBench,
    activeBench,
    signInWanted,
    billingOffline,
    setTier,
    toggleSelection: (bench) =>
      setSelection((current) =>
        current.includes(bench)
          ? current.filter((label) => label !== bench)
          : current.length >= 6
            ? current
            : [...current, bench],
      ),
    clearSelection: () => setSelection([]),
    announce,
    holdBenches,
    releaseHold,
    pay,
    payGroup,
    joinWaitlist,
    acceptOffer,
    declineOffer,
    refresh,
    dismissHoldEnded: () => setHoldEndedBench(null),
    openSignIn: () => setSignInWanted(true),
    closeSignIn: () => {
      wantedBenches.current = null;
      setSignInWanted(false);
    },
    signedIn,
    signOut,
    clearNotice: () => setNoticeIfAllowed(QUIET, false),
  };

  return <LabContext.Provider value={store}>{children}</LabContext.Provider>;
}
