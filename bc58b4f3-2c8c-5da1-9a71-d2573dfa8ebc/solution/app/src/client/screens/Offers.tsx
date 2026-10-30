import { useCallback, useMemo, useState } from "react";
import { NetworkError, api } from "../api";
import { EmptyNote, LoadingRows } from "../components/EmptyNote";
import { SeatLane } from "../components/SeatLane";
import { Status, type StatusMessage, quiet } from "../components/Status";
import { coveredCount, languageName, settingName } from "../labels";
import { usePolling } from "../poll";
import { type SeamChange, laneLabel, laneSnapshot, useHatchSeam } from "../seam";
import { formatRange } from "../../shared/time";
import type { Assignment, User } from "../types";

const CLAIM_ERRORS: Record<string, string> = {
  seat_taken: "Seat already taken",
  already_holding: "You already hold a seat on this request.",
  calendar_conflict: "This overlaps a seat you already hold.",
};



export function Offers({ user }: { user: User }) {
  const [offers, setOffers] = useState<Assignment[] | null>(null);
  const [won, setWon] = useState<Map<string, Assignment>>(new Map());
  const [pending, setPending] = useState<string | null>(null);
  const [lost, setLost] = useState<Map<string, { seat: number; text: string }>>(new Map());
  const [message, setMessage] = useState<StatusMessage>(quiet);

  const load = useCallback(async () => {
    const result = await api<{ offers: Assignment[] }>("GET", "/api/offers");
    if (result.ok) setOffers(result.data.offers);
  }, []);
  usePolling(load, [load]);

  // A claimed card stays (showing its seat filling) until the Hatch Seam settles, then it moves to My seats.
  const cards = useMemo(() => {
    if (!offers) return null;
    const listed = offers.map((offer) => won.get(offer.number) ?? offer);
    const kept = [...won.values()].filter((card) => !offers.some((offer) => offer.number === card.number));
    return [...listed, ...kept].sort((a, b) => a.start_at.localeCompare(b.start_at));
  }, [offers, won]);

  const snapshot = useMemo(() => (cards ? laneSnapshot(cards) : null), [cards]);
  const seam = useHatchSeam(snapshot, user.id, (changes: SeamChange[]) => {
    const settled = new Set(changes.map((c) => c.group));
    setWon((current) => new Map([...current].filter(([number]) => !settled.has(number))));
  });

  const claim = async (number: string, seat: number) => {
    const key = `${number}#${seat}`;
    setPending(key);
    setMessage({ tone: "neutral", text: "Claiming…" });
    setLost((current) => new Map([...current].filter(([n]) => n !== number)));
    try {
      const result = await api<Assignment>("POST", `/api/assignments/${number}/seats/${seat}/claim`, { json: {} });
      if (result.ok) {
        setWon((current) => new Map(current).set(number, result.data));
        setMessage({ tone: "success", text: `Seat ${seat} on ${number} is yours. Details are in My seats.` });
      } else {
        const text = CLAIM_ERRORS[result.error.code] ?? "This seat can no longer be claimed.";
        setLost((current) => new Map(current).set(number, { seat, text }));
        setMessage({ tone: "error", text });
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage({ tone: "error", text: "Couldn't reach Teamseat. Try again." });
    }
    setPending(null);
  };

  return (
    <section className="panel offers" aria-labelledby="offers-heading">
      <div className="list-head">
        <h2 id="offers-heading">Open seats</h2>
        <p className="muted">Seats in your languages. The address and patient details appear once a seat is yours.</p>
      </div>
      <Status name="Claim status" message={message} />
      <ul className="cards" aria-label="Open seats">
        {(cards ?? []).map((card) => {
          const loss = lost.get(card.number);
          return (
            <li key={card.number} className="card">
              <div className="card-head">
                <h3>{languageName(card.language)}</h3>
                <span className="num muted">{card.number}</span>
              </div>
              <p className="card-summary">
                {settingName(card.setting)} · {card.city}
                <br />
                <span className="num">{formatRange(card.start_at, card.end_at)}</span>
              </p>
              <div className="card-seats">
                {card.seats.map((seat) => {
                  const key = `${card.number}#${seat.seat}`;
                  const actual = { held: seat.status !== "open", label: laneLabel(seat) };
                  return (
                    <div key={key} className="seat-line">
                      <SeatLane seat={seat.seat} shown={seam.lane(key, actual)} fillRef={seam.fillRef(key)} />
                      {seat.status === "open" && !won.has(card.number) ? (
                        <button
                          type="button"
                          className="button button-primary"
                          aria-label={`Claim seat ${seat.seat} on ${card.number}`}
                          disabled={pending === key}
                          onClick={() => void claim(card.number, seat.seat)}
                        >
                          Claim seat {seat.seat}
                        </button>
                      ) : null}
                      {loss?.seat === seat.seat ? <span className="loss-copy">{loss.text}</span> : null}
                    </div>
                  );
                })}
              </div>
              <p className="covered-count num">{`${seam.covered(card.number, coveredCount(card.seats))} of ${card.seats.length} covered`}</p>
            </li>
          );
        })}
      </ul>
      {cards === null ? <LoadingRows /> : null}
      {cards?.length === 0 ? <EmptyNote>No open seats in your languages right now. New offers appear here and by email.</EmptyNote> : null}
    </section>
  );
}
