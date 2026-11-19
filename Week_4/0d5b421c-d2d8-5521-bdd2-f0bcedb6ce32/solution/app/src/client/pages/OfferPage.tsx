import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookingReceipt, FloorResponse, OfferResponse, PlanResponse } from "../../shared/api.js";
import { formatDayLabel, guestsLabel } from "../../shared/calendar.js";
import { formatEuros } from "../../shared/euros.js";
import { get, post } from "../api.js";
import { useAnnouncer } from "../announce.js";
import { FloorPlan } from "../components/FloorPlan.js";
import { geometryFor } from "../components/geometry.js";
import { CountdownRing } from "../components/HeldMarks.js";
import { OneSentence, Page } from "../components/Shell.js";
import { DEAD_OFFER, OFFER_ENDED, PAYMENT_FAILED } from "../copy.js";
import { navigate } from "../router.js";
import { formatMinutesSeconds, secondsLeft } from "../serverClock.js";
import { useFloor, useRules } from "../reference.js";
import { guestRooms } from "./planItems.js";

type View = { kind: "loading" } | { kind: "dead" } | { kind: "ended" } | { kind: "ready"; offer: OfferResponse };

function useSecondsLeft(expiresAt: string | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((count) => count + 1), 250);
    return () => window.clearInterval(timer);
  }, []);
  return expiresAt === null ? 0 : secondsLeft(expiresAt);
}

export function OfferPage({ token }: { token: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const floor: FloorResponse | null = useFloor();
  const rules = useRules();
  const { messages, announce } = useAnnouncer(1);

  useEffect(() => {
    void get<OfferResponse>(`/api/offers/${token}`).then((outcome) => {
      if (outcome.ok) setView({ kind: "ready", offer: outcome.body });
      else setView(outcome.failure.code === "offer_expired" ? { kind: "ended" } : { kind: "dead" });
    });
  }, [token]);

  const offer = view.kind === "ready" ? view.offer : null;
  useEffect(() => {
    if (offer === null) return;
    void get<PlanResponse>(`/api/plan?date=${offer.date}&time=${offer.time}&party=${offer.party_size}`).then(
      (outcome) => outcome.ok && setPlan(outcome.body),
    );
  }, [offer]);

  const left = useSecondsLeft(offer?.expires_at ?? null);
  const ended = view.kind === "ended" || (offer !== null && left === 0);
  useEffect(() => {
    if (ended) announce(OFFER_ENDED);
  }, [ended, announce]);

  const claim = useCallback(async (): Promise<void> => {
    if (claiming) return;
    setClaiming(true);
    setProblem(null);
    const outcome = await post<BookingReceipt>(`/api/offers/${token}/claim`, {}, { keyed: true });
    setClaiming(false);
    if (outcome.ok) {
      navigate(new URL(outcome.body.manage_url).pathname);
      return;
    }
    const { code } = outcome.failure;
    if (code === "offer_expired") setView({ kind: "ended" });
    else if (code === "offer_claimed") setView({ kind: "dead" });
    else if (code === "payment_failed") {
      setProblem(PAYMENT_FAILED);
      announce(PAYMENT_FAILED);
    }
  }, [claiming, token, announce]);

  const rooms = useMemo(() => {
    if (floor === null || plan === null || offer === null) return [];
    const geometry = (id: string) => geometryFor(floor.rooms.flatMap((room) => room.tables).find((table) => table.table_id === id)?.max_seats ?? 2);
    return guestRooms(floor, plan, { targetId: offer.table_id, partySize: offer.party_size }, (id, isHeld) =>
      isHeld && rules !== null && !ended
        ? { ring: <CountdownRing geometry={geometry(id)} expiresAt={offer.expires_at} lifetimeSeconds={rules.offer_seconds} label="Offer time remaining" /> }
        : {},
    );
  }, [floor, plan, offer, rules, ended]);

  if (view.kind === "loading") return <OneSentence>Loading your offer...</OneSentence>;
  if (view.kind === "dead") return <OneSentence>{DEAD_OFFER}</OneSentence>;
  if (view.kind === "ended" || offer === null) return <OneSentence>{OFFER_ENDED}</OneSentence>;

  return (
    <Page
      summary={`Table ${offer.table_id} · ${formatDayLabel(offer.date)} · ${offer.time} · ${guestsLabel(offer.party_size)}`}
      summaryLevel="p"
      live={{ label: "Booking updates", messages }}
    >
      <div className="offer-layout">
        <div className="stack">
          <h1 className="heading-large">A table is yours to claim</h1>
          <p>
            Table {offer.table_id}, {offer.room}
          </p>
          {ended ? (
            <p className="notice">{OFFER_ENDED}</p>
          ) : (
            <p className="notice">Offer ends in {formatMinutesSeconds(left)}</p>
          )}
          {offer.deposit_cents > 0 && <p>Claiming charges a deposit of €{formatEuros(offer.deposit_cents)}.</p>}
          {problem !== null && <p className="notice">{problem}</p>}
          <div className="actions">
            <button type="button" className="button button-lime" disabled={ended} aria-disabled={claiming} onClick={() => void claim()}>
              {claiming ? "Claiming..." : "Claim table"}
            </button>
          </div>
        </div>
        <section aria-labelledby="offer-plan">
          <h2 id="offer-plan" className="visually-hidden">
            Floor plan
          </h2>
          <FloorPlan label="Tables" rooms={rooms} firstStop={null} onChoose={() => undefined} focusRequest={null} />
        </section>
      </div>
    </Page>
  );
}
