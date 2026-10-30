// Curate: boards for sessions and artwork entries, one column per state. Every action moves the card and
// announces the change. Publishing times are typed as Brussels wall time.
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { parseWall, sessionTimeText } from "../../shared/brussels.ts";
import { parseEuros } from "../../shared/money.ts";
import { api } from "../api.ts";
import { closeWithMotion, Dialog } from "../components/Dialog.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Field } from "../components/Field.tsx";
import { Gate, ScreenHeader, TabPanel, Tabs } from "../components/Screen.tsx";
import { copy } from "../copy.ts";
import { useSession } from "../session.tsx";
import { refreshProgramme, useProgramme } from "../state/programme.ts";
import type { Entry, Session } from "../types.ts";

const COLUMNS = [["draft", "Draft"], ["review", "Review"], ["scheduled", "Scheduled"], ["published", "Published"], ["cancelled", "Cancelled"]] as const;
type Kind = "sessions" | "entries";
type Item = { id: string; title: string; status: string; meta: string; images?: Entry["images"] };

/** True when this Brussels wall time occurs twice (the repeated hour of the autumn change). */
function repeated(wall: string): boolean {
  const summer = parseWall(`${wall}+02:00`);
  const winter = parseWall(`${wall}+01:00`);
  return summer.ok && winter.ok;
}

