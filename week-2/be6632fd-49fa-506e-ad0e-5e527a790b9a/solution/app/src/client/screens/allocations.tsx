// Allocations (brief: Staff screens → allocations, allocation, invoicing, price lists; Journey 3).
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { staleStart } from "../../shared/copy";
import { amount, copenhagenDateText, counted, dateText, marketTime, money, position } from "../../shared/format";
import { CITY, addDays, copenhagenWall, isoDate } from "../../shared/time";
import { api, serverNow } from "../api";
import { useDraft } from "../drafts";
import { STATE, play } from "../motion";
import { Link } from "../router";
import { useSession } from "../session";
import type { Allocation, StaffDrop, Stockist } from "../types";
import { Button, Dialog, EmptyRow, Field, Loading, type Message, PageTitle, SelectField, StatusRegion, focusLater, refusalMessage, useMessage, wholeOrText } from "../ui";

const STATUS_WORD: Record<Allocation["status"], string> = { requested: "Requested", split: "Split", confirmed: "Confirmed" };

function useStockists(): Stockist[] {
  const [stockists, setStockists] = useState<Stockist[]>([]);
  useEffect(() => {
    void (async () => {
      const all: Stockist[] = [];
      let cursor: string | null = null;
      do {
        const r: Awaited<ReturnType<typeof api<{ items: Stockist[]; nextCursor: string | null }>>> = await api("GET", `/api/stockists?limit=50${cursor ? `&cursor=${cursor}` : ""}`);
        if (!r.ok) break;
        all.push(...r.data.items);
        cursor = r.data.nextCursor;
      } while (cursor);
      setStockists(all);
    })();
  }, []);
  return stockists;
}

