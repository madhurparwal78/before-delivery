// Members (operator): balances and insurance, hour adjustments, each member's ledger with reversals,
// and late cancellations with fee waivers.

import { useState } from "preact/hooks";
import type { Booking, Ledger, LedgerTransaction, MemberSummary } from "../../shared/api.js";
import { formatHours } from "../../shared/rules.js";
import { addDays } from "../../shared/zone.js";
import type { Session } from "../App.js";
import { get, post } from "../api.js";
import { perform } from "../feedback.js";
import { DOCUMENT_STATUS_WORDS, KIND_WORDS } from "../format.js";
import { signedHours } from "./Hours.js";
import { Cell, EmptyRow, instantDate, ScreenHead, useBookingNames, useData } from "./shared.js";

const LATE_WINDOW_BEFORE = 33;
const LATE_WINDOW_AFTER = 28;

/** Decimal hours as typed ("1", "-0.25", "+2.5") to whole minutes, or null when it is not a number of hours. */
function minutesFromHours(typed: string): number | null {
  const match = /^([+-])?(\d{1,4})(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!match) return null;
  const fraction = Math.round((Number((match[3] ?? "0").padEnd(2, "0")) * 60) / 100);
  const minutes = Number(match[2]) * 60 + fraction;
  return match[1] === "-" ? -minutes : minutes;
}

function AdjustForm({ member, onDone }: { member: MemberSummary; onDone: (memberId: string) => Promise<void> }) {
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    const minutes = minutesFromHours(hours);
    setBusy(true);
    const done = await perform(
      "Adjusting hours…",
      () => post<{ transaction: LedgerTransaction; balance_minutes: number }>("/api/ledger/adjustments", { member_id: member.id, minutes: minutes ?? Number.NaN, reason }),
      (result) => `Hours adjusted. Balance: ${formatHours(result.balance_minutes)} h.`,
      (failure) => {
        if (failure.body.error === "insufficient_hours") return { text: "That would take the balance below zero." };
        if (failure.body.errors?.minutes) return { text: "Enter an hours change in quarter hours, not zero, up to 100 h either way." };
        if (failure.body.errors?.reason) return { text: "Give a reason of 1 to 200 characters." };
        return null;
      },
    );
    setBusy(false);
    if (done) {
      setHours("");
      setReason("");
    }
    await onDone(member.id);
  };
  return (
    <form class="adjust" aria-label="Adjust hours" onSubmit={submit} noValidate>
      <label class="field field--compact">
        <span class="field__label">Hours change</span>
        <input type="text" inputMode="decimal" value={hours} onInput={(e) => setHours(e.currentTarget.value)} />
      </label>
      <label class="field field--compact">
        <span class="field__label">Reason</span>
        <input type="text" maxLength={200} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
      </label>
      <button type="submit" class="button" disabled={busy} aria-busy={busy ? "true" : "false"}>
        Adjust hours
      </button>
    </form>
  );
}