function ScheduleDialog({ item, kind, opener, onDone, onClose }: { item: Item; kind: Kind; opener: HTMLElement | null; onDone: (text: string) => void; onClose: () => void }) {
  const [wall, setWall] = useState("");
  const [offset, setOffset] = useState("+02:00");
  const panel = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const publishAt = repeated(wall) ? `${wall}${offset}` : wall;
    const r = await api.post(`/api/${kind}/${item.id}/transitions`, { to: "scheduled", note: null, publish_at: publishAt });
    if (r.ok) {
      onDone(copy.moved(item.title, "scheduled"));
      closeWithMotion(panel.current, onClose);
      return;
    }
    const text = r.errors?.publish_at === "not_in_future" ? copy.notInFuture
      : r.errors?.publish_at ? "Type the time as YYYY-MM-DDTHH:MM, for example 2027-10-29T14:30."
        : r.error === "illegal_transition" ? copy.illegal(item.title, String(r.body.from), "scheduled") : "That didn't work. Try again in a moment.";
    setError(text);
    onDone(text);
  };
  return (
    <Dialog label="Schedule publishing" onClose={() => closeWithMotion(panel.current, onClose)} initialFocus={input} returnFocus={opener} className="dialog--narrow">
      <form ref={panel} className="stack" onSubmit={(e) => void submit(e)} noValidate>
        <h2 className="dialog__title">Schedule {item.title}</h2>
        <Field label="Publish at" hint="Brussels time, typed as YYYY-MM-DDTHH:MM — for example 2027-10-29T14:30." error={error || undefined}>
          <input ref={input} type="text" inputMode="numeric" placeholder="2027-10-29T14:30" value={wall} onChange={(e) => setWall(e.target.value.trim())} />
        </Field>
        {repeated(wall) && (
          <Field label="Offset" hint="This time happens twice when the clocks go back. Choose which one.">
            <select value={offset} onChange={(e) => setOffset(e.target.value)}>
              <option value="+02:00">First occurrence (CEST, +02:00)</option>
              <option value="+01:00">Second occurrence (CET, +01:00)</option>
            </select>
          </Field>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => closeWithMotion(panel.current, onClose)}>Close</button>
          <button type="submit" className="button button--primary">Schedule</button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({ item, opener, onConfirm, onClose }: { item: Item; opener: HTMLElement | null; onConfirm: () => Promise<void>; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  return (
    <Dialog label="Cancel session" onClose={() => closeWithMotion(panel.current, onClose)} returnFocus={opener} className="dialog--narrow">
      <div ref={panel} className="stack">
        <h2 className="dialog__title" data-autofocus tabIndex={-1}>Cancel {item.title}?</h2>
        <p>Every seat and pass line sold for this session is refunded: card shares to Kill Bill, voucher shares to their vouchers, group lines as credit notes. Other items on the same orders stay valid.</p>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => closeWithMotion(panel.current, onClose)}>Keep session</button>
          <button type="button" className="button button--danger" onClick={() => void onConfirm().then(() => closeWithMotion(panel.current, onClose))}>Cancel session and refund</button>
        </div>
      </div>
    </Dialog>
  );
}

function NewSessionDialog({ opener, onDone, onClose }: { opener: HTMLElement | null; onDone: (text: string) => void; onClose: () => void }) {
  const programme = useProgramme();
  const panel = useRef<HTMLFormElement>(null);
  const [seat, setSeat] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cents = (name: string) => (seat ? parseEuros(String(f.get(name) ?? "")) : null);
    const r = await api.post<Session>("/api/sessions", {
      title: f.get("title"), description: f.get("description"), discipline: f.get("discipline"), venue_id: f.get("venue"),
      starts_local: f.get("starts"), ends_local: f.get("ends"), admission: seat ? "seat" : "pass",
      capacity: seat ? Number(f.get("capacity")) : null, price_full_cents: cents("full"), price_reduced_cents: cents("reduced"),
    });
    if (r.ok) {
      onDone(`${r.data.title} added to Draft.`);
      closeWithMotion(panel.current, onClose);
      return;
    }
    const messages: Record<string, string> = {
      invalid: "Type the time as YYYY-MM-DDTHH:MM.", offset_mismatch: "Brussels doesn't use that offset at this time.",
      nonexistent_local_time: "That time doesn't exist: the clocks skip it.", outside_edition: "Choose a time within the festival days.",
      ends_before_start: "The end must come after the start.", required: "Required.", out_of_range: "Between 1 and 500.", unknown: "Choose one.",
    };
    setErrors(Object.fromEntries(Object.entries(r.errors ?? {}).map(([k, v]) => [k, messages[v] ?? "Check this field."])));
    onDone("Check the highlighted fields.");
  };
  return (
    <Dialog label="New session" onClose={() => closeWithMotion(panel.current, onClose)} returnFocus={opener}>
      <form ref={panel} className="stack" onSubmit={(e) => void submit(e)} noValidate>
        <h2 className="dialog__title" data-autofocus tabIndex={-1}>New session</h2>
        <Field label="Title" error={errors.title}><input name="title" type="text" /></Field>
        <Field label="Description"><textarea name="description" rows={3} /></Field>
        <div className="split">
          <Field label="Discipline" error={errors.discipline}><select name="discipline">{programme?.disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Venue"><select name="venue">{programme?.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        </div>
        <div className="split">
          <Field label="Starts (Brussels)" hint="YYYY-MM-DDTHH:MM" error={errors.starts_local}><input name="starts" type="text" placeholder="2027-10-29T14:00" /></Field>
          <Field label="Ends (Brussels)" hint="YYYY-MM-DDTHH:MM" error={errors.ends_local}><input name="ends" type="text" placeholder="2027-10-29T15:00" /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={seat} onChange={(e) => setSeat(e.target.checked)} /><span>Seated (sold by the seat)</span></label>
        {seat && (
          <div className="split">
            <Field label="Capacity" error={errors.capacity}><input name="capacity" type="number" min={1} max={500} defaultValue={12} /></Field>
            <Field label="Full price (€)" error={errors.price_full_cents}><input name="full" type="text" inputMode="decimal" defaultValue="18.00" /></Field>
            <Field label="Reduced price (€)" error={errors.price_reduced_cents}><input name="reduced" type="text" inputMode="decimal" defaultValue="10.00" /></Field>
          </div>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => closeWithMotion(panel.current, onClose)}>Close</button>
          <button type="submit" className="button button--primary">Create draft</button>
        </div>
      </form>
    </Dialog>
  );
}

export function Curate() {
  const { user } = useSession();
  const programme = useProgramme();
  const [tab, setTab] = useState<Kind>("sessions");
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState<{ type: "schedule" | "cancel" | "new"; item?: Item; opener: HTMLElement } | null>(null);

  const load = useCallback(async () => {
    if (tab === "sessions") {
      const r = await api.get<{ sessions: Session[] }>("/api/curate/sessions");
      if (r.ok) {
        setItems(r.data.sessions.map((s) => ({
          id: s.id, title: s.title, status: s.status,
          meta: `${sessionTimeText(Date.parse(s.starts_at), Date.parse(s.ends_at))} · ${programme?.venues.find((v) => v.id === s.venue_id)?.name ?? s.venue_id}`,
        })));
      }
    } else {
      const r = await api.get<{ entries: Entry[] }>("/api/entries");
      if (r.ok) setItems(r.data.entries.map((e) => ({ id: e.id, title: e.title, status: e.status, meta: `${e.artist_name} · ${e.medium}`, images: e.images })));
    }
  }, [tab, programme]);
  useEffect(() => { if (user?.role === "curator") void load(); }, [user, load]);

  const moveTo = async (item: Item, to: string) => {
    const r = await api.post<{ refunds_started?: number }>(`/api/${tab}/${item.id}/transitions`, { to, note: null, publish_at: null });
    if (r.ok) {
      setStatus(to === "cancelled" && tab === "sessions" ? copy.cancelledWithRefunds(item.title, r.data.refunds_started ?? 0) : copy.moved(item.title, to));
      void refreshProgramme();
    } else if (r.error === "illegal_transition") setStatus(copy.illegal(item.title, String(r.body.from), to));
    else if (r.error === "stale_version") setStatus(copy.stale(item.title));
    else setStatus("That didn't work. Try again in a moment.");
    await load();
  };

  const viewOriginal = async (item: Item) => {
    const image = item.images?.[0];
    if (!image) return setStatus(`${item.title} has no image yet.`);
    const r = await api.post<{ url: string }>(`/api/entries/${item.id}/images/${image.id}/read`);
    if (r.ok) window.open(r.data.url, "_blank", "noopener");
    else setStatus(r.error === "storage_unavailable" ? copy.storageDown : "The original can't be opened right now.");
  };

  const actions = (item: Item) => {
    // Visible words stay inside the accessible name: the title is read but visually hidden.
    const b = (before: string, after: string, onClick: (e: MouseEvent<HTMLButtonElement>) => void, tone = "") => (
      <button type="button" className={`button button--small ${tone}`} onClick={onClick}>
        <span>{before} <span className="visually-hidden">{item.title}{after ? " " : ""}</span>{after}</span>
      </button>
    );
    const open = (type: "schedule" | "cancel") => (e: MouseEvent<HTMLButtonElement>) => setDialog({ type, item, opener: e.currentTarget });
    return (
      <div className="card__actions">
        {item.status === "draft" && b("Send", "to review", () => void moveTo(item, "review"))}
        {item.status === "review" && b("Return", "to draft", () => void moveTo(item, "draft"))}
        {item.status === "review" && b("Schedule", "", open("schedule"), "button--primary")}
        {item.status === "scheduled" && b("Unschedule", "", () => void moveTo(item, "review"))}
        {(item.status === "scheduled" || item.status === "published") && b("Cancel", "",
          tab === "sessions" ? open("cancel") : () => void moveTo(item, "cancelled"), "button--danger")}
        {tab === "entries" && item.images?.length ? <button type="button" className="button button--small" onClick={() => void viewOriginal(item)}>View original</button> : null}
      </div>
    );
  };

  return (
    <div className="screen" data-ground="screen">
      <ScreenHeader title="Curate" lede="Move sessions and artwork entries from draft to published." />
      <Gate user={user} roles={["curator"]}>
        <div className="grid screen__body">
          <div className="toolbar toolbar--tabs">
            <Tabs label="Curation boards" tabs={[["sessions", "Sessions"], ["entries", "Artwork entries"]]} current={tab} onChange={(t) => { if (t !== tab) { setTab(t); setItems([]); } }} />
            {tab === "sessions" && <button type="button" className="button button--primary" onClick={(e) => setDialog({ type: "new", opener: e.currentTarget })}>New session</button>}
          </div>
          <p role="status" aria-label="Curation status" className="status-line">{status}</p>
          <TabPanel id={tab}>
            <div className="board">
              {COLUMNS.map(([state, name]) => {
                const column = items.filter((i) => i.status === state);
                return (
                  <section key={state} aria-label={name} className="board__column">
                    <h2 className="board__title">{name} <span className="figures">{column.length}</span></h2>
                    <ul className="board__cards">
                      {column.map((item) => (
                        <li key={item.id} className="card">
                          <p className="card__title">{item.title}</p>
                          <p className="card__meta figures">{item.meta}</p>
                          <span className="badge" data-state={item.status}>{item.status}</span>
                          {actions(item)}
                        </li>
                      ))}
                    </ul>
                    {column.length === 0 && <EmptyState compact text={`Nothing in ${name} yet.`} />}
                  </section>
                );
              })}
            </div>
          </TabPanel>
          {dialog?.type === "schedule" && dialog.item && (
            <ScheduleDialog item={dialog.item} kind={tab} opener={dialog.opener} onDone={(t) => { setStatus(t); void load(); }} onClose={() => setDialog(null)} />
          )}
          {dialog?.type === "cancel" && dialog.item && (
            <CancelDialog item={dialog.item} opener={dialog.opener} onConfirm={() => moveTo(dialog.item!, "cancelled")} onClose={() => setDialog(null)} />
          )}
          {dialog?.type === "new" && <NewSessionDialog opener={dialog.opener} onDone={(t) => { setStatus(t); void load(); }} onClose={() => setDialog(null)} />}
        </div>
      </Gate>
    </div>
  );
}
