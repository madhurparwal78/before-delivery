// Business months: fee lines per tier and the month close (Kill Bill invoice first, then the record and the mail).
import { useState } from "preact/hooks";
import { api } from "../api";
import { useResource } from "../hooks";
import { Heading, Link, navigate } from "../router";
import { say } from "../store";
import type { MonthBody } from "../types";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button, Refusal, submit, useForm } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig, Table } from "../ui/Table";
import { formatMoney, formatMonth } from "../../shared/format";
import { wholeNumber } from "./common-text";
import { useDesk } from "./desk";

const STATUS_TEXT: Record<MonthBody["status"], string> = { open: "Open", ready: "Ready to close", invoiced: "Invoiced" };
const CLOSE = "close-month";

function Skeleton() {
  return <div class="skeleton" aria-busy="true"><span /><span /><span /></div>;
}

function FeeLines({ month }: { month: MonthBody }) {
  return (
    <Table label="Fee lines" columns={[{ label: "Tier" }, { label: "Messages", figures: true }, { label: "Unit price", figures: true },
      { label: "Amount", figures: true }]}
      rows={(month.lines ?? []).map((l) => ({
        key: String(l.tier),
        cells: [l.label, <Fig>{wholeNumber(l.count)}</Fig>, <Fig>{month.currency} {l.unitPrice}</Fig>, <Fig>{formatMoney(month.currency, l.amountCents)}</Fig>],
      }))} />
  );
}

/** Confirms a close with the month's fee lines and total; Cancel comes first. */
function CloseMonth({ ym, open, onClose, onClosed }: { ym: string; open: boolean; onClose: () => void; onClosed: (month: MonthBody) => void }) {
  const desk = useDesk();
  const form = useForm<Record<string, string>>({});
  const [loaded] = useResource<{ month: MonthBody }>(open ? `/api${desk.base}/months/${ym}` : null);
  const label = formatMonth(ym);
  const close = () => void submit<{ month: MonthBody }>(form, {
    action: CLOSE,
    pending: "Closing month…",
    call: () => api("POST", `/api${desk.base}/months/${ym}/close`, { json: {} }),
    done: ({ month }) => {
      say(CLOSE, `${label} closed. Invoice received.`, "success");
      onClosed(month);
    },
  });
  return (
    <Dialog open={open} label="Close month" onClose={onClose} wide>
      <p>Closing {label} records its fee lines, sends one invoice to Kill Bill and mails the finance lead, all together.</p>
      {loaded.state === "ready" ? (
        <>
          <FeeLines month={loaded.data.month} />
          <p class="total-line"><span>Total</span><Fig>{formatMoney(loaded.data.month.currency, loaded.data.month.totalCents)}</Fig></p>
        </>
      ) : <Skeleton />}
      <Refusal form={form} />
      {form.busy && <p class="note note-pending"><Icon name="info" size={18} /><span>Closing month…</span></p>}
      <div class="form-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={form.busy} onClick={close}>Close month</Button>
      </div>
    </Dialog>
  );
}

export function MonthsScreen() {
  const desk = useDesk();
  const [list] = useResource<{ months: MonthBody[] }>(`/api${desk.base}/months`);
  const [closing, setClosing] = useState<string | null>(null);
  const finance = desk.role === "finance_lead";
  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>Months</Heading>
          <p class="lede">Message usage per business month in {desk.workspace.city}, billed once the month has ended.</p>
        </div>
        <ActionNote action={CLOSE} />
        {list.state === "loading" ? <Skeleton /> : (
          <Table label="Business months" columns={[{ label: "Month" }, { label: "Messages", figures: true }, { label: "Total", figures: true },
            { label: "Status" }, { label: "Action" }]}
            rows={(list.state === "ready" ? list.data.months : []).map((m) => ({
              key: m.month,
              cells: [
                <Link href={`${desk.base}/months/${m.month}`}>{formatMonth(m.month)}</Link>,
                <Fig>{wholeNumber(m.messageCount)}</Fig>,
                <Fig>{formatMoney(m.currency, m.totalCents)}</Fig>,
                <span class={`badge month-${m.status}`}>{STATUS_TEXT[m.status]}</span>,
                finance && m.status === "ready"
                  ? <Button onClick={() => setClosing(m.month)}>Close month</Button>
                  : <span class="muted">—</span>,
              ],
            }))} />
        )}
      </section>
      {finance && (
        <CloseMonth ym={closing ?? ""} open={closing !== null} onClose={() => setClosing(null)}
          onClosed={() => {
            const ym = closing;
            setClosing(null);
            navigate(`${desk.base}/months/${ym}`, { keepFeedback: true });
          }} />
      )}
    </div>
  );
}

export function MonthScreen({ month: ym }: { month: string }) {
  const desk = useDesk();
  const [loaded] = useResource<{ month: MonthBody }>(`/api${desk.base}/months/${ym}`);
  const [closed, setClosed] = useState<MonthBody | null>(null);
  const [closing, setClosing] = useState(false);
  if (loaded.state === "loading") return <Skeleton />;
  if (loaded.state === "failed") {
    return (
      <section class="work">
        <Heading>Month not found</Heading>
        <p class="note note-refusal"><Icon name="alert" size={18} /><span>{loaded.error.message}</span></p>
      </section>
    );
  }
  const month = closed ?? loaded.data.month;
  const finance = desk.role === "finance_lead";
  return (
    <div class="screen screen-split">
      <section class="work">
        <div class="screen-head">
          <Heading>{formatMonth(ym)}</Heading>
          {finance && (
            <Button variant="primary" disabled={month.status !== "ready"} onClick={() => setClosing(true)}>Close month</Button>
          )}
        </div>
        <ActionNote action={CLOSE} />
        <FeeLines month={month} />
        <p class="total-line panel"><span>Total for {formatMonth(ym)}</span><Fig>{formatMoney(month.currency, month.totalCents)}</Fig></p>
      </section>
      <section class="evidence">
        <div class="panel">
          <h2>Invoice</h2>
          <dl class="facts">
            <dt>Status</dt><dd><span class={`badge month-${month.status}`}>{STATUS_TEXT[month.status]}</span></dd>
            <dt>Messages</dt><dd><Fig>{wholeNumber(month.messageCount)}</Fig></dd>
            <dt>Invoice id</dt><dd>{month.invoiceId ? <Fig>{month.invoiceId}</Fig> : <span class="muted">After the close</span>}</dd>
            <dt>Closed at</dt><dd>{month.closedAt ? <Fig>{desk.when(month.closedAt)}</Fig> : <span class="muted">Not yet closed</span>}</dd>
          </dl>
          <p class="field-hint">Lines are computed figures until the month closes, then as recorded with the Kill Bill invoice.</p>
        </div>
      </section>
      {finance && (
        <CloseMonth ym={ym} open={closing} onClose={() => setClosing(false)}
          onClosed={(m) => { setClosed(m); setClosing(false); }} />
      )}
    </div>
  );
}
