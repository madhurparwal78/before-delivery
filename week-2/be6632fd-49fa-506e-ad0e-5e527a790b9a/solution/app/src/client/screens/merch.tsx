// The merchandiser's line sheet and lookbook (brief: Staff screens; Interactions → Looks; Journey 4).
import { GripVertical, Plus } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { COPY, staleStart } from "../../shared/copy";
import { amount, counted, marketTime, position } from "../../shared/format";
import { CURRENCY } from "../../shared/time";
import { api } from "../api";
import { glide, rects } from "../motion";
import { Link } from "../router";
import type { StaffDrop } from "../types";
import { Button, Dialog, EmptyRow, Loading, PageTitle, SelectField, StatusRegion, focusLater, refusalMessage, useMessage } from "../ui";

interface ImportResult {
  rows: number;
  matched: number;
  updated: number;
  unchanged: number;
  orphans: Array<{ line: number; styleNumber: string }>;
  results: Array<{ line: number; styleNumber: string; outcome: string }>;
}

function useDrop(id: string): [StaffDrop | null, () => Promise<void>] {
  const [drop, setDrop] = useState<StaffDrop | null>(null);
  const load = useCallback(async () => {
    const r = await api<StaffDrop>("GET", `/api/drops/${id}`);
    if (r.ok) setDrop(r.data);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  return [drop, load];
}

export function LineSheetScreen({ id }: { id: string }): JSX.Element {
  const [drop, reload] = useDrop(id);
  const [currency, setCurrency] = useState("DKK");
  const [message, setMessage] = useMessage();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<ImportResult | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const close = (): void => {
    setOpen(false);
    setAlert(null);
    setFile(null);
    focusLater(() => opener.current);
  };
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData();
    if (file) form.append("file", file, file.name);
    setPending(true);
    setMessage("Importing…");
    const r = await api<ImportResult>("POST", `/api/drops/${id}/line-sheet/import`, form);
    setPending(false);
    if (r.ok) {
      setReport(r.data);
      setOpen(false);
      setFile(null);
      setMessage(`Import finished: ${r.data.matched} matched, ${r.data.updated} updated, ${r.data.unchanged} unchanged, ${counted(r.data.orphans.length, "orphan row")}.`);
      await reload();
      focusLater(() => reportHeading.current);
      return;
    }
    const text = r.status === 413 ? COPY.lineSheetTooLarge : r.status === 415 || r.fields.file ? COPY.lineSheetWrongType : r.message;
    setMessage(r.status === 401 ? refusalMessage(r) : text);
    setAlert(text);
    setAttempt((n) => n + 1);
  };
  if (!drop) return <Loading />;
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">
          <Link to="/studio/drops">Drops</Link> · Wholesale
        </p>
        <PageTitle>{`Line sheet · ${drop.name}`}</PageTitle>
        <StatusRegion name="Line sheet status" message={message} />
      </div>
      <div className="toolbar">
        <SelectField id="export-currency" label="Export currency" value={currency} onChange={setCurrency} options={[...new Set(Object.values(CURRENCY))].map((c): [string, string] => [c, c])} className="inline-field" />
        <div className="sticky-bar phone-only-sticky" data-sticky-bar>
          <a className="btn btn-secondary" href={`/api/drops/${drop.id}/line-sheet.csv?currency=${currency}`} download>
            Export CSV
          </a>
          <Button variant="primary" buttonRef={opener} onClick={() => setOpen(true)}>
            Import line sheet
          </Button>
        </div>
      </div>
      <section className="panel">
        <div className="table-scroll" tabIndex={0}>
          <table aria-label="Line sheet" className="ruled">
            <thead>
              <tr>
                <th scope="col">Style number</th>
                <th scope="col">Name</th>
                <th scope="col">Colour</th>
                <th scope="col" className="num">Wholesale edition</th>
                <th scope="col" className="num">RRP</th>
              </tr>
            </thead>
            <tbody>
              {drop.styles.length === 0 ? <EmptyRow columns={5} /> : null}
              {drop.styles.map((s) => (
                <tr key={s.styleNumber}>
                  <th scope="row" className="mono">
                    {s.styleNumber}
                  </th>
                  <td>{s.name}</td>
                  <td>{s.colour}</td>
                  <td className="mono num">{s.wholesaleEdition}</td>
                  <td className="mono num">{`DKK ${amount(s.rrpDkkMinor ?? 0, "DKK")}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {report ? (
        <section className="panel">
          <h2 tabIndex={-1} ref={reportHeading}>
            Import report
          </h2>
          <p className="muted">{`${counted(report.rows, "row")} read.`}</p>
          <div className="table-scroll report-scroll" tabIndex={0}>
            <table aria-label="Import report" className="ruled report-table">
              <thead>
                <tr>
                  <th scope="col" className="pinned">
                    Line
                  </th>
                  <th scope="col">Style number</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {report.results.length === 0 ? <EmptyRow columns={3} /> : null}
                {report.results.map((row) => (
                  <tr key={row.line}>
                    <th scope="row" className="pinned mono">
                      {row.line}
                    </th>
                    <td className="mono">{row.styleNumber}</td>
                    <td>{row.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {open ? (
        <Dialog title="Import line sheet" alert={alert} alertKey={attempt} onClose={close}>
          <form onSubmit={(e) => void submit(e)} noValidate className="stack">
            <p className="muted">The previous tool's semicolon line sheet: Style no;Name;Colour;Edition;RRP DKK.</p>
            <div className="field">
              <label htmlFor="line-sheet-file">Line sheet file</label>
              <input id="line-sheet-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="dialog-actions">
              <Button type="submit" variant="primary" pending={pending} pendingText="Importing…">
                Import
              </Button>
              <Button onClick={close}>Cancel</Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

interface Look {
  id: string;
  position: number;
  title: string;
  altText: string;
  width: number;
  height: number;
  imageUrl: string;
}

interface Lookbook {
  items: Look[];
  orderVersion: number;
}

export function LookbookScreen({ id }: { id: string }): JSX.Element {
  const [drop] = useDrop(id);
  const [book, setBook] = useState<Lookbook | null>(null);
  const [order, setOrder] = useState<Look[]>([]);
  const [lifted, setLifted] = useState<{ id: string; from: number } | null>(null);
  const [message, setMessage] = useMessage();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const before = useRef<Map<string, DOMRect>>(new Map());
  const refocus = useRef<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Lookbook>("GET", `/api/drops/${id}/looks`);
    if (r.ok) {
      setBook(r.data);
      setOrder(r.data.items);
    } else setMessage(refusalMessage(r));
  }, [id, setMessage]);
  useEffect(() => {
    void load();
  }, [load]);
  useLayoutEffect(() => {
    glide(cards.current as Map<string, HTMLElement>, before.current);
    if (refocus.current) cards.current.get(refocus.current)?.querySelector<HTMLButtonElement>(".move-handle")?.focus();
    refocus.current = null;
  }, [order]);
  const arrange = (next: Look[]): void => {
    before.current = rects(cards.current as Map<string, HTMLElement>);
    setOrder(next);
  };
  const move = (lookId: string, to: number): Look[] => {
    const from = order.findIndex((l) => l.id === lookId);
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(Math.min(Math.max(to, 0), next.length), 0, item);
    return next;
  };
  const save = async (next: Look[], dropped: Look): Promise<void> => {
    if (!book) return;
    setMessage("Saving order…");
    const r = await api<Lookbook>("PUT", `/api/drops/${id}/looks/order`, { orderVersion: book.orderVersion, lookIds: next.map((l) => l.id) });
    if (r.ok) {
      setBook(r.data);
      setMessage(`${dropped.title} dropped at position ${position(next.findIndex((l) => l.id === dropped.id) + 1, next.length)}.`);
      window.setTimeout(() => setMessage("Look order saved."), 0);
      return;
    }
    if (r.status === 412) {
      const current = r.extra.current as Lookbook;
      setBook(current);
      arrange(current.items);
      setMessage(`${staleStart(String(r.extra.savedBy), marketTime(Date.parse(String(r.extra.savedAt))))} The saved order is back.`);
      return;
    }
    arrange(book.items);
    setMessage(refusalMessage(r));
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, look: Look): void => {
    const index = order.findIndex((l) => l.id === look.id);
    const total = order.length;
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      if (!lifted) {
        setLifted({ id: look.id, from: index });
        setMessage(`Picked up ${look.title}. Position ${position(index + 1, total)}.`);
      } else {
        setLifted(null);
        void save(order, look);
      }
      return;
    }
    if (!lifted || lifted.id !== look.id) return;
    if (["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1);
      if (to < 0 || to >= total) return;
      refocus.current = look.id;
      arrange(move(look.id, to));
      setMessage(`${look.title} moved to position ${position(to + 1, total)}.`);
    } else if (event.key === "Escape") {
      event.preventDefault();
      refocus.current = look.id;
      arrange(move(look.id, lifted.from));
      setLifted(null);
      setMessage(`Move cancelled. ${look.title} is back at position ${position(lifted.from + 1, total)}.`);
    }
  };
  const nearest = (x: number, y: number, except: string): number => {
    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    order.forEach((l, i) => {
      const el = cards.current.get(l.id);
      if (!el || l.id === except) return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      if (d < distance) {
        distance = d;
        best = i;
      }
    });
    return best;
  };
  const orderRef = useRef(order);
  orderRef.current = order;
  /** A pointer drag of a look's Move handle; window listeners keep it alive while the card moves in the list. */
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, look: Look): void => {
    const pointer = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let timer: number | null = null;
    const lift = (): void => {
      active = true;
      const index = orderRef.current.findIndex((l) => l.id === look.id);
      setLifted({ id: look.id, from: index });
      setMessage(`Picked up ${look.title}. Position ${position(index + 1, orderRef.current.length)}.`);
    };
    const onMove = (e: globalThis.PointerEvent): void => {
      if (e.pointerId !== pointer) return;
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) finish(false);
        return;
      }
      e.preventDefault();
      const current = orderRef.current;
      const index = current.findIndex((l) => l.id === look.id);
      const target = nearest(e.clientX, e.clientY, look.id);
      const el = cards.current.get(current[target]?.id ?? "");
      if (!el || target === index) return;
      const r = el.getBoundingClientRect();
      const passed =
        target < index ? e.clientY < r.top + r.height / 2 || e.clientX < r.left + r.width / 2 : e.clientY > r.top + r.height / 2 || e.clientX > r.left + r.width / 2;
      if (!passed) return;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      orderRef.current = next;
      arrange(next);
      setMessage(`${look.title} moved to position ${position(target + 1, next.length)}.`);
    };
    const onUp = (e: globalThis.PointerEvent): void => {
      if (e.pointerId === pointer) finish(active && e.type === "pointerup");
    };
    const finish = (drop: boolean): void => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!active) return;
      setLifted(null);
      if (drop) void save(orderRef.current, look);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    if (event.pointerType === "touch") timer = window.setTimeout(lift, 333);
    else lift();
  };
  if (!drop || !book) return <Loading />;
  return (
    <div className="screen">
      <div className="screen-head with-action">
        <div>
          <p className="eyebrow">
            <Link to="/studio/drops">Drops</Link> · Lookbook
          </p>
          <PageTitle>{`Lookbook · ${drop.name}`}</PageTitle>
        </div>
        <Button variant="primary" buttonRef={opener} onClick={() => setOpen(true)}>
          <Plus size={16} aria-hidden="true" focusable="false" />
          Add look
        </Button>
      </div>
      <StatusRegion name="Lookbook status" message={message} />
      <p className="muted">Move a look with its Move handle: drag it, press and hold on a phone, or press Space, then the arrow keys, then Space.</p>
      <ul aria-label="Looks" className="look-grid">
        {order.map((look, i) => (
          <li
            key={look.id}
            className={`look-card${lifted?.id === look.id ? " is-lifted" : ""}`}
            ref={(el) => {
              if (el) cards.current.set(look.id, el);
              else cards.current.delete(look.id);
            }}
          >
            <img src={`${look.imageUrl}?w=480`} alt={look.altText} width={look.width} height={look.height} loading="lazy" draggable={false} />
            <div className="look-meta">
              <p className="look-title">{look.title}</p>
              <p className="mono">{position(i + 1, order.length)}</p>
              <button
                type="button"
                className="btn btn-secondary move-handle"
                aria-pressed={lifted?.id === look.id ? true : undefined}
                onKeyDown={(e) => onKey(e, look)}
                onKeyUp={(e) => e.key === " " && e.preventDefault()}
                onClick={(e) => e.preventDefault()}
                onPointerDown={(e) => onPointerDown(e, look)}
              >
                <GripVertical size={16} aria-hidden="true" focusable="false" />
                Move
              </button>
            </div>
          </li>
        ))}
        {order.length === 0 ? <li className="empty-list">{COPY.empty}</li> : null}
      </ul>
      {open ? (
        <AddLookDialog
          dropId={id}
          onClose={() => {
            setOpen(false);
            focusLater(() => opener.current);
          }}
          onAdded={async () => {
            setOpen(false);
            setMessage("Look added.");
            await load();
            focusLater(() => opener.current);
          }}
          announce={setMessage}
        />
      ) : null}
    </div>
  );
}

function AddLookDialog({ dropId, onClose, onAdded, announce }: { dropId: string; onClose: () => void; onAdded: () => Promise<void>; announce: (m: ReturnType<typeof refusalMessage> | string) => void }): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [alt, setAlt] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData();
    if (file) form.append("file", file, file.name);
    form.append("title", title);
    form.append("altText", alt);
    setPending(true);
    announce("Uploading…");
    const r = await api("POST", `/api/drops/${dropId}/looks`, form);
    setPending(false);
    if (r.ok) {
      await onAdded();
      return;
    }
    const text = r.status === 413 ? COPY.photoTooLarge : r.message;
    setErrors(r.fields);
    announce(r.status === 401 ? refusalMessage(r) : text);
    setAlert(text);
    setAttempt((n) => n + 1);
  };
  const error = (path: string, id: string): JSX.Element | null =>
    errors[path] ? (
      <p className="field-error" id={id}>
        {errors[path]}
      </p>
    ) : null;
  return (
    <Dialog title="Add look" alert={alert} alertKey={attempt} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <div className={`field${errors.file ? " has-error" : ""}`}>
          <label htmlFor="look-file">Look image</label>
          <input id="look-file" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={errors.file ? "look-file-error" : undefined} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {error("file", "look-file-error")}
        </div>
        <div className={`field${errors.title ? " has-error" : ""}`}>
          <label htmlFor="look-title">Look title</label>
          <input id="look-title" value={title} aria-describedby={errors.title ? "look-title-error" : undefined} onChange={(e) => setTitle(e.target.value)} />
          {error("title", "look-title-error")}
        </div>
        <div className={`field${errors.altText ? " has-error" : ""}`}>
          <label htmlFor="look-alt">Alt text</label>
          <input id="look-alt" value={alt} aria-describedby={errors.altText ? "look-alt-error" : undefined} onChange={(e) => setAlt(e.target.value)} />
          {error("altText", "look-alt-error")}
        </div>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" pending={pending} pendingText="Uploading…">
            Upload look
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
