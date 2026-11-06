import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { call, newKey, type Reservation } from "../api.js";
import { LICENCE_LABEL, TIER_NAME, dollars, stateLabel } from "../format.js";
import { Live, Page, openLink } from "../ui/kit.js";
import { StaffSignIn, useStaff } from "../ui/StaffSignIn.js";
import { SeatsRegion } from "./Seats.js";

interface DeskRow extends Reservation {
  buyer_email: string;
  kb: { paid_cents: number; refunded_cents: number } | null;
}

interface DeskList {
  billing: "ok" | "unavailable";
  deposits_open: boolean;
  reservations: DeskRow[];
}

const MISSING_WORDS: Record<string, string> = {
  balance_unpaid: "balance unpaid",
  day1_check_in: "day 1 check-in",
  day2_check_in: "day 2 check-in",
  licence_not_matched: "licence not matched",
};

const SOLD = ["deposit_paid", "paid_in_full", "checked_in_day1", "checked_in_day2", "certificate_issued"];

function Kb({ value, billing }: { value: number | undefined; billing: DeskList["billing"] }) {
  return billing === "unavailable" || value === undefined ? <span class="muted">Unavailable</span> : <span class="num">${dollars(value)}</span>;
}

export function Desk() {
  const { me, refresh } = useStaff("registrar");
  const [q, setQ] = useState("");
  const [list, setList] = useState<DeskList | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [seatsTick, setSeatsTick] = useState(0);
  const query = useRef(q);
  const latest = useRef(0);

  /** Loads the table for the current search; an answer to an older search is dropped. */
  const load = async () => {
    const ticket = ++latest.current;
    const reply = await call<DeskList>("GET", `/api/desk/reservations?q=${encodeURIComponent(query.current)}`);
    if (reply.ok && ticket === latest.current) setList(reply.data);
  };

  const signedIn = !!me;
  useLayoutEffect(() => {
    if (signedIn) void load();
  }, [signedIn]);

  if (me === undefined) return <Page title="Registrar desk">{null}</Page>;
  if (me === null) {
    return (
      <Page title="Registrar desk">
        <h1 class="page-title">Registrar desk</h1>
        <StaffSignIn heading="Registrar sign-in" onSignedIn={refresh} />
      </Page>
    );
  }

  const after = (text: string) => {
    setMessage(text);
    setSeatsTick((n) => n + 1);
    void load();
  };
  const name = (row: DeskRow) => row.attendee?.name ?? row.buyer.name;

  const refund = async (row: DeskRow) => {
    const reply = await call<{ refund: { amount_cents: number } }>("POST", `/api/desk/reservations/${row.id}/refund`, {}, newKey());
    if (reply.ok) after(`Refunded $${dollars(reply.data.refund.amount_cents)} for Bench ${row.bench}.`);
    else after(reply.error.error === "billing_unavailable" ? "Refund not sent: Kill Bill is not answering. Nothing was refunded." : reply.error.message);
  };
  const review = async (row: DeskRow, decision: "matched" | "rejected") => {
    const reply = await call("POST", `/api/desk/reservations/${row.id}/licence-review`, { decision });
    after(reply.ok ? `Licence ${decision} for ${name(row)}.` : reply.error.message);
  };
  const visa = async (row: DeskRow) => {
    const reply = await call("POST", `/api/desk/reservations/${row.id}/visa-letter`, {});
    after(reply.ok ? `Visa-support letter issued to ${name(row)}.` : reply.error.error === "storage_unavailable" ? "Visa letter not issued: document storage is not answering. Nothing was sent." : reply.error.message);
  };
  const certificate = async (row: DeskRow) => {
    const reply = await call("POST", `/api/desk/reservations/${row.id}/certificate`, {});
    if (reply.ok) after(`Certificate issued to ${name(row)}.`);
    else if (reply.error.error === "certificate_not_eligible") after(`Certificate not ready: ${(reply.error.missing ?? []).map((m) => MISSING_WORDS[m] ?? m).join(", ")}.`);
    else if (reply.error.error === "storage_unavailable") after("Certificate not issued: document storage is not answering. No certificate number was used.");
    else after(reply.error.message);
  };
  const openLicence = async (row: DeskRow) => {
    const result = await openLink(`/api/reservations/${row.id}/licence`);
    if (!result.ok) setMessage("Documents are unavailable right now. Try again shortly.");
  };

  const rows = list?.reservations ?? [];
  const focus = rows.find((row) => row.id === selected) ?? null;
  return (
    <Page title="Registrar desk" wide>
      <div class="desk">
        <div class="desk__main">
          <h1 class="page-title">Registrar desk</h1>
          {list?.billing === "unavailable" && (
            <div class="banner" role="alert">
              Kill Bill is not answering. Paid and refunded totals will refresh when it is back.
            </div>
          )}
          <div class="desk__search">
            <label for="desk-search">Find a reservation</label>
            <input
              id="desk-search"
              type="search"
              aria-label="Find a reservation"
              placeholder="Attendee, buyer or bench"
              value={q}
              onInput={(e) => {
                const value = (e.target as HTMLInputElement).value;
                setQ(value);
                query.current = value;
                void load();
              }}
            />
          </div>
          <Live label="Desk updates" message={message} />
          {message && <p class="echo">{message}</p>}
          {!list && (
            <div class="skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
          {list && rows.length === 0 && <p class="muted">No reservation matches that search.</p>}
          {/* a horizontally scrolling region must be reachable and named for keyboard users */}
          <div class="table-wrap" tabIndex={0} role="region" aria-label="Reservations table, scrolls sideways">
            <table class="table" aria-label="Reservations">
              <thead>
                <tr>
                  <th scope="col">Bench</th>
                  <th scope="col">Attendee</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Tier</th>
                  <th scope="col">State</th>
                  <th scope="col">Paid in Kill Bill</th>
                  <th scope="col">Refunded in Kill Bill</th>
                  <th scope="col">Refund due</th>
                  <th scope="col">Licence</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  // Cells are separated by spaces so the row's text reads cell by cell.
                  <tr key={row.id} class={row.id === selected ? "is-selected" : ""}>
                    <td data-label="Bench">
                      <button type="button" class="link" onClick={() => setSelected(row.id)}>
                        <span class="num">{row.bench}</span>
                      </button>
                    </td>{" "}
                    <td data-label="Attendee">{row.attendee ? row.attendee.name : <span class="muted">Unassigned</span>}</td>{" "}
                    <td data-label="Buyer">{row.buyer.name}</td>{" "}
                    <td data-label="Tier">{TIER_NAME[row.tier]}</td>{" "}
                    <td data-label="State">{row.payment_pending ? "Payment being confirmed" : stateLabel(row.state, list?.deposits_open ?? true)}</td>{" "}
                    <td data-label="Paid in Kill Bill">
                      <Kb value={row.kb?.paid_cents} billing={list?.billing ?? "ok"} />
                    </td>{" "}
                    <td data-label="Refunded in Kill Bill">
                      <Kb value={row.kb?.refunded_cents} billing={list?.billing ?? "ok"} />
                    </td>{" "}
                    <td data-label="Refund due">{row.refund_due_cents === null ? <span class="muted">None</span> : <span class="num">${dollars(row.refund_due_cents)}</span>}</td>{" "}
                    <td data-label="Licence">{LICENCE_LABEL[row.licence_status] ?? row.licence_status}</td>{" "}
                    <td data-label="Actions" class="table__actions">
                      {row.state === "cancelled" && (
                        <button type="button" class="button button--primary button--small" onClick={() => void refund(row)}>
                          Issue refund ${dollars(row.refund_due_cents ?? 0)}
                        </button>
                      )}
                      {row.licence_status !== "none" && (
                        <button type="button" class="button button--small" onClick={() => void openLicence(row)}>
                          Open licence
                        </button>
                      )}
                      {(row.licence_status === "submitted" || row.licence_status === "rejected") && (
                        <>
                          <button type="button" class="button button--small" onClick={() => void review(row, "matched")}>
                            Mark licence matched
                          </button>
                          {row.licence_status === "submitted" && (
                            <button type="button" class="button button--small button--quiet" onClick={() => void review(row, "rejected")}>
                              Reject licence
                            </button>
                          )}
                        </>
                      )}
                      {row.passport_status === "submitted" && !row.documents.includes("visa-letter") && SOLD.includes(row.state) && (
                        <button type="button" class="button button--small" onClick={() => void visa(row)}>
                          Issue visa letter
                        </button>
                      )}
                      {SOLD.includes(row.state) && row.state !== "certificate_issued" && (
                        <button type="button" class="button button--small" onClick={() => void certificate(row)}>
                          Issue certificate
                        </button>
                      )}
                    </td>{" "}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside class="desk__side">
          <SeatsRegion refresh={seatsTick} />
          {focus ? (
            <section class="card" aria-label={`Details for Bench ${focus.bench}`}>
              <p class="eyebrow">Bench {focus.bench}</p>
              <h2 class="card__title">{focus.attendee?.name ?? "No attendee yet"}</h2>
              <dl class="facts-list">
                <div>
                  <dt>Buyer</dt>
                  <dd>
                    {focus.buyer.name} · {focus.buyer_email}
                  </dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd class="num">${dollars(focus.price_cents)}</dd>
                </div>
                <div>
                  <dt>Balance</dt>
                  <dd class="num">${dollars(focus.balance_cents)}</dd>
                </div>
                <div>
                  <dt>Passport scan</dt>
                  <dd>{focus.passport_status === "submitted" ? "Received" : "None"}</dd>
                </div>
                <div>
                  <dt>Check-in</dt>
                  <dd>
                    Day 1 {focus.checked_in.day1 ? "done" : "not yet"} · Day 2 {focus.checked_in.day2 ? "done" : "not yet"}
                  </dd>
                </div>
                <div>
                  <dt>Documents</dt>
                  <dd>{focus.documents.length ? focus.documents.join(", ") : "None yet"}</dd>
                </div>
              </dl>
            </section>
          ) : (
            <p class="muted desk__hint">Choose a bench in the table to see its details.</p>
          )}
        </aside>
      </div>
    </Page>
  );
}
