// Talent statements: the picker (/workspace/statements) and one office month
// (/workspace/statements/<talentId>/<YYYY-MM>) with Record advance, Reverse entry and Export CSV.

import { useEffect, useRef, useState } from "react";
import { api } from "../../../api.js";
import { Link, definePage, navigate } from "../../../router.js";
import { DRAFT_RESTORED_COPY, sessionCopy, takeDraft } from "../../../session.js";
import { Shell } from "../../../workspace/shell.js";
import { Button } from "../../../ui/button.js";
import { Dialog } from "../../../ui/dialog.js";
import { Select, TextField } from "../../../ui/fields.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { StatusLine, useAnnouncer } from "../../../ui/status.js";
import { formatDate, formatMoney, formatMonth, formatOfficeTime, parseMoneyInput } from "../../../../shared/format.js";
import { addMonthsToMonth, isMonth } from "../../../../shared/zones.js";
import { download, endedSession, here, useFocusAfterRender, useOfficeToday, type TalentSummary } from "./common.js";
import { useResource, useMember } from "../../../workspace/data.js";
import { BILLING_DOWN, STORAGE_DOWN } from "../../../workspace/data.js";

interface StatementLine {
  movementId: string;
  officeDate: string;
  kind: "booking" | "advance" | "reversal";
  reference: string;
  client: string;
  description: string;
  amountCents: number;
  balanceCents: number;
}

interface Statement {
  talentId: string;
  displayName: string;
  month: string;
  openingBalanceCents: number;
  lines: StatementLine[];
  totals: { earningsCents: number; advancesCents: number; reversalsCents: number; netCents: number };
  closingBalanceCents: number;
  advances: Array<{ movementId: string; amountCents: number; recoupedCents: number; outstandingCents: number }>;
}

interface LedgerBook {
  balanceCents: number;
  movements: Array<{ id: string; reference: string; reversedBy: string | null }>;
}

const TYPES = { booking: "Booking", advance: "Advance", reversal: "Reversal" };

function AdvanceDialog({ talent, initial, onClose, onSaved, onSessionEnded, announce }: {
  talent: Statement;
  initial: { amount: string; note: string };
  onClose: () => void;
  onSaved: (movementId: string, copy: string) => Promise<void>;
  onSessionEnded: (copy: string) => void;
  announce: (copy: string) => void;
}) {
  const [amount, setAmount] = useState(initial.amount);
  const [note, setNote] = useState(initial.note);
  const [pending, setPending] = useState(false);
  const form = useFormErrors({ amountCents: "advance-amount", note: "advance-note" });
  const submit = async () => {
    const typed = amount.trim();
    const cents = parseMoneyInput(typed);
    setPending(true);
    const result = await api<{ movement: { id: string } }>("POST", `/api/talent/${talent.talentId}/advances`,
      { amountCents: cents ?? (typed ? typed : null), note });
    setPending(false);
    if (result.ok) {
      await onSaved(result.data.movement.id, `Recorded an advance of ${formatMoney(cents ?? 0)} for ${talent.displayName}.`);
      return;
    }
    const ended = endedSession(result.error, "advance", { amount, note });
    if (ended) {
      onSessionEnded(ended);
      return;
    }
    if (!form.take(result.error, announce)) announce("The advance was not saved. Try again.");
  };
  return (
    <Dialog title="Record advance" onClose={onClose} sheet
      actions={<Button pending={pending} pendingLabel="Saving advance…" onClick={() => void submit()}>Save advance</Button>}>
      <Problems items={form.problems} />
      <form noValidate className="stack" onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <TextField id="advance-amount" label="Amount" inputMode="decimal" value={amount} onChange={setAmount}
          error={form.error("amountCents")} hint="In Canadian dollars, for example 125.50" />
        <TextField id="advance-note" label="Note" value={note} onChange={setNote} error={form.error("note")} />
      </form>
    </Dialog>
  );
}

