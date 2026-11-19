// Packs: pack hour numerals, lots by expiry, pack cards with the buy dialog, and the hour ledger.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Flame } from "lucide-react";
import type { Balances, Booking, Me, Movement, MovementKind, Pack, Purchase } from "../../shared/api.ts";
import { hoursText, money, quartersText, siteDateTime } from "../../shared/format.ts";
import { hoursToQuarters } from "../../shared/rules.ts";
import { api, errorCopy, newKey } from "../api.ts";
import { reloadsPaused } from "../session.ts";
import { useSites } from "../useSites.ts";
import { ActionButton, Dialog, Numerals, Status, tint, useStatusRegion, type Say } from "../ui.tsx";

const MOVEMENT_LABELS: Record<MovementKind, string> = {
  opening_balance: "Opening balance",
  pack_purchase: "Pack purchase",
  booking_debit: "Booking",
  hold_release: "Hold released",
  cancel_refund: "Cancellation refund",
  forfeit: "Forfeit",
  usage: "Station time used",
  late_checkout: "Late check-out",
  pack_expiry: "Pack hours expired",
};

const REFRESH_MS = 60_000;

const BUY_ERRORS: Record<string, string> = {
  billing_unavailable: "Billing is unreachable right now. You have not been charged and no hours were added.",
  idempotency_in_progress: "Your payment is still being processed. Wait a moment.",
  idempotency_conflict: "This purchase was already used for a different pack. Close the dialog and try again.",
};

interface LedgerRow {
  movement: Movement;
  available: number;
  committed: number;
}

/** Running balances after each movement, newest first. */
function withRunningBalances(movements: Movement[]): LedgerRow[] {
  let available = 0;
  let committed = 0;
  const rows: LedgerRow[] = [];
  for (const movement of [...movements].reverse()) {
    for (const entry of movement.entries) {
      if (entry.account === "available") available += hoursToQuarters(entry.hours);
      if (entry.account === "committed") committed += hoursToQuarters(entry.hours);
    }
    rows.push({ movement, available, committed });
  }
  return rows.reverse();
}

function LotLine({ label, figures, near, hours }: { label: string; figures: ReactNode; near: boolean; hours: number }): ReactNode {
  const ref = useRef<HTMLLIElement>(null);
  const previous = useRef(hours);
  useLayoutEffect(() => {
    if (previous.current !== hours) tint(ref.current);
    previous.current = hours;
  }, [hours]);
  return (
    <li ref={ref} className={`lot${near ? " lot-near" : ""}`}>
      {near && (
        <span role="img" aria-label="Expiring soon" className="lot-marker">
          <span className="lot-notch" />
          <Flame aria-hidden="true" size={14} className="lot-flame" />
        </span>
      )}
      <span>
        {label}: {figures}
      </span>
    </li>
  );
}

