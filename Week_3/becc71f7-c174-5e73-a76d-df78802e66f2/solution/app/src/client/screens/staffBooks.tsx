// Payout runs, the old spreadsheet and the sales book: month-end and bookkeeping.
import { useRef, useState, type ChangeEvent } from "react";
import { Download } from "lucide-react";
import { addMonths, brusselsMonth } from "../../shared/brussels";
import type { ImportPreview, ImportSaved, Run, RunSummary, SalesMonth } from "../../shared/api";
import type { Role } from "../../shared/catalog";
import { formatDateTime, formatIban, formatMoney, formatMonth } from "../../shared/format";
import { api, ApiFailure, request, serverClock } from "../api";
import { useAction, useDialog, useFields, usePoll, type DialogControl } from "../hooks";
import { announce, focusHeading, navigate, setQuery, useAddress } from "../state";
import { MainAction } from "../ui/bars";
import { Dialog } from "../ui/Dialog";
import { DialogForm, Empty, Heading, Link, NotFound, Problems, SelectField, Skeleton, TableFrame } from "../ui/kit";

const MONTHS_BACK = 36;

/** The months up to the server's current one, newest first; the device clock plays no part. */
function monthsBack(firstOffset: number): { value: string; label: string }[] {
  const current = brusselsMonth(serverClock() ?? new Date(0));
  return Array.from({ length: MONTHS_BACK }, (_, index) => {
    const value = addMonths(current, -index - firstOffset);
    return { value, label: formatMonth(value) };
  });
}

function openerRef(control: DialogControl) {
  return (element: HTMLButtonElement | null): void => {
    control.opener.current = element;
  };
}

function StartRunForm({ control }: { control: DialogControl }) {
  const action = useAction();
  const form = useFields(control.name, { month: "" });
  const months = monthsBack(1);
  const submit = async (): Promise<void> => {
    const response = await request("/api/payout-runs", { method: "POST", json: { month: form.values.month } });
    const { run } = (await response.json()) as { run: Run };
    if (response.status === 200) throw new ApiFailure(200, "already_started", `This payout run was already started by ${run.startedBy.name} at ${formatDateTime(run.startedAt)}.`);
    announce(`Payout run for ${formatMonth(run.month)} is ready.`);
    control.close({ returnFocus: false });
    focusHeading({ afterNavigation: true });
    navigate(`/staff/payouts/${run.month}`);
  };
  return (
    <DialogForm action={action} submit="Start run" onSubmit={submit} onCancel={() => control.close()}>
      <SelectField form={form} action={action} name="month" label="Month" options={months} placeholder="Choose a month" />
    </DialogForm>
  );
}

export function PayoutsScreen({ role }: { role: Role }) {
  const poll = usePoll(() => api<{ runs: RunSummary[] }>("/api/payout-runs"), "runs");
  const start = useDialog("Start payout run");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const runs = poll.data?.runs ?? null;
  const selected = runs?.find((run) => run.month === selectedMonth) ?? runs?.[0];
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>Payout runs</Heading>
        {role === "owner" && (
          <MainAction>
            <button ref={openerRef(start)} type="button" className="button primary" onClick={start.open}>
              Start payout run
            </button>
          </MainAction>
        )}
      </div>
      <div className="split">
        <div className="split-main">
          {runs === null ? (
            <Skeleton />
          ) : (
            <TableFrame name="Payout runs">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started by</th>
                  <th scope="col" className="amount">Paid</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.month} className={run.month === selected?.month ? "selected" : undefined}>
                    <td>
                      <Link to={`/staff/payouts/${run.month}`}>{formatMonth(run.month)}</Link>
                    </td>
                    <td>Ready</td>
                    <td>{run.startedBy.name}</td>
                    <td className="amount num">{formatMoney(run.controlSumCents)}</td>
                    <td>
                      <button type="button" className="row-button" aria-pressed={run.month === selected?.month} aria-label={`Show ${formatMonth(run.month)}`} onClick={() => setSelectedMonth(run.month)}>
                        Show
                      </button>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No payout run has started yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </TableFrame>
          )}
        </div>
        <aside className="detail" aria-label="Selected payout run">
          {selected ? (
            <>
              <h2>{formatMonth(selected.month)}</h2>
              <p className="num">Started by {selected.startedBy.name} at {formatDateTime(selected.startedAt)}</p>
              <p className="num">{formatMoney(selected.controlSumCents)} paid</p>
              <Link to={`/staff/payouts/${selected.month}`}>Open this run</Link>
            </>
          ) : (
            <Empty title="Runs appear here once a month has ended and been started." />
          )}
        </aside>
      </div>
      <Dialog control={start}>
        <StartRunForm control={start} />
      </Dialog>
    </main>
  );
}

