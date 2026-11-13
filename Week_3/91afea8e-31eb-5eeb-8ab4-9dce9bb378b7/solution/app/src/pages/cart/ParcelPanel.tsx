import { Truck } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { promiseText, rupees } from "../../../shared/format";
import { useReducedMotion } from "../../lib/hooks";
import type { Parcel } from "../../lib/types";
import { fieldMessage, useCartActions } from "./actions";
import { toneOf, type Group } from "./groups";
import { LineCard } from "./LineCard";

const SLIDE_MS = 600;

interface StripProps {
  parcel: Parcel;
}

/** The parcel's promise and fee on the marquee line; it slides in from the right whenever either changes, and stands still under reduced motion. */
function ParcelStrip({ parcel }: StripProps): ReactNode {
  const strip = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const shown = useRef<string | null>(null);
  const signature = `${parcel.promise_date ?? ""}|${parcel.delivery_fee_paise}|${parcel.cod_fee_paise}`;

  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = signature;
    if (before === null || before === signature || reduced) return;
    strip.current?.animate([{ transform: "translateX(105%)" }, { transform: "translateX(0)" }], { duration: SLIDE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }, [signature, reduced]);

  return (
    <div className="marquee-line">
      <div className="marquee-line__strip" ref={strip}>
        <Truck size={28} aria-hidden="true" />
        <span className="bill">{parcel.promise_date ? `arrives by ${promiseText(parcel.promise_date)}` : "no delivery date"}</span>
        <span className="bill">
          delivery <span className="amount">{rupees(parcel.delivery_fee_paise)}</span>
        </span>
        {parcel.cod_fee_paise > 0 && (
          <span className="bill">
            cash on delivery fee <span className="amount">{rupees(parcel.cod_fee_paise)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

interface SpeedProps {
  group: Group;
  parcel: Parcel;
}

function SpeedChoice({ group, parcel }: SpeedProps): ReactNode {
  const actions = useCartActions();
  const [speed, setSpeed] = useState(parcel.speed);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSpeed(parcel.speed), [parcel.speed]);

  const choose = async (next: Parcel["speed"]): Promise<void> => {
    setSpeed(next);
    setError(null);
    try {
      await actions.setSpeed(group.sellerId, next);
    } catch (failure) {
      setError(fieldMessage(failure));
      setSpeed(parcel.speed);
    }
  };

  return (
    <div className="card card--black speed">
      <div role="radiogroup" aria-label={`Delivery speed for ${group.sellerName}`} className="speed__options">
        <label className="choice">
          <input type="radio" name={`speed-${group.sellerId}`} checked={speed === "standard"} onChange={() => void choose("standard")} />
          Standard
        </label>
        <label className="choice">
          <input type="radio" name={`speed-${group.sellerId}`} checked={speed === "one_day"} onChange={() => void choose("one_day")} />
          One day
        </label>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

interface PanelProps {
  group: Group;
  index: number;
  serverTime: string;
  pincode: string | null;
  /** Whether the destination pincode is served at all; null while it is being looked up. */
  pincodeServed: boolean | null;
  onLeave: (lineId: string) => void;
  onLeaveFailed: () => void;
}

export function ParcelPanel({ group, index, serverTime, pincode, pincodeServed, onLeave, onLeaveFailed }: PanelProps): ReactNode {
  const tone = toneOf(index);
  const parcel = group.parcel;
  const note =
    parcel && parcel.serviceable === false && pincode
      ? pincodeServed === false
        ? `We don't deliver to ${pincode} yet.`
        : pincodeServed
          ? `${group.sellerName} doesn't deliver to ${pincode}.`
          : null
      : null;

  return (
    <section aria-label={`${group.sellerName} parcel`} className={`panel panel--${tone} parcel parcel--${index % 4}`}>
      <h2 className="parcel__seller">{group.sellerName}</h2>
      {parcel ? (
        <ParcelStrip parcel={parcel} />
      ) : (
        <p className="parcel__idle">Select an item from this seller to get a delivery date.</p>
      )}
      {note && <p className="parcel__note">{note}</p>}
      <ul className="parcel__lines">
        {group.lines.map((line) => (
          <LineCard key={line.line_id} line={line} serverTime={serverTime} cardClass={tone === "black" ? "" : "card--black"} onLeave={onLeave} onLeaveFailed={onLeaveFailed} />
        ))}
      </ul>
      {parcel && <SpeedChoice group={group} parcel={parcel} />}
    </section>
  );
}
