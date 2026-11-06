// Hours (member): the prepaid balance, a button per published pack, and the paired hours ledger.

import { useState } from "preact/hooks";
import type { Ledger, LedgerTransaction } from "../../shared/api.js";
import { formatHours } from "../../shared/rules.js";
import type { Session } from "../App.js";
import { get, post } from "../api.js";
import { perform } from "../feedback.js";
import { KIND_WORDS } from "../format.js";
import { Cell, EmptyRow, instantDate, ScreenHead, useBookingNames, useData } from "./shared.js";

export function signedHours(minutes: number): string {
  return `${minutes > 0 ? "+" : ""}${formatHours(minutes)}`;
}

export function HoursScreen({ session }: { session: Session }) {
  const ledger = useData(() => get<Ledger>("/api/ledger"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const bookingName = useBookingNames(session.kitchen.today);

  const buy = async (packId: string, name: string) => {
    setBusy(packId);
    await perform(
      `Buying ${name}…`,
      () => post<{ transaction: LedgerTransaction; balance_minutes: number }>(`/api/packs/${packId}/purchase`),
      (result) => `${name} added. Balance: ${formatHours(result.balance_minutes)} h.`,
      (failure) => (failure.body.error === "billing_unavailable" ? { text: "Billing is unreachable right now. No charge was made; try again shortly." } : null),
    );
    setBusy(null);
    await ledger.reload();
  };

  const rows = ledger.data ? [...ledger.data.transactions].reverse() : [];
  return (
    <section class="screen">
      <ScreenHead title="Hours">
        <p class="screen-head__figure num">Balance {ledger.data ? formatHours(ledger.data.balance_minutes) : "…"} h</p>
      </ScreenHead>
      <div class="packs">
        {session.kitchen.packs.map((pack) => (
          <div class="pack" key={pack.id}>
            <p class="pack__name">{pack.name}</p>
            <p class="pack__price num">${pack.price}</p>
            <p class="pack__meta num">{formatHours(pack.minutes)} h prepaid</p>
            <button type="button" class="button button--primary" disabled={busy !== null} aria-busy={busy === pack.id ? "true" : "false"} onClick={() => void buy(pack.id, pack.name)}>
              Buy {pack.name}
            </button>
          </div>
        ))}
      </div>
      <table class="table">
        <caption>Hours ledger</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Kind</th>
            <th scope="col" class="num">
              Hours
            </th>
            <th scope="col">Booking</th>
          </tr>
        </thead>
        <tbody>
          {!ledger.data && <EmptyRow columns={4}>Loading…</EmptyRow>}
          {ledger.data && rows.length === 0 && <EmptyRow columns={4}>No hours movements yet.</EmptyRow>}
          {rows.map((t) => (
            <tr key={t.id}>
              <Cell label="Date">{instantDate(t.created_at)}</Cell>
              <Cell label="Kind">
                {KIND_WORDS[t.kind]}
                {t.reason && t.kind !== "opening" ? <span class="table__note">{t.reason}</span> : null}
              </Cell>
              <Cell label="Hours" numeric>
                {signedHours(t.member_minutes)} h
              </Cell>
              <Cell label="Booking">{t.booking_id ? bookingName(t.booking_id) : "—"}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