/** Quantities typed per style, keyed by style number. */
function QuantityDialog({
  title,
  drop,
  stockists,
  withNote,
  submitLabel,
  pendingLabel,
  draftKey,
  onSubmit,
  onClose,
}: {
  title: string;
  drop: StaffDrop;
  stockists: Stockist[];
  withNote: boolean;
  submitLabel: string;
  pendingLabel: string;
  draftKey: string;
  onSubmit: (body: { stockistId: string; lines: Array<{ styleNumber: string; quantity: number | string }>; internalNote: string }) => Promise<Message | null>;
  onClose: () => void;
}): JSX.Element {
  const draft = useDraft(draftKey, { stockistId: "", quantities: {} as Record<string, string>, internalNote: "" });
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const refusal = await onSubmit({
      stockistId: draft.value.stockistId,
      lines: drop.styles.map((s) => ({ styleNumber: s.styleNumber, quantity: wholeOrText(draft.value.quantities[s.styleNumber] ?? "0") })),
      internalNote: draft.value.internalNote,
    });
    setPending(false);
    if (!refusal) {
      draft.clear();
      return;
    }
    setAlert(refusal.text);
    setAttempt((n) => n + 1);
  };
  return (
    <Dialog title={title} alert={alert} alertKey={attempt} onClose={() => (draft.clear(), onClose())}>
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <SelectField
          id={`${draftKey}-stockist`}
          label="Stockist"
          value={draft.value.stockistId}
          onChange={(stockistId) => draft.set((d) => ({ ...d, stockistId }))}
          options={[["", "Choose a stockist"], ...stockists.map((s): [string, string] => [s.id, s.name])]}
        />
        {drop.styles.map((s) => (
          <Field
            key={s.styleNumber}
            id={`${draftKey}-${s.styleNumber}`}
            label={`${s.styleNumber} quantity`}
            type="number"
            value={draft.value.quantities[s.styleNumber] ?? "0"}
            onChange={(v) => draft.set((d) => ({ ...d, quantities: { ...d.quantities, [s.styleNumber]: v } }))}
          />
        ))}
        {withNote ? <Field id={`${draftKey}-note`} label="Internal note" value={draft.value.internalNote} onChange={(internalNote) => draft.set((d) => ({ ...d, internalNote }))} /> : null}
        <div className="dialog-actions">
          <Button type="submit" variant="primary" pending={pending} pendingText={pendingLabel}>
            {submitLabel}
          </Button>
          <Button onClick={() => (draft.clear(), onClose())}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function refusalText(r: { status: number; message: string; fields: Record<string, string> }): string {
  return r.status === 422 && Object.keys(r.fields).length ? `${r.message} ${Object.values(r.fields).join(" ")}` : r.message;
}

export function DropAllocationsScreen({ id }: { id: string }): JSX.Element {
  const { member } = useSession();
  const [drop, setDrop] = useState<StaffDrop | null>(null);
  const [items, setItems] = useState<Allocation[] | null>(null);
  const [message, setMessage] = useMessage();
  const [dialog, setDialog] = useState<"" | "split" | "enter" | "request">("");
  const [proposal, setProposal] = useState<Array<{ stockistId: string; stockistName: string; lines: Array<{ styleNumber: string; requestedQuantity: number; allocatedQuantity: number }> }> | null>(null);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const openers = { split: useRef<HTMLButtonElement>(null), enter: useRef<HTMLButtonElement>(null), request: useRef<HTMLButtonElement>(null) };
  const listHeading = useRef<HTMLHeadingElement>(null);
  const stockists = useStockists();
  const load = useCallback(async () => {
    const [d, a] = await Promise.all([api<StaffDrop>("GET", `/api/drops/${id}`), api<{ items: Allocation[] }>("GET", `/api/drops/${id}/allocations`)]);
    if (d.ok) setDrop(d.data);
    if (a.ok) setItems(a.data.items);
    else setMessage(refusalMessage(a));
  }, [id, setMessage]);
  useEffect(() => {
    void load();
  }, [load]);
  const close = (which: "split" | "enter" | "request"): void => {
    setDialog("");
    setAlert(null);
    focusLater(() => openers[which].current);
  };
  const openSplit = async (): Promise<void> => {
    setDialog("split");
    setProposal(null);
    setAlert(null);
    const r = await api<{ items: NonNullable<typeof proposal> }>("GET", `/api/drops/${id}/split`);
    if (r.ok) setProposal(r.data.items);
    else {
      setAlert(r.message);
      setAttempt((n) => n + 1);
    }
  };
  const applySplit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage("Splitting…");
    const r = await api<{ items: Allocation[] }>("POST", `/api/drops/${id}/split`);
    setPending(false);
    if (r.ok) {
      setDialog("");
      setItems(r.data.items);
      setMessage(`Split applied to ${counted(r.data.items.length, "stockist")}.`);
      focusLater(() => listHeading.current);
      return;
    }
    setMessage(refusalMessage(r));
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  if (!drop || !items) return <Loading />;
  const merch = member?.role === "merchandiser";
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">
          <Link to="/studio/drops">Drops</Link> · Wholesale
        </p>
        <PageTitle>{`Allocations · ${drop.name}`}</PageTitle>
        <StatusRegion name="Allocation status" message={message} />
      </div>
      {merch ? (
        <div className="toolbar">
          <Button variant="primary" buttonRef={openers.split} onClick={() => void openSplit()}>
            Split edition
          </Button>
          <Button buttonRef={openers.enter} onClick={() => setDialog("enter")}>
            Enter allocation
          </Button>
          <Button buttonRef={openers.request} onClick={() => setDialog("request")}>
            Record request
          </Button>
        </div>
      ) : null}
      <section className="panel">
        <h2 tabIndex={-1} ref={listHeading}>
          Allocations
        </h2>
        <p className="muted">Each style shows requested / allocated pieces.</p>
        <div className="table-scroll" tabIndex={0}>
          <table aria-label="Allocations" className="ruled">
            <thead>
              <tr>
                <th scope="col">Stockist</th>
                <th scope="col">Status</th>
                {drop.styles.map((s) => (
                  <th scope="col" key={s.styleNumber} className="num">
                    {s.styleNumber}
                  </th>
                ))}
                <th scope="col">Requested at</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? <EmptyRow columns={drop.styles.length + 3} /> : null}
              {items.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    <Link to={`/studio/allocations/${a.id}`}>{a.stockistName}</Link>
                  </th>
                  <td>{STATUS_WORD[a.status]}</td>
                  {drop.styles.map((s) => {
                    const line = a.lines.find((l) => l.styleNumber === s.styleNumber);
                    return (
                      <td key={s.styleNumber} className="mono num">
                        {position(line?.requestedQuantity ?? 0, line?.allocatedQuantity ?? 0)}
                      </td>
                    );
                  })}
                  <td className="mono">{a.requestedAt ? marketTime(Date.parse(a.requestedAt)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {dialog === "split" ? (
        <Dialog title="Split edition" alert={alert} alertKey={attempt} onClose={() => close("split")}>
          <p>Shares are proportional to each request, rounded down; leftover pieces go one each by largest remainder, ties to the earliest request.</p>
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="Proposed split" className="ruled">
              <thead>
                <tr>
                  <th scope="col">Stockist</th>
                  {drop.styles.map((s) => (
                    <th scope="col" key={s.styleNumber} className="num">
                      {s.styleNumber}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!proposal || proposal.length === 0 ? <EmptyRow columns={drop.styles.length + 1} /> : null}
                {proposal?.map((row) => (
                  <tr key={row.stockistId}>
                    <th scope="row">{row.stockistName}</th>
                    {drop.styles.map((s) => {
                      const line = row.lines.find((l) => l.styleNumber === s.styleNumber);
                      return (
                        <td key={s.styleNumber} className="mono num">
                          {line ? `${line.requestedQuantity} → ${line.allocatedQuantity}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dialog-actions">
            <Button variant="primary" pending={pending} pendingText="Splitting…" disabled={!proposal} onClick={() => void applySplit()}>
              Apply split
            </Button>
            <Button onClick={() => close("split")}>Cancel</Button>
          </div>
        </Dialog>
      ) : null}
      {dialog === "enter" ? (
        <QuantityDialog
          title="Enter allocation"
          drop={drop}
          stockists={stockists}
          withNote
          submitLabel="Save allocation"
          pendingLabel="Saving allocation…"
          draftKey="enter-allocation"
          onClose={() => close("enter")}
          onSubmit={async (body) => {
            setMessage("Saving allocation…");
            const r = await api<Allocation>("POST", "/api/allocations", { dropId: drop.id, ...body });
            if (!r.ok) {
              setMessage(refusalMessage(r));
              return { text: refusalText(r) };
            }
            setMessage("Allocation saved.");
            await load();
            close("enter");
            return null;
          }}
        />
      ) : null}
      {dialog === "request" ? (
        <QuantityDialog
          title="Record request"
          drop={drop}
          stockists={stockists}
          withNote={false}
          submitLabel="Save request"
          pendingLabel="Saving request…"
          draftKey="record-request"
          onClose={() => close("request")}
          onSubmit={async ({ stockistId, lines }) => {
            setMessage("Saving request…");
            const r = await api<Allocation>("POST", `/api/drops/${drop.id}/requests`, { stockistId, lines });
            if (!r.ok) {
              setMessage(refusalMessage(r));
              return { text: refusalText(r) };
            }
            setMessage("Request saved.");
            await load();
            close("request");
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

function PricedCells({ value, currency, label }: { value: number | null; currency: string; label?: string }): JSX.Element {
  return (
    <td className="mono num" data-label={label}>
      {value === null ? "—" : money(value, currency)}
    </td>
  );
}

export function AllocationScreen({ id }: { id: string }): JSX.Element {
  const { member } = useSession();
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [missing, setMissing] = useState(false);
  const draft = useDraft("allocation", { quantities: {} as Record<string, string>, internalNote: null as string | null });
  const [message, setMessage] = useMessage();
  const [invoicing, setInvoicing] = useState<Message | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quote, setQuote] = useState<Allocation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const load = useCallback(async () => {
    const r = await api<Allocation>("GET", `/api/allocations/${id}`);
    if (r.ok) setAllocation(r.data);
    else setMissing(true);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (missing) return <p className="panel">This allocation can't be found.</p>;
  if (!allocation) return <Loading />;
  const merch = member?.role === "merchandiser";
  const finance = member?.role === "finance_lead";
  const quantity = (styleNumber: string, saved: number): string => draft.value.quantities[styleNumber] ?? String(saved);
  const note = draft.value.internalNote ?? allocation.internalNote;
  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setMessage("Saving allocation…");
    const body = {
      version: allocation.version,
      lines: allocation.lines.map((l) => ({ styleNumber: l.styleNumber, quantity: wholeOrText(quantity(l.styleNumber, l.allocatedQuantity)) })),
      internalNote: note,
    };
    const optimistic = { ...allocation, lines: allocation.lines.map((l) => ({ ...l, allocatedQuantity: Number(quantity(l.styleNumber, l.allocatedQuantity)) || 0 })) };
    setAllocation(optimistic);
    const r = await api<Allocation>("PATCH", `/api/allocations/${id}`, body);
    setSaving(false);
    if (r.ok) {
      draft.clear();
      setAllocation(r.data);
      setMessage("Allocation saved.");
      return;
    }
    if (r.status === 412) {
      const current = r.extra.current as Allocation;
      draft.clear();
      setAllocation(current);
      for (const el of inputs.current.values()) play(el, [{ transform: "translateY(-6px)", opacity: 0.5 }, { transform: "translateY(0)", opacity: 1 }], STATE);
      setMessage(`${staleStart(String(r.extra.savedBy), marketTime(Date.parse(String(r.extra.savedAt))))} Showing their version.`);
      return;
    }
    setAllocation(allocation);
    setMessage(r.status === 422 ? { text: refusalText(r) } : refusalMessage(r));
  };
  const openConfirm = async (): Promise<void> => {
    setConfirmOpen(true);
    setAlert(null);
    setQuote(null);
    const r = await api<Allocation>("GET", `/api/allocations/${id}/quote`);
    if (r.ok) setQuote(r.data);
    else {
      setAlert(r.message);
      setAttempt((n) => n + 1);
    }
  };
  const confirmAllocation = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setConfirming(true);
    setInvoicing({ text: "Confirming…" });
    const r = await api<Allocation>("POST", `/api/allocations/${id}/confirm`, { version: allocation.version });
    inFlight.current = false;
    setConfirming(false);
    if (r.ok) {
      setAllocation(r.data);
      setConfirmOpen(false);
      setInvoicing({ text: `Allocation confirmed. Invoice ${r.data.invoiceNumber ?? ""} created; the confirmation email is on its way.` });
      focusLater(() => document.querySelector<HTMLElement>("main h1"));
      return;
    }
    setInvoicing(r.code === "allocation_confirmed" ? { text: "This allocation was already confirmed." } : refusalMessage(r));
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  const today = isoDate(copenhagenWall(serverNow()));
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">
          <Link to={`/studio/drops/${allocation.dropId}/allocations`}>{allocation.dropName}</Link> · {STATUS_WORD[allocation.status]}
          {allocation.invoiceNumber ? ` · Invoice ${allocation.invoiceNumber}` : ""}
        </p>
        <PageTitle>{`Allocation · ${allocation.stockistName}`}</PageTitle>
        <StatusRegion name="Allocation status" message={message} />
        <StatusRegion name="Invoicing status" message={invoicing} />
      </div>
      <div className="split-2">
        <section className="panel">
          <h2>Allocation lines</h2>
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="Allocation lines" className="ruled cards-on-phone">
              <thead>
                <tr>
                  <th scope="col">Style</th>
                  <th scope="col" className="num">Requested</th>
                  <th scope="col" className="num">Allocated</th>
                  <th scope="col" className="num">Unit price</th>
                  <th scope="col" className="num">Net</th>
                  <th scope="col" className="num">VAT</th>
                  <th scope="col" className="num">Line total</th>
                </tr>
              </thead>
              <tbody>
                {allocation.lines.length === 0 ? <EmptyRow columns={7} /> : null}
                {allocation.lines.map((l) => (
                  <tr key={l.styleNumber}>
                    <th scope="row">
                      <span className="mono">{l.styleNumber}</span> {l.styleName}
                    </th>
                    <td className="mono num" data-label="Requested">{l.requestedQuantity}</td>
                    <td className="num" data-label="Allocated">
                      {merch && allocation.status !== "confirmed" ? (
                        <input
                          className="qty"
                          type="number"
                          aria-label={`${l.styleNumber} allocated`}
                          ref={(el) => {
                            if (el) inputs.current.set(l.styleNumber, el);
                          }}
                          value={quantity(l.styleNumber, l.allocatedQuantity)}
                          onChange={(e) => draft.set((d) => ({ ...d, quantities: { ...d.quantities, [l.styleNumber]: e.target.value } }))}
                        />
                      ) : (
                        <span className="mono">{l.allocatedQuantity}</span>
                      )}
                    </td>
                    <PricedCells value={l.unitPriceMinor} currency={allocation.currency} label="Unit price" />
                    <PricedCells value={l.netMinor} currency={allocation.currency} label="Net" />
                    <PricedCells value={l.vatMinor} currency={allocation.currency} label="VAT" />
                    <PricedCells value={l.lineTotalMinor} currency={allocation.currency} label="Line total" />
                  </tr>
                ))}
              </tbody>
              {allocation.totalMinor !== null ? (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={6}>
                      Total
                    </th>
                    <td className="mono num">{money(allocation.totalMinor, allocation.currency)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          {allocation.priceListEffectiveDate ? <p className="muted mono">Price list from {copenhagenDateText(allocation.priceListEffectiveDate)}</p> : null}
        </section>
        <section className="panel stack">
          <h2>Details</h2>
          <dl className="facts">
            <div>
              <dt>Market and currency</dt>
              <dd>
                {CITY[allocation.market]} · {allocation.currency}
              </dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{allocation.contactName ?? "—"}</dd>
            </div>
            <div>
              <dt>Last saved</dt>
              <dd className="mono">
                {allocation.savedBy}, {marketTime(Date.parse(allocation.savedAt))}
              </dd>
            </div>
          </dl>
          {merch && allocation.status !== "confirmed" ? (
            <Field id="allocation-note" label="Internal note" multiline rows={3} value={note} onChange={(internalNote) => draft.set((d) => ({ ...d, internalNote }))} />
          ) : (
            <p className="muted">{note ? `Internal note: ${note}` : "No internal note."}</p>
          )}
          {allocation.status !== "confirmed" && (merch || finance) ? (
            <div className="sticky-bar phone-only-sticky" data-sticky-bar>
              {merch ? (
                <Button variant="primary" pending={saving} pendingText="Saving allocation…" onClick={() => void save()}>
                  Save allocation
                </Button>
              ) : null}
              {finance ? (
                <Button variant="primary" buttonRef={confirmButton} onClick={() => void openConfirm()}>
                  Confirm allocation
                </Button>
              ) : null}
            </div>
          ) : null}
          <a className="btn btn-secondary" href={`/api/allocations/${allocation.id}/line-sheet.csv`} download>
            Download line sheet
          </a>
        </section>
      </div>
      {confirmOpen ? (
        <Dialog
          title="Confirm allocation"
          alert={alert}
          alertKey={attempt}
          onClose={() => {
            setConfirmOpen(false);
            focusLater(() => confirmButton.current);
          }}
        >
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="Quote" className="ruled">
              <thead>
                <tr>
                  <th scope="col">Style</th>
                  <th scope="col" className="num">Quantity</th>
                  <th scope="col" className="num">Unit price</th>
                  <th scope="col" className="num">VAT</th>
                  <th scope="col" className="num">Line total</th>
                </tr>
              </thead>
              <tbody>
                {!quote ? <EmptyRow columns={5} /> : null}
                {quote?.lines
                  .filter((l) => l.allocatedQuantity > 0)
                  .map((l) => (
                    <tr key={l.styleNumber}>
                      <th scope="row">
                        <span className="mono">{l.styleNumber}</span> {l.styleName}
                      </th>
                      <td className="mono num">{l.allocatedQuantity}</td>
                      <PricedCells value={l.unitPriceMinor} currency={quote.currency} />
                      <PricedCells value={l.vatMinor} currency={quote.currency} />
                      <PricedCells value={l.lineTotalMinor} currency={quote.currency} />
                    </tr>
                  ))}
              </tbody>
              {quote?.totalMinor !== null && quote ? (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4}>
                      Total
                    </th>
                    <td className="mono num">{money(quote.totalMinor ?? 0, quote.currency)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <p className="mono">{`Prices from the list in force on ${copenhagenDateText(today)}`}</p>
          <div className="dialog-actions">
            <Button variant="primary" pending={confirming} pendingText="Confirming…" onClick={() => void confirmAllocation()}>
              Confirm and invoice
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                focusLater(() => confirmButton.current);
              }}
            >
              Cancel
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

export function InvoicingScreen(): JSX.Element {
  const [ready, setReady] = useState<Allocation[] | null>(null);
  const [confirmed, setConfirmed] = useState<Allocation[] | null>(null);
  const [message, setMessage] = useMessage();
  useEffect(() => {
    void Promise.all([api<{ items: Allocation[] }>("GET", "/api/allocations?status=split"), api<{ items: Allocation[] }>("GET", "/api/allocations?status=confirmed")]).then(([a, b]) => {
      if (a.ok) setReady(a.data.items);
      else setMessage(refusalMessage(a));
      if (b.ok) setConfirmed(b.data.items);
    });
  }, [setMessage]);
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">Finance</p>
        <PageTitle>Invoicing</PageTitle>
        <StatusRegion name="Invoicing status" message={message} />
      </div>
      <div className="split-2">
        <section className="panel">
          <h2>Ready to confirm</h2>
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="Ready to confirm" className="ruled">
              <thead>
                <tr>
                  <th scope="col">Stockist</th>
                  <th scope="col">Drop</th>
                  <th scope="col" className="num">Pieces</th>
                  <th scope="col">Saved</th>
                </tr>
              </thead>
              <tbody>
                {ready?.length === 0 ? <EmptyRow columns={4} /> : null}
                {ready?.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      <Link to={`/studio/allocations/${a.id}`}>{a.stockistName}</Link>
                    </th>
                    <td>{a.dropName}</td>
                    <td className="mono num">{a.lines.reduce((n, l) => n + l.allocatedQuantity, 0)}</td>
                    <td className="mono">{marketTime(Date.parse(a.savedAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2>Confirmed allocations</h2>
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="Confirmed allocations" className="ruled">
              <thead>
                <tr>
                  <th scope="col">Stockist</th>
                  <th scope="col">Drop</th>
                  <th scope="col">Invoice</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {confirmed?.length === 0 ? <EmptyRow columns={5} /> : null}
                {confirmed?.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      <Link to={`/studio/allocations/${a.id}`}>{a.stockistName}</Link>
                    </th>
                    <td>{a.dropName}</td>
                    <td className="mono">{a.invoiceNumber}</td>
                    <td className="mono num">{a.totalMinor === null ? "—" : money(a.totalMinor, a.currency)}</td>
                    <td className="mono">{a.confirmedAt ? marketTime(Date.parse(a.confirmedAt)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

interface PriceList {
  id: string;
  name: string;
  effectiveDate: string;
  prices: Array<{ styleNumber: string; currency: string; unitPriceMinor: number }>;
  inForce: boolean;
}

/** `MV-2701 DKK 1,234.50` → its parts, with the amount turned into minor units by string arithmetic. */
function parsePriceLine(line: string): { styleNumber: string; currency: string; unitPriceMinor: number | string } | null {
  const m = /^(\S+)\s+([A-Za-z]{3})\s+([\d,]+)(?:\.(\d{1,2}))?$/.exec(line.trim());
  if (!m || !/^\d{1,3}(,\d{3})*$|^\d+$/.test(m[3])) return null;
  const currency = m[2].toUpperCase();
  const whole = Number(m[3].replace(/,/g, ""));
  if (currency === "JPY") return m[4] ? null : { styleNumber: m[1], currency, unitPriceMinor: whole };
  return { styleNumber: m[1], currency, unitPriceMinor: whole * 100 + Number((m[4] ?? "0").padEnd(2, "0")) };
}

export function PriceListsScreen(): JSX.Element {
  const { member } = useSession();
  const [lists, setLists] = useState<PriceList[] | null>(null);
  const [message, setMessage] = useMessage();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const tomorrow = isoDate(addDays(copenhagenWall(serverNow()), 1));
  const draft = useDraft("add-price-list", { name: "", effectiveDate: tomorrow, prices: "" });
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const r = await api<{ items: PriceList[] }>("GET", "/api/price-lists");
    if (r.ok) setLists(r.data.items);
    else setMessage(refusalMessage(r));
  }, [setMessage]);
  useEffect(() => {
    void load();
  }, [load]);
  const close = (): void => {
    setOpen(false);
    setAlert(null);
    setErrors({});
    focusLater(() => opener.current);
  };
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const lines = draft.value.prices.split(/\r?\n/).filter((l) => l.trim());
    const parsed = lines.map(parsePriceLine);
    const bad = parsed.findIndex((p) => p === null);
    if (bad >= 0) {
      setErrors({ prices: `Line ${bad + 1}: write each price as <style number> <currency> <amount>, such as MV-2701 DKK 1,234.50.` });
      setAlert("There is 1 problem. Fix it and try again.");
      setAttempt((n) => n + 1);
      return;
    }
    setPending(true);
    setMessage("Saving price list…");
    const r = await api<PriceList>("POST", "/api/price-lists", { name: draft.value.name, effectiveDate: draft.value.effectiveDate.trim(), prices: parsed });
    setPending(false);
    if (r.ok) {
      draft.clear();
      setMessage(`Price list saved. It applies from ${dateText({ year: Number(r.data.effectiveDate.slice(0, 4)), month: Number(r.data.effectiveDate.slice(5, 7)), day: Number(r.data.effectiveDate.slice(8, 10)) })}.`);
      await load();
      close();
      return;
    }
    setErrors({
      name: r.fields.name ?? "",
      effectiveDate: r.fields.effectiveDate ?? "",
      prices: Object.entries(r.fields)
        .filter(([k]) => k.startsWith("prices"))
        .map(([k, v]) => (k === "prices" ? v : `Line ${Number(k.split(".")[1]) + 1}: ${v}`))
        .join(" "),
    });
    setMessage(refusalMessage(r));
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  return (
    <div className="screen">
      <div className="screen-head with-action">
        <div>
          <p className="eyebrow">Wholesale</p>
          <PageTitle>Price lists</PageTitle>
        </div>
        {member?.role === "finance_lead" ? (
          <Button variant="primary" buttonRef={opener} onClick={() => setOpen(true)}>
            Add price list
          </Button>
        ) : null}
      </div>
      <StatusRegion name="Price list status" message={message} />
      <section className="panel">
        <div className="table-scroll" tabIndex={0}>
          <table aria-label="Price lists" className="ruled">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Effective from</th>
                <th scope="col">Prices</th>
                <th scope="col">In force</th>
              </tr>
            </thead>
            <tbody>
              {!lists ? (
                <tr className="empty-row">
                  <td colSpan={4}>
                    <Loading />
                  </td>
                </tr>
              ) : null}
              {lists?.length === 0 ? <EmptyRow columns={4} /> : null}
              {lists?.map((l) => (
                <tr key={l.id}>
                  <th scope="row">{l.name}</th>
                  <td className="mono">{copenhagenDateText(l.effectiveDate)}</td>
                  <td className="mono price-cell">{l.prices.map((p) => `${p.styleNumber} ${p.currency} ${amount(p.unitPriceMinor, p.currency)}`).join(" · ")}</td>
                  <td>{l.inForce ? <span className="tag tag-accent">In force</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {open ? (
        <Dialog title="Add price list" alert={alert} alertKey={attempt} onClose={() => (draft.clear(), close())}>
          <form onSubmit={(e) => void submit(e)} noValidate className="stack">
            <Field id="pl-name" label="Name" value={draft.value.name} onChange={(name) => draft.set((d) => ({ ...d, name }))} error={errors.name || undefined} />
            <Field id="pl-date" label="Effective date" hint="YYYY-MM-DD, Copenhagen" value={draft.value.effectiveDate} onChange={(effectiveDate) => draft.set((d) => ({ ...d, effectiveDate }))} error={errors.effectiveDate || undefined} />
            <Field
              id="pl-prices"
              label="Prices"
              hint="One per line: <style number> <currency> <amount>, such as MV-2701 DKK 1,234.50"
              multiline
              rows={6}
              value={draft.value.prices}
              onChange={(prices) => draft.set((d) => ({ ...d, prices }))}
              error={errors.prices || undefined}
            />
            <div className="dialog-actions">
              <Button type="submit" variant="primary" pending={pending} pendingText="Saving price list…">
                Save price list
              </Button>
              <Button onClick={() => (draft.clear(), close())}>Cancel</Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