function ReverseDialog({ line, onClose, onReversed, announce }: {
  line: StatementLine;
  onClose: () => void;
  onReversed: (movementId: string) => Promise<void>;
  announce: (copy: string) => void;
}) {
  const member = useMember();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState("");
  const form = useFormErrors({ reason: "reverse-reason" });
  const submit = async () => {
    setPending(true);
    const result = await api<{ movement: { id: string } }>("POST", `/api/ledger/movements/${line.movementId}/reversal`, { reason });
    setPending(false);
    if (result.ok) {
      await onReversed(result.data.movement.id);
      return;
    }
    const error = result.error;
    if (form.take(error, announce)) return;
    const office = member.office;
    const copy = sessionCopy(error) ?? (error.error === "already_reversed"
      ? `This entry was already reversed by ${String(error.reversedBy ?? "")} at ${
        typeof error.reversedAt === "string" ? formatOfficeTime(error.reversedAt, office) : ""}.`
      : error.error === "billing_unavailable" ? BILLING_DOWN
        : error.error === "not_invoiced" ? "This booking is not invoiced yet, so it cannot be reversed."
          : "The entry was not reversed. Reload and try again.");
    setRefusal(copy);
    announce(copy);
  };
  return (
    <Dialog title="Reverse entry" onClose={onClose} sheet
      actions={<Button pending={pending} pendingLabel="Reversing…" onClick={() => void submit()}>Reverse entry</Button>}>
      <Problems items={form.problems} />
      {refusal ? <p className="refusal">{refusal}</p> : null}
      <p className="muted">{TYPES[line.kind]} {line.reference}, {formatMoney(line.amountCents)}. A reversal writes the exact mirror of this entry.</p>
      <form noValidate onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <TextField id="reverse-reason" label="Reason" value={reason} onChange={setReason} error={form.error("reason")} />
      </form>
    </Dialog>
  );
}