export function Packs({ me }: { me: Me }): ReactNode {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [references, setReferences] = useState<Map<string, string>>(new Map());
  const [buying, setBuying] = useState<Pack | null>(null);
  const [status, say] = useStatusRegion();
  const sites = useSites();
  const homeZone = sites.find((s) => s.id === me.member?.home_site_id)?.time_zone ?? "UTC";
  const latestBalances = useRef(0);

  /** A ledger answer whose request started before the latest balance-carrying response is discarded. */
  const loadLedger = useCallback(async () => {
    const startedAfter = latestBalances.current;
    const ledger = await api<{ balances: Balances; movements: Movement[] }>("/api/me/ledger");
    if (!ledger.ok || startedAfter !== latestBalances.current) return;
    setBalances(ledger.data.balances);
    setMovements(ledger.data.movements);
    const unknown = ledger.data.movements.some((m) => m.booking_id !== null);
    if (unknown) {
      const bookings = await api<{ bookings: Booking[] }>("/api/bookings");
      if (bookings.ok) setReferences(new Map(bookings.data.bookings.map((b) => [b.id, b.reference])));
    }
  }, []);

  useEffect(() => {
    void loadLedger();
    void api<{ packs: Pack[] }>("/api/packs").then((result) => {
      if (result.ok) setPacks(result.data.packs);
    });
    const id = setInterval(() => {
      if (!reloadsPaused()) void loadLedger();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadLedger]);

  const rows = withRunningBalances(movements);

  return (
    <div className="screen packs">
      <h1 className="screen-title">Packs</h1>
      <Status name="Pack status" message={status} />
      <div className="packs-grid">
        <section className="packs-balances" aria-label="Pack hours">
          <div className="numerals">
            <p className="numeral-block">
              <span className="numeral-label">Available pack hours</span> <span className="numeral numeral-lg">{balances ? hoursText(balances.available_hours) : "—"}</span>
            </p>
            <p className="numeral-block">
              <span className="numeral-label">Committed pack hours</span> <span className="numeral numeral-lg">{balances ? hoursText(balances.committed_hours) : "—"}</span>
            </p>
          </div>
          <h2>Pack hours by expiry</h2>
          <ul role="list" aria-label="Pack hours by expiry" className="lots">
            {(balances?.lots ?? []).map((lot) => (
              <LotLine
                key={lot.purchase_id ?? "opening"}
                hours={lot.hours}
                near={lot.expiring_soon}
                label={lot.valid_through === null ? "Opening balance" : lot.pack_name}
                figures={
                  lot.valid_through === null ? (
                    <>
                      <span className="mono">{hoursText(lot.hours)} h</span>, no expiry
                    </>
                  ) : (
                    <>
                      <span className="mono">{hoursText(lot.hours)} h</span>, valid through <span className="mono">{lot.valid_through}</span>
                    </>
                  )
                }
              />
            ))}
          </ul>
        </section>
        <section className="pack-cards" aria-labelledby="pack-cards-title">
          <h2 id="pack-cards-title">Buy pack hours</h2>
          <div className="cards">
            {packs.map((pack) => (
              <article key={pack.id} className="pack-card">
                <h3>{pack.name}</h3>
                <p className="mono pack-hours">{hoursText(pack.hours)} h</p>
                <p className="mono pack-price">${money(pack.price_cents)}</p>
                <button type="button" className="button button-primary" aria-label={`Buy ${pack.name}`} onClick={() => setBuying(pack)}>
                  Buy {pack.name}
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
      <section className="ledger" aria-labelledby="ledger-title">
        <h2 id="ledger-title">Hour ledger</h2>
        <table role="table" aria-label="Hour ledger" className="table table-grid">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">When</th>
              <th role="columnheader" scope="col">Movement</th>
              <th role="columnheader" scope="col">Booking</th>
              <th role="columnheader" scope="col">By</th>
              <th role="columnheader" scope="col" className="num">Available</th>
              <th role="columnheader" scope="col" className="num">Committed</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map(({ movement, available, committed }) => (
              <tr role="row" key={movement.id}>
                <td role="cell" data-label="When" className="mono"><Numerals text={siteDateTime(movement.created_at, homeZone)} /></td>
                <td role="cell" data-label="Movement">{MOVEMENT_LABELS[movement.kind]}</td>
                <td role="cell" data-label="Booking" className="mono">{movement.booking_id ? (references.get(movement.booking_id) ?? "—") : "—"}</td>
                <td role="cell" data-label="By">{movement.actor?.name ?? "Pilotlight"}</td>
                <td role="cell" data-label="Available" className="mono num">{quartersText(available)}</td>
                <td role="cell" data-label="Committed" className="mono num">{quartersText(committed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {buying && (
        <BuyDialog
          pack={buying}
          email={me.user.email}
          onClose={() => setBuying(null)}
          say={say}
          onBought={(next) => {
            latestBalances.current += 1;
            setBalances(next);
            void loadLedger();
          }}
        />
      )}
    </div>
  );
}

function BuyDialog({
  pack,
  email,
  onClose,
  say,
  onBought,
}: {
  pack: Pack;
  email: string;
  onClose: () => void;
  say: Say;
  onBought: (balances: Balances) => void;
}): ReactNode {
  const key = useRef(newKey()).current;
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Buy ${pack.name}`} onClose={onClose} interruptible>
      {(close) => (
        <>
          <p className="dialog-text">
            <span className="mono">{hoursText(pack.hours)}</span> pack hours for <span className="mono">${money(pack.price_cents)}</span>, valid for 60 days
            from today at your home site.
          </p>
          <div className="dialog-actions">
            <ActionButton
              pending={busy}
              className="button button-primary"
              onPress={async () => {
                setBusy(true);
                say(`Charging $${money(pack.price_cents)}…`);
                const result = await api<{ purchase: Purchase; balances: Balances }>("/api/pack-purchases", {
                  method: "POST",
                  body: { pack_id: pack.id },
                  idempotencyKey: key,
                  resumable: true,
                });
                setBusy(false);
                if (!result.ok) {
                  say(errorCopy(result, BUY_ERRORS), "error");
                  return;
                }
                onBought(result.data.balances);
                say(`Added ${hoursText(result.data.purchase.hours)} pack hours, valid through ${result.data.purchase.valid_through}. A receipt is on its way to ${email}.`);
                close();
              }}
            >
              Pay and add hours
            </ActionButton>
            <button type="button" className="button" onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
