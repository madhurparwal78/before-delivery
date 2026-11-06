// The daily report: one business day from local midnight to the next, with the transfers created inside it.
import { useState } from "preact/hooks";
import { api } from "../api";
import { useResource } from "../hooks";
import { Heading, Link } from "../router";
import { say } from "../store";
import type { CaseStatus } from "../types";
import { ActionNote, Button, Field, Problems, submit, useForm } from "../ui/forms";
import { Empty, Fig, Table } from "../ui/Table";
import { formatCrypto, formatDate, formatMoney, plural } from "../../shared/format";
import { CASE_STATUS_TEXT } from "./common-text";
import { useDesk } from "./desk";

interface DailyReport {
  date: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  transfers: number;
  cases: {
    reference: string; createdAt: string; asset: string; amount: string; fiatValueCents: bigint; currency: string;
    thresholdCents: bigint | null; counterpartyName: string | null; path: string; status: CaseStatus;
  }[];
}

const PATH_TEXT: Record<string, string> = {
  counterparty: "Counterparty", sunrise: "Sunrise", below_threshold: "Below threshold", self_hosted: "Self-hosted", review: "Review",
};

export function DailyReportScreen() {
  const desk = useDesk();
  const form = useForm<Record<string, string>>({ date: desk.workspace.today });
  const [initial] = useResource<DailyReport>(`/api${desk.base}/reports/daily?date=${desk.workspace.today}`);
  const [shown, setShown] = useState<DailyReport | null>(null);
  const report = shown ?? (initial.state === "ready" ? initial.data : null);
  const [cases] = useResource<{ cases: { id: string; reference: string }[] }>(`/api${desk.base}/cases?show=open`);
  const [closed] = useResource<{ cases: { id: string; reference: string }[] }>(`/api${desk.base}/cases?show=closed`);
  const ids = new Map([...(cases.state === "ready" ? cases.data.cases : []), ...(closed.state === "ready" ? closed.data.cases : [])]
    .map((k) => [k.reference, k.id]));

  const show = (event: Event) => {
    event.preventDefault();
    void submit<DailyReport>(form, {
      action: "daily-report",
      pending: "Loading report…",
      call: () => api("GET", `/api${desk.base}/reports/daily?date=${encodeURIComponent(form.values.date)}`),
      done: (data) => {
        setShown(data);
        say("daily-report", data.transfers === 0 ? `No transfers on ${formatDate(data.date)}.`
          : `${plural(data.transfers, "transfer", "transfers")} on ${formatDate(data.date)}.`, "info");
      },
    });
  };

  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>Daily report</Heading>
          <p class="lede">One business day in {desk.workspace.city}, from local midnight to the next.</p>
        </div>
        <form class="panel report-picker" noValidate onSubmit={show}>
          <Problems form={form} />
          <div class="report-picker-row">
            <Field form={form} name="date" label="Business date" mono placeholder="YYYY-MM-DD" />
            <Button type="submit" variant="primary" disabled={form.busy}>Show report</Button>
          </div>
          <ActionNote action="daily-report" />
        </form>
        {report && (
          <dl class="facts panel day-facts">
            <dt>Business date</dt><dd><Fig>{formatDate(report.date)}</Fig></dd>
            <dt>Starts</dt><dd><Fig>{desk.when(report.startsAt)}</Fig></dd>
            <dt>Ends</dt><dd><Fig>{desk.when(report.endsAt)}</Fig></dd>
            <dt>Length</dt><dd><Fig>{report.hours} hours</Fig></dd>
            <dt>Transfers</dt><dd><Fig>{report.transfers}</Fig></dd>
          </dl>
        )}
        {report && report.cases.length === 0 && !shown && <p class="panel"><Empty text={`No transfers on ${formatDate(report.date)}.`} /></p>}
        <Table label="Transfers" columns={[{ label: "Reference" }, { label: "Created" }, { label: "Amount", figures: true },
          { label: "Fiat value", figures: true }, { label: "Threshold", figures: true }, { label: "Counterparty" }, { label: "Path" },
          { label: "Status" }]}
          rows={(report?.cases ?? []).map((k) => {
            const id = ids.get(k.reference);
            return {
              key: k.reference,
              cells: [
                id ? <Link href={`${desk.base}/cases/${id}`}><Fig>{k.reference}</Fig></Link> : <Fig>{k.reference}</Fig>,
                <Fig>{desk.when(k.createdAt)}</Fig>,
                <Fig>{formatCrypto(k.asset, k.amount)}</Fig>,
                <Fig>{formatMoney(k.currency, k.fiatValueCents)}</Fig>,
                k.thresholdCents === null ? "No rule" : <Fig>{formatMoney(k.currency, k.thresholdCents)}</Fig>,
                k.counterpartyName ?? "Self-hosted wallet",
                PATH_TEXT[k.path] ?? k.path,
                CASE_STATUS_TEXT[k.status],
              ],
            };
          })} />
      </section>
    </div>
  );
}