export function MembersScreen({ session }: { session: Session }) {
  const today = session.kitchen.today;
  const members = useData(() => get<{ members: MemberSummary[] }>("/api/members"), []);
  const [selected, setSelected] = useState<string | null>(null);
  const shownMember = selected ?? members.data?.members[0]?.id ?? null;
  const ledger = useData(() => (shownMember ? get<Ledger>(`/api/ledger?member_id=${encodeURIComponent(shownMember)}`) : Promise.resolve(null)), [shownMember]);
  const late = useData(
    () => get<{ bookings: Booking[] }>(`/api/bookings?from=${addDays(today, -LATE_WINDOW_BEFORE)}&to=${addDays(today, LATE_WINDOW_AFTER)}`),
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const bookingName = useBookingNames(today);

  const afterAdjust = async (memberId: string) => {
    setSelected(memberId);
    await Promise.all([members.reload(), memberId === shownMember ? ledger.reload() : Promise.resolve()]);
  };

  const reverse = async (txn: LedgerTransaction) => {
    setBusy(txn.id);
    await perform(
      "Reversing…",
      () => post<{ balance_minutes: number }>(`/api/ledger/transactions/${txn.id}/reverse`, { reason: `Reversal of ${txn.reason ?? KIND_WORDS[txn.kind]}`.slice(0, 200) }),
      (result) => `Transaction reversed. Balance: ${formatHours(result.balance_minutes)} h.`,
      (failure) => {
        if (failure.body.error === "already_reversed") return { text: "That transaction was already reversed." };
        if (failure.body.error === "not_reversible") return { text: "Only adjustments and opening balances can be reversed." };
        if (failure.body.error === "insufficient_hours") return { text: "That would take the balance below zero." };
        return null;
      },
    );
    setBusy(null);
    await Promise.all([members.reload(), ledger.reload()]);
  };

  const waive = async (booking: Booking) => {
    setBusy(booking.id);
    await perform(
      "Waiving fee…",
      () => post<{ booking: Booking }>(`/api/bookings/${booking.id}/waive-fee`),
      () => "Late-cancellation fee waived.",
      (failure) => (failure.body.error === "invalid_transition" ? { text: "There is no fee left to waive on this booking." } : null),
    );
    setBusy(null);
    await late.reload();
  };

  const memberRows = members.data?.members ?? [];
  const lateRows = (late.data?.bookings ?? []).filter((b) => b.status === "cancelled_with_fee");
  const ledgerRows = ledger.data ? [...ledger.data.transactions].reverse() : [];
  return (
    <section class="screen">
      <ScreenHead title="Members" />
      <table class="table">
        <caption>Members</caption>
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Contact</th>
            <th scope="col" class="num">
              Balance
            </th>
            <th scope="col">Insurance</th>
            <th scope="col">Adjust hours</th>
          </tr>
        </thead>
        <tbody>
          {!members.data && <EmptyRow columns={5}>Loading…</EmptyRow>}
          {memberRows.map((m) => (
            <tr key={m.id}>
              <Cell label="Business">
                <button type="button" class="link-like" aria-pressed={m.id === shownMember ? "true" : "false"} onClick={() => setSelected(m.id)}>
                  {m.business_name}
                </button>
              </Cell>
              <Cell label="Contact">{m.contact_email}</Cell>
              <Cell label="Balance" numeric>
                {formatHours(m.balance_minutes)} h
              </Cell>
              <Cell label="Insurance">
                {m.liability_insurance ? (
                  <span class={`status-word status-word--${m.liability_insurance.status}`}>
                    {DOCUMENT_STATUS_WORDS[m.liability_insurance.status]} · {m.liability_insurance.expires_on}
                  </span>
                ) : (
                  "None on file"
                )}
              </Cell>
              <Cell label="Adjust hours">
                <AdjustForm member={m} onDone={afterAdjust} />
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>

      <p class="table-lead">
        Showing the ledger of <strong>{memberRows.find((m) => m.id === shownMember)?.business_name ?? "…"}</strong>. Choose a business name above to switch.
      </p>
      <table class="table">
        <caption>Member ledger</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Kind</th>
            <th scope="col" class="num">
              Hours
            </th>
            <th scope="col">Reason</th>
            <th scope="col">Correction</th>
          </tr>
        </thead>
        <tbody>
          {!ledger.data && <EmptyRow columns={5}>Loading…</EmptyRow>}
          {ledger.data && ledgerRows.length === 0 && <EmptyRow columns={5}>No hours movements yet.</EmptyRow>}
          {ledgerRows.map((t) => (
            <tr key={t.id}>
              <Cell label="Date">{instantDate(t.created_at)}</Cell>
              <Cell label="Kind">{KIND_WORDS[t.kind]}</Cell>
              <Cell label="Hours" numeric>
                {signedHours(t.member_minutes)} h
              </Cell>
              <Cell label="Reason">{t.reason ?? (t.booking_id ? bookingName(t.booking_id) : "—")}</Cell>
              <Cell label="Correction">
                {t.reversed_by ? (
                  <span class="status-word">Reversed</span>
                ) : t.kind === "adjustment" || t.kind === "opening" ? (
                  <button type="button" class="button" disabled={busy !== null} aria-busy={busy === t.id ? "true" : "false"} onClick={() => void reverse(t)}>
                    Reverse
                  </button>
                ) : (
                  "—"
                )}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>

      <table class="table">
        <caption>Late cancellations</caption>
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Station</th>
            <th scope="col">Date</th>
            <th scope="col" class="num">
              Fee
            </th>
            <th scope="col">Fee status</th>
            <th scope="col">Waiver</th>
          </tr>
        </thead>
        <tbody>
          {!late.data && <EmptyRow columns={6}>Loading…</EmptyRow>}
          {late.data && lateRows.length === 0 && <EmptyRow columns={6}>No late cancellations.</EmptyRow>}
          {lateRows.map((b) => (
            <tr key={b.id}>
              <Cell label="Business">{b.business_name}</Cell>
              <Cell label="Station">{b.station_name}</Cell>
              <Cell label="Date">
                {b.date}
              </Cell>
              <Cell label="Fee" numeric>
                ${b.fee?.amount ?? "0.00"}
              </Cell>
              <Cell label="Fee status">{b.fee ? { pending: "Pending", charged: "Charged", waived: "Waived" }[b.fee.status] : "—"}</Cell>
              <Cell label="Waiver">
                {b.fee && b.fee.status !== "waived" ? (
                  <button type="button" class="button" disabled={busy !== null} aria-busy={busy === b.id ? "true" : "false"} onClick={() => void waive(b)}>
                    Waive fee
                  </button>
                ) : (
                  "—"
                )}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