export function PayoutRunScreen({ month }: { month: string }) {
  const poll = usePoll(() => api<{ run: Run }>(`/api/payout-runs/${month}`), month);
  const run = poll.data?.run;
  if (poll.failure) return <NotFound />;
  return (
    <main className="page">
      {run ? (
        <>
          <div className="screen-head">
            <Heading>{`Payout run ${formatMonth(run.month)}`}</Heading>
            <MainAction>
              <a className="button primary" href={`/api/payout-runs/${run.month}/file`} download>
                <Download aria-hidden="true" size={18} /> Download bank file
              </a>
            </MainAction>
          </div>
          <p className="status-line">
            <span>Ready</span>
          </p>
          <p className="muted num">
            Started by {run.startedBy.name} at {formatDateTime(run.startedAt)}. {formatMoney(run.controlSumCents)} paid.
          </p>
          <TableFrame name="Payouts">
            <thead>
              <tr>
                <th scope="col">Payout</th>
                <th scope="col">Consignor</th>
                <th scope="col">IBAN</th>
                <th scope="col">Status</th>
                <th scope="col" className="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              {run.payouts.map((payout) => (
                <tr key={payout.id}>
                  <td className="num nowrap">{payout.id}</td>
                  <td>{payout.consignorName}</td>
                  <td className="num nowrap">{payout.iban ? formatIban(payout.iban) : "None"}</td>
                  <td>{payout.reason ?? "Paid"}</td>
                  <td className="amount num">{formatMoney(payout.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </>
      ) : (
        <Skeleton />
      )}
    </main>
  );
}

function PreviewForm({ file, preview, control }: { file: File; preview: ImportPreview; control: DialogControl }) {
  const action = useAction();
  const submit = async (): Promise<void> => {
    const saved = await api<ImportSaved>("/api/imports", { method: "POST", body: file, headers: { "Content-Type": "text/csv" } });
    announce(`Saved: ${saved.piecesCreated} pieces and ${saved.consignorsCreated} new consignors brought over.`);
    control.close();
  };
  return (
    <DialogForm action={action} submit="Save" onSubmit={submit} onCancel={() => control.close()}>
      <TableFrame name="Rows">
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Item</th>
            <th scope="col">Status</th>
            <th scope="col">Consignor</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={row.row}>
              <td className="num">{row.row}</td>
              <td className="num">{row.itemNo}</td>
              <td>{{ matched: "Matched", new: "New", refused: "Refused", already: "Already brought over" }[row.status]}</td>
              <td>{row.consignorName}</td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </DialogForm>
  );
}

export function ImportScreen() {
  const action = useAction();
  const dialog = useDialog("Preview import");
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{ file: File; preview: ImportPreview } | null>(null);
  const onChoose = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void action.run(async () => {
      const preview = await api<ImportPreview>("/api/imports/preview", { method: "POST", body: file, headers: { "Content-Type": "text/csv" } });
      const { matched, new: fresh, refused, already } = preview.counts;
      setChosen({ file, preview });
      announce(`Preview ready: ${matched} matched, ${fresh} new, ${refused} refused, ${already} already brought over.`);
      dialog.open();
    });
  };
  return (
    <main className="page narrow">
      <Heading>Old spreadsheet</Heading>
      <p>Bring consignors and pieces over from the previous tool. You see a preview of every row before anything is saved, and saving the same file again changes nothing.</p>
      <p className="hint">Use a CSV file with the previous tool&apos;s twelve columns.</p>
      <Problems action={action} />
      <label className="visually-hidden">
        Spreadsheet file
        <input ref={input} className="visually-hidden" type="file" tabIndex={-1} accept=".csv,text/csv" onChange={onChoose} />
      </label>
      <MainAction>
        <button
          ref={(element) => {
            dialog.opener.current = element;
          }}
          type="button"
          className="button primary"
          disabled={action.pending}
          onClick={() => input.current?.click()}
        >
          {action.pending ? "Working…" : "Choose file"}
        </button>
      </MainAction>
      {chosen && (
        <Dialog control={dialog} wide>
          <PreviewForm file={chosen.file} preview={chosen.preview} control={dialog} />
        </Dialog>
      )}
    </main>
  );
}

function DownloadForm({ month, control }: { month: string; control: DialogControl }) {
  const action = useAction();
  const submit = async (): Promise<void> => {
    const response = await request(`/api/sales-book?month=${month}`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-book-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    announce(`Sales book for ${formatMonth(month)} downloaded.`);
    control.close();
  };
  return (
    <DialogForm action={action} submit="Download" onSubmit={submit} onCancel={() => control.close()}>
      <p>The sales book for {formatMonth(month)}, as a CSV file.</p>
    </DialogForm>
  );
}

export function SalesBookScreen() {
  const { search } = useAddress();
  const current = brusselsMonth(serverClock() ?? new Date(0));
  const month = new URLSearchParams(search).get("month") ?? current;
  const poll = usePoll(() => api<SalesMonth>(`/api/sales?month=${month}`), month);
  const download = useDialog("Download sales book");
  const action = useAction();
  const form = { values: { month }, set: (_name: "month", value: string) => setQuery(`/staff/sales-book?month=${value}`) };
  const months = monthsBack(0);
  const options = months.some((option) => option.value === month) ? months : [{ value: month, label: formatMonth(month) }, ...months];
  const data = poll.data;
  if (poll.failure) return <NotFound />;
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>Sales book</Heading>
        <MainAction>
          <button ref={openerRef(download)} type="button" className="button primary" onClick={download.open}>
            Download sales book
          </button>
        </MainAction>
      </div>
      <div className="month-picker">
        <SelectField form={form} action={action} name="month" label="Month" options={options} />
      </div>
      {data ? (
        <TableFrame name="Sales book">
          <thead>
            <tr>
              <th scope="col">Sale date</th>
              <th scope="col">Tag code</th>
              <th scope="col">Description</th>
              <th scope="col">Consignor</th>
              <th scope="col" className="amount">Sale price</th>
              <th scope="col" className="amount">Consignor share</th>
              <th scope="col" className="amount">Commission</th>
              <th scope="col" className="amount">VAT</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.saleId}>
                <td className="num nowrap">
                  <Link to={`/staff/sales/${line.saleId}`}>{formatDateTime(line.soldAt)}</Link>
                </td>
                <td className="num nowrap">{line.tagCode}</td>
                <td>{line.description}</td>
                <td>{line.consignorName}</td>
                <td className="amount num">{formatMoney(line.priceCents)}</td>
                <td className="amount num">{formatMoney(line.consignorShareCents)}</td>
                <td className="amount num">{formatMoney(line.commissionCents)}</td>
                <td className="amount num">{formatMoney(line.vatCents)}</td>
              </tr>
            ))}
            {data.lines.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No sales in {formatMonth(month)}.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>
                Total
              </th>
              <td className="amount num">{formatMoney(data.totals.priceCents)}</td>
              <td className="amount num">{formatMoney(data.totals.consignorShareCents)}</td>
              <td className="amount num">{formatMoney(data.totals.commissionCents)}</td>
              <td className="amount num">{formatMoney(data.totals.vatCents)}</td>
            </tr>
          </tfoot>
        </TableFrame>
      ) : (
        <Skeleton />
      )}
      <Dialog control={download}>
        <DownloadForm month={month} control={download} />
      </Dialog>
    </main>
  );
}
