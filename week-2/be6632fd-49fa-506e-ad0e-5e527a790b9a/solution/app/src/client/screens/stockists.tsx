// The stockist directory and a stockist's page (brief: Staff screens → stockists; Journey 6).
import { Download, Plus } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { COPY } from "../../shared/copy";
import { money } from "../../shared/format";
import { CITY, MARKETS } from "../../shared/time";
import { api } from "../api";
import { useDraft } from "../drafts";
import { Link } from "../router";
import { useSession } from "../session";
import type { Allocation, Stockist } from "../types";
import { Button, Dialog, EmptyRow, Field, Loading, type Message, PageTitle, SelectField, StatusRegion, focusLater, refusalMessage, useMessage } from "../ui";

interface Page {
  items: Stockist[];
  nextCursor: string | null;
}

const EMPTY_STOCKIST = { name: "", market: "copenhagen", contactName: "", contactEmail: "", contactPhone: "", notes: "" };

function AddStockistDialog({ onClose, onAdded, announce }: { onClose: () => void; onAdded: () => void; announce: (m: Message | string) => void }): JSX.Element {
  const draft = useDraft("add-stockist", EMPTY_STOCKIST);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const v = draft.value;
  const set = (patch: Partial<typeof EMPTY_STOCKIST>): void => draft.set((d) => ({ ...d, ...patch }));
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    announce("Saving stockist…");
    const r = await api<Stockist>("POST", "/api/stockists", v);
    setPending(false);
    if (r.ok) {
      draft.clear();
      announce("Stockist added.");
      onAdded();
      return;
    }
    const m = refusalMessage(r);
    announce(m);
    setErrors(r.fields);
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  return (
    <Dialog title="Add stockist" alert={alert} alertKey={attempt} onClose={() => (draft.clear(), onClose())}>
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <Field id="stockist-name" label="Name" value={v.name} onChange={(name) => set({ name })} error={errors.name} />
        <SelectField id="stockist-market" label="Market" value={v.market} onChange={(market) => set({ market })} options={MARKETS.map((m): [string, string] => [m, CITY[m]])} error={errors.market} />
        <Field id="stockist-contact" label="Contact name" value={v.contactName} onChange={(contactName) => set({ contactName })} error={errors.contactName} />
        <Field id="stockist-email" label="Contact email" type="email" value={v.contactEmail} onChange={(contactEmail) => set({ contactEmail })} error={errors.contactEmail} />
        <Field id="stockist-phone" label="Contact phone" type="tel" value={v.contactPhone} onChange={(contactPhone) => set({ contactPhone })} error={errors.contactPhone} />
        <Field id="stockist-notes" label="Notes" multiline rows={2} value={v.notes} onChange={(notes) => set({ notes })} error={errors.notes} />
        <div className="dialog-actions">
          <Button type="submit" variant="primary" pending={pending} pendingText="Saving stockist…">
            Save stockist
          </Button>
          <Button onClick={() => (draft.clear(), onClose())}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function contact(s: Stockist): string {
  return s.contactErased ? COPY.erased : [s.contactName, s.contactEmail].filter(Boolean).join(" · ") || "—";
}

export function StockistsScreen(): JSX.Element {
  const { member } = useSession();
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  const [items, setItems] = useState<Stockist[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [archived, setArchived] = useState<Stockist[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useMessage();
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "archive" | "restore"; stockist: Stockist } | null>(null);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const merch = member?.role === "merchandiser";
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(query.trim()), 333);
    return () => clearTimeout(timer);
  }, [query]);
  const load = useCallback(async () => {
    const q = settled ? `&q=${encodeURIComponent(settled)}` : "";
    const r = await api<Page>("GET", `/api/stockists?limit=25${q}`);
    if (r.ok) {
      setItems(r.data.items);
      setCursor(r.data.nextCursor);
    } else setMessage(refusalMessage(r));
    if (showArchived) {
      const a = await api<Page>("GET", `/api/stockists?limit=50&archived=true${q}`);
      if (a.ok) setArchived(a.data.items);
    }
  }, [settled, showArchived, setMessage]);
  useEffect(() => {
    void load();
  }, [load]);
  const more = async (): Promise<void> => {
    if (!cursor) return;
    const q = settled ? `&q=${encodeURIComponent(settled)}` : "";
    const r = await api<Page>("GET", `/api/stockists?limit=25&cursor=${encodeURIComponent(cursor)}${q}`);
    if (r.ok) {
      setItems((list) => [...(list ?? []), ...r.data.items]);
      setCursor(r.data.nextCursor);
    }
  };
  const close = (target?: () => HTMLElement | null): void => {
    setDialog(null);
    setAlert(null);
    focusLater(target ?? (() => opener.current));
  };
  const act = async (kind: "archive" | "restore", stockist: Stockist): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage(kind === "archive" ? "Archiving…" : "Restoring…");
    const r = await api<Stockist>("POST", `/api/stockists/${stockist.id}/${kind}`);
    setPending(false);
    if (r.ok) {
      setMessage(kind === "archive" ? "Stockist archived." : "Stockist restored.");
      await load();
      close(() => document.querySelector<HTMLElement>("main h1"));
      return;
    }
    setMessage(refusalMessage(r));
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  const actions = (s: Stockist, kind: "archive" | "restore"): JSX.Element | null =>
    merch ? (
      <button
        type="button"
        className="btn btn-secondary"
        onClick={(e) => {
          opener.current = e.currentTarget;
          setDialog({ kind, stockist: s });
        }}
      >
        {kind === "archive" ? "Archive" : "Restore"}
      </button>
    ) : null;
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">Partner stores, in Danish order</p>
        <PageTitle>Stockists</PageTitle>
        <StatusRegion name="Stockist status" message={message} />
      </div>
      <section className="panel toolbar stockist-tools">
        <div className="field search-field">
          <label htmlFor="stockist-search">Search stockists</label>
          <input id="stockist-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="sticky-bar phone-only-sticky" data-sticky-bar>
          {merch ? (
            <Button
              variant="primary"
              buttonRef={addButton}
              onClick={() => {
                opener.current = addButton.current;
                setDialog({ kind: "add" });
              }}
            >
              <Plus size={16} aria-hidden="true" focusable="false" />
              Add stockist
            </Button>
          ) : null}
          <a className="btn btn-secondary" href="/api/stockists.csv" download>
            <Download size={16} aria-hidden="true" focusable="false" />
            Export CSV
          </a>
        </div>
      </section>
      <section className="panel">
        <div className="table-scroll wide-only" tabIndex={0}>
          <table aria-label="Stockists" className="ruled">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Market</th>
                <th scope="col">Contact</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!items ? (
                <tr className="empty-row">
                  <td colSpan={4}>
                    <Loading />
                  </td>
                </tr>
              ) : null}
              {items?.length === 0 ? <EmptyRow columns={4} /> : null}
              {items?.map((s) => (
                <tr key={s.id}>
                  <th scope="row">
                    <Link to={`/studio/stockists/${s.id}`}>{s.name}</Link>
                  </th>
                  <td>{s.city}</td>
                  <td>{contact(s)}</td>
                  <td>{actions(s, "archive")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul aria-label="Stockists" className="card-list phone-only">
          {!items ? (
            <li className="empty-list">
              <Loading />
            </li>
          ) : null}
          {items?.length === 0 ? <li className="empty-list">{COPY.empty}</li> : null}
          {items?.map((s) => (
            <li key={s.id} className="card">
              <Link to={`/studio/stockists/${s.id}`} className="card-title">
                {s.name}
              </Link>
              <p className="muted">{s.city}</p>
              <p>{contact(s)}</p>
              {actions(s, "archive")}
            </li>
          ))}
        </ul>
        {cursor ? (
          <Button onClick={() => void more()} className="load-more">
            Load more stockists
          </Button>
        ) : null}
      </section>
      {items ? (
        <section className="panel">
          <div className="switch-row">
            <button type="button" role="switch" aria-checked={showArchived} className="switch" onClick={() => setShowArchived((v) => !v)}>
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              Show archived
            </button>
          </div>
          {showArchived ? (
            <div className="table-scroll" tabIndex={0}>
              <table aria-label="Archived stockists" className="ruled">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Market</th>
                    <th scope="col">Archived</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!archived || archived.length === 0 ? <EmptyRow columns={4} /> : null}
                  {archived?.map((s) => (
                    <tr key={s.id}>
                      <th scope="row">{s.name}</th>
                      <td>{s.city}</td>
                      <td className="mono">{s.archivedAt ? s.archivedAt.slice(0, 10) : "—"}</td>
                      <td>{actions(s, "restore")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
      {dialog?.kind === "add" ? (
        <AddStockistDialog
          onClose={() => close()}
          onAdded={() => {
            void load();
            close();
          }}
          announce={setMessage}
        />
      ) : null}
      {dialog && dialog.kind !== "add" ? (
        <Dialog title={dialog.kind === "archive" ? "Archive stockist" : "Restore stockist"} alert={alert} alertKey={attempt} onClose={() => close()}>
          <p>
            {dialog.kind === "archive"
              ? `${dialog.stockist.name} and its allocations leave every list, search and export until it is restored.`
              : `${dialog.stockist.name} comes back exactly as it was, with its allocations.`}
          </p>
          <div className="dialog-actions">
            <Button variant="primary" pending={pending} pendingText={dialog.kind === "archive" ? "Archiving…" : "Restoring…"} onClick={() => void act(dialog.kind, dialog.stockist)}>
              {dialog.kind === "archive" ? "Archive stockist" : "Restore stockist"}
            </Button>
            <Button onClick={() => close()}>Cancel</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

export function StockistScreen({ id }: { id: string }): JSX.Element {
  const { member } = useSession();
  const [stockist, setStockist] = useState<Stockist | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useMessage();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    const [s, a] = await Promise.all([api<Stockist>("GET", `/api/stockists/${id}`), api<{ items: Allocation[] }>("GET", "/api/allocations")]);
    if (s.ok) setStockist(s.data);
    else setMissing(true);
    if (a.ok) setAllocations(a.data.items.filter((x) => x.stockistId === id));
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (missing) return <p className="panel">This stockist can't be found.</p>;
  if (!stockist) return <Loading />;
  const erase = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage("Erasing…");
    const r = await api<Stockist>("POST", `/api/stockists/${id}/erase-contact`);
    setPending(false);
    if (r.ok) {
      setStockist(r.data);
      setOpen(false);
      setMessage("Contact erased.");
      void load();
      focusLater(() => document.querySelector<HTMLElement>("main h1"));
      return;
    }
    setMessage(refusalMessage(r));
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">
          <Link to="/studio/stockists">Stockists</Link> · {stockist.city}
        </p>
        <PageTitle>{stockist.name}</PageTitle>
        <StatusRegion name="Stockist status" message={message} />
      </div>
      <div className="split-2">
        <section className="panel stack">
          <h2>Store</h2>
          <dl className="facts">
            <div>
              <dt>Market</dt>
              <dd>{stockist.city}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd className="mono">{stockist.currency}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{stockist.contactErased ? COPY.erased : stockist.contactName ?? "—"}</dd>
            </div>
            {!stockist.contactErased ? (
              <>
                <div>
                  <dt>Contact email</dt>
                  <dd>{stockist.contactEmail ?? "—"}</dd>
                </div>
                <div>
                  <dt>Contact phone</dt>
                  <dd className="mono">{stockist.contactPhone ?? "—"}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Notes</dt>
              <dd>{stockist.notes || "—"}</dd>
            </div>
          </dl>
          {member?.role === "merchandiser" && !stockist.contactErased ? (
            <Button variant="danger" buttonRef={opener} onClick={() => setOpen(true)}>
              Erase contact
            </Button>
          ) : null}
        </section>
        <section className="panel">
          <h2>Allocations</h2>
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="Store allocations" className="ruled">
              <thead>
                <tr>
                  <th scope="col">Drop</th>
                  <th scope="col">Status</th>
                  <th scope="col">Invoice</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {allocations.length === 0 ? <EmptyRow columns={4} /> : null}
                {allocations.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      <Link to={`/studio/allocations/${a.id}`}>{a.dropName}</Link>
                    </th>
                    <td>{a.status[0].toUpperCase() + a.status.slice(1)}</td>
                    <td className="mono">{a.invoiceNumber ?? "—"}</td>
                    <td className="mono num">{a.totalMinor === null ? "—" : money(a.totalMinor, a.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {open ? (
        <Dialog
          title="Erase contact"
          alert={alert}
          alertKey={attempt}
          onClose={() => {
            setOpen(false);
            focusLater(() => opener.current);
          }}
        >
          <p>{`The contact's name, email and phone are removed from the directory, exports and queued email. Invoice amounts stay under "${COPY.erased}".`}</p>
          <div className="dialog-actions">
            <Button variant="danger" pending={pending} pendingText="Erasing…" onClick={() => void erase()}>
              Erase contact
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                focusLater(() => opener.current);
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