function StatementPage({ talentId, month }: { talentId: string; month: string }) {
  const member = useMember();
  const staff = member.role === "accounts_lead" || member.role === "agency_director";
  const { message, announce } = useAnnouncer();
  const statement = useResource<Statement>(`/api/talent/${talentId}/statements/${month}`);
  const ledger = useResource<LedgerBook>(`/api/talent/${talentId}/ledger`);
  const [advance, setAdvance] = useState<{ amount: string; note: string } | null>(null);
  const [reversing, setReversing] = useState<StatementLine | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportButton = useRef<HTMLButtonElement>(null);
  const focusLater = useFocusAfterRender();
  const focusRow = useRef("");
  const restored = useRef(false);
  const data = statement.data;

  useEffect(() => {
    if (restored.current || !data) return;
    restored.current = true;
    const draft = takeDraft(here());
    if (draft?.dialog === "advance") {
      setAdvance({ amount: draft.values.amount ?? "", note: draft.values.note ?? "" });
      announce(DRAFT_RESTORED_COPY);
    }
  }, [data, announce]);

  useEffect(() => {
    if (!focusRow.current || advance || reversing) return;
    const cell = document.querySelector<HTMLElement>(`[data-movement="${focusRow.current}"] > :first-child`);
    if (cell) {
      focusRow.current = "";
      cell.focus();
    }
  });

  const refresh = async () => {
    await Promise.all([statement.reload(), ledger.reload()]);
  };
  const reversed = new Set((ledger.data?.movements ?? []).filter((m) => m.reversedBy).map((m) => m.id));

  const exportCsv = async () => {
    setExporting(true);
    const result = await download(`/api/talent/${talentId}/statements/${month}.csv`);
    setExporting(false);
    announce(result.ok ? `Statement for ${formatMonth(month)} downloaded.`
      : sessionCopy({ error: result.error }) ?? (result.error === "storage_unavailable" ? STORAGE_DOWN : "The export did not finish. Try again."));
    focusLater(() => exportButton.current);
  };

  return (
    <Shell>
      <div className="workspace-head">
        <p className="eyebrow">{staff ? <Link href="/workspace/statements">Statements</Link> : "My statement"}</p>
        <h1>{data ? `${data.displayName}, ${formatMonth(month)}` : `Statement, ${formatMonth(month)}`}</h1>
      </div>
      <StatusLine name="Statement" message={message} />
      <nav aria-label="Months" className="month-nav">
        <Link href={`/workspace/statements/${talentId}/${addMonthsToMonth(month, -1)}`}>Previous month</Link>
        <Link href={`/workspace/statements/${talentId}/${addMonthsToMonth(month, 1)}`}>Next month</Link>
      </nav>
      <div className="btn-row">
        {staff ? <Button variant="quiet" onClick={() => setAdvance({ amount: "", note: "" })}>Record advance</Button> : null}
        <Button ref={exportButton} variant="quiet" pending={exporting} pendingLabel="Preparing export…"
          onClick={() => void exportCsv()}>Export CSV</Button>
      </div>
      {!data ? <p className="muted">{statement.failed ? "This statement could not be loaded." : "Loading the statement…"}</p> : (
        <>
          <dl className="facts facts-inline">
            <div><dt>Opening balance</dt><dd className="num">{formatMoney(data.openingBalanceCents)}</dd></div>
            <div><dt>Net this month</dt><dd className="num">{formatMoney(data.totals.netCents)}</dd></div>
            <div><dt>Closing balance</dt><dd className="num">{formatMoney(data.closingBalanceCents)}</dd></div>
          </dl>
          <div className="desk-region pinned" role="region" aria-label="Statement lines" tabIndex={0}>
            <table aria-label="Statement" className="desk-table">
              <thead>
                <tr>
                  <th scope="col">Date</th><th scope="col">Type</th><th scope="col">Reference</th><th scope="col">Client</th>
                  <th scope="col">Description</th><th scope="col" className="num">Amount</th>
                  <th scope="col" className="num">Balance</th>
                  {staff ? <th scope="col"><span className="visually-hidden">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.movementId} data-movement={line.movementId}>
                    <td tabIndex={-1} className="tnum">{formatDate(line.officeDate)}</td>
                    <td>{TYPES[line.kind]}</td>
                    <td>{line.reference}</td>
                    <td>{line.client}</td>
                    <td>{line.description}</td>
                    <td className="num">{formatMoney(line.amountCents)}</td>
                    <td className="num">{formatMoney(line.balanceCents)}</td>
                    {staff ? (
                      <td>
                        {line.kind !== "reversal" && !reversed.has(line.movementId) ? (
                          <Button variant="quiet" onClick={() => setReversing(line)}>Reverse</Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!data.lines.length ? (
                  <tr><td colSpan={staff ? 8 : 7} className="muted">No entries in {formatMonth(month)}.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <h2 className="section-title">Advances</h2>
          {data.advances.length ? (
            <div className="desk-region" role="region" aria-label="Advance recoupment" tabIndex={0}>
              <table aria-label="Advances" className="desk-table">
                <thead>
                  <tr><th scope="col">Advance</th><th scope="col" className="num">Amount</th>
                    <th scope="col" className="num">Recouped</th><th scope="col" className="num">Outstanding</th></tr>
                </thead>
                <tbody>
                  {data.advances.map((a) => (
                    <tr key={a.movementId}>
                      <td>{ledger.data?.movements.find((m) => m.id === a.movementId)?.reference ?? ""}</td>
                      <td className="num">{formatMoney(a.amountCents)}</td>
                      <td className="num">{formatMoney(a.recoupedCents)}</td>
                      <td className="num">{formatMoney(a.outstandingCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">No open advances at the end of {formatMonth(month)}.</p>}
        </>
      )}
      {advance && data ? (
        <AdvanceDialog talent={data} initial={advance} announce={announce} onClose={() => setAdvance(null)}
          onSaved={async (id, copy) => {
            await refresh();
            announce(copy);
            focusRow.current = id;
            setAdvance(null);
          }}
          onSessionEnded={(copy) => {
            announce(copy);
            setAdvance(null);
          }} />
      ) : null}
      {reversing ? (
        <ReverseDialog line={reversing} announce={announce} onClose={() => setReversing(null)} onReversed={async (id) => {
          const [, book] = await Promise.all([statement.reload(), ledger.reload()]);
          announce(`Reversed ${reversing.reference}. The balance is now ${formatMoney(book?.balanceCents ?? 0)}.`);
          focusRow.current = id;
          setReversing(null);
        }} />
      ) : null}
    </Shell>
  );
}

function StatementPicker() {
  const member = useMember();
  const roster = useResource<{ talent: TalentSummary[] }>("/api/talent");
  const current = useOfficeToday(member.office)?.slice(0, 7) ?? "";
  const [talentId, setTalentId] = useState("");
  const [month, setMonth] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (current && member.role === "talent" && member.talentId) {
      navigate(`/workspace/statements/${member.talentId}/${current}`, { replace: true });
    }
  }, [member, current]);
  const talent = [...(roster.data?.talent ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <Shell>
      <div className="workspace-head">
        <p className="eyebrow">Monthly talent statements</p>
        <h1>Statements</h1>
      </div>
      <form noValidate className="form-grid narrow" onSubmit={(event) => {
        event.preventDefault();
        if (!talentId) {
          setError("Enter talent.");
          return;
        }
        navigate(`/workspace/statements/${talentId}/${isMonth(month) ? month : current}`);
      }}>
        <Problems items={error ? [{ id: "statement-talent", text: error }] : []} />
        <Select id="statement-talent" label="Talent" value={talentId} onChange={setTalentId} error={error || undefined}
          choices={[{ value: "", label: "Choose a talent" }, ...talent.map((t) => ({ value: t.id, label: t.displayName }))]} />
        <TextField id="statement-month" label="Month" type="month" value={month || current} onChange={setMonth} />
        <div className="btn-row"><button type="submit" className="btn">Open statement</button></div>
      </form>
    </Shell>
  );
}

definePage({ pattern: "/workspace/statements", kind: "workspace", roles: ["agency_director", "accounts_lead", "talent"],
  render: () => <StatementPicker /> });
definePage({ pattern: /^\/workspace\/statements\/([^/]+)\/(\d{4}-\d{2})$/, kind: "workspace",
  roles: ["agency_director", "accounts_lead", "talent"],
  render: (match) => <StatementPage key={`${match.params["0"]}/${match.params["1"]}`} talentId={match.params["0"]}
    month={match.params["1"]} /> });
