import { useEffect, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import { formatDay, formatFigure, formatTime } from "../../shared/format";
import { formatMoney, metresToCentimetres, minorToDecimal, parseMoneyText } from "../../shared/money";
import { addDays, localDate, weekday, type Base } from "../../shared/zones";
import { api, sharedCopy } from "../lib/api";
import { useLoad, useWide } from "../lib/hooks";
import { takeDraft, useDraft } from "../lib/nav";
import { bad, Button, Field, focusFirstError, Link, NoteLine, ok, Problems, SelectField, useAction } from "../ui/Controls";
import { Dialog, useDialog } from "../ui/Dialog";
import { DataTable, NotFoundPage, type Member } from "../ui/Shell";
import { HullDrawing, Loader } from "../ui/Visuals";
import { useKeepAboveBar } from "../ui/StickyBar";
import { BASE_LABEL } from "./common";

interface Yacht {
  slug: string;
  name: string;
  base: Base;
  status: "on_sale" | "withdrawn";
  cabins: number;
  lengthM: number;
  beamM: number;
  draftM: number;
  rates: { lowMinor: number; shoulderMinor: number; highMinor: number };
}

interface PassageSummary {
  id: string;
  yachtSlug: string;
  name: string;
  status: "draft" | "sent";
  base: Base;
  departsAt: string;
}

/** The Saturday that starts the rota week holding a base-local date. */
export function rotaWeekOf(date: string): string {
  return addDays(date, -((weekday(date) + 1) % 7));
}

export function Today({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const yachts = useLoad<{ yachts: Yacht[] }>(`/api/w/${ws}/yachts`);
  const passages = useLoad<{ passages: PassageSummary[] }>(`/api/w/${ws}/passages`);
  const names = new Map((yachts.data?.yachts ?? []).map((y) => [y.slug, y.name]));
  const captain = member.role === "captain" || member.role === "fleet_director";
  return (
    <section>
      <h1 class="rise">Today</h1>
      <p class="lede">Good to see you, {member.name.split(" ")[0]}.</p>
      <Loader active={yachts.loading || passages.loading} />
      {/* The lists show once both have loaded, so neither pushes the other down. */}
      {yachts.loading || passages.loading ? null : (
      <div class="two-col two-col--even">
        <div>
          <h2>Your yachts</h2>
          <ul class="rows" aria-label="Your yachts">
            {(yachts.data?.yachts ?? []).map((y) => (
              <li key={y.slug} class="row-card">
                <div class="row-card__head">
                  <h3>{y.name}</h3>
                  <span class="muted">{BASE_LABEL[y.base]} base</span>
                </div>
                <div class="row-card__links">
                  <Link class="btn btn--quiet" href={`/w/${ws}/yachts/${y.slug}/rota?week=${rotaWeekOf(localDate(Date.now(), y.base))}`}>Rota</Link>
                  <Link class="btn btn--quiet" href={`/w/${ws}/passages?yacht=${y.slug}`}>Passages</Link>
                  <Link class="btn btn--quiet" href={`/w/${ws}/yachts/${y.slug}/stores`}>Stores</Link>
                  {captain ? <Link class="btn btn--quiet" href={`/w/${ws}/yachts/${y.slug}/energy`}>Energy</Link> : null}
                </div>
              </li>
            ))}
          </ul>
          {yachts.data && !yachts.data.yachts.length ? <p class="empty">No yachts yet.</p> : null}
        </div>
        <div>
          <h2>Upcoming passages</h2>
          <ul class="rows" aria-label="Upcoming passages">
            {(passages.data?.passages ?? []).map((p) => (
              <li key={p.id} class="row-card">
                <div class="row-card__head">
                  <h3><Link href={`/w/${ws}/passages/${p.id}`}>{p.name}</Link></h3>
                  <span class={`pill pill--${p.status}`}>{p.status === "sent" ? "Sent" : "Draft"}</span>
                </div>
                <p class="muted">{names.get(p.yachtSlug)} · departs <span class="fig">{formatTime(p.departsAt, p.base)}</span></p>
              </li>
            ))}
          </ul>
          {passages.data && !passages.data.passages.length ? <p class="empty">No passages yet.</p> : null}
        </div>
      </div>
      )}
    </section>
  );
}

export function StaffFleet({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const yachts = useLoad<{ yachts: Yacht[] }>(`/api/w/${ws}/yachts`);
  return (
    <section>
      <h1 class="rise">Fleet</h1>
      <p class="lede">Every yacht of the workspace, on sale or withdrawn.</p>
      <Loader active={yachts.loading} />
      <ul class="rows rows--fleet" aria-label="Yachts">
        {(yachts.data?.yachts ?? []).map((y) => (
          <li key={y.slug} class="row-card row-card--yacht">
            <HullDrawing name={y.name} lengthM={y.lengthM} beamM={y.beamM} />
            <div class="row-card__body">
              <div class="row-card__head">
                <h2>{y.name}</h2>
                <span class={`pill pill--${y.status}`}>{y.status === "on_sale" ? "On sale" : "Withdrawn"}</span>
              </div>
              <p class="muted">{BASE_LABEL[y.base]} base · <span class="fig">{y.cabins}</span> cabins</p>
              <div class="row-card__links">
                <Link class="btn btn--quiet" href={`/w/${ws}/yachts/${y.slug}`}>Weeks</Link>
                {member.role === "fleet_director" ? <Link class="btn btn--quiet" href={`/w/${ws}/yachts/${y.slug}/profile`}>Profile</Link> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {yachts.data && !yachts.data.yachts.length ? <p class="empty">No yachts yet.</p> : null}
    </section>
  );
}

interface ProfileForm {
  name: string;
  cabins: string;
  length: string;
  beam: string;
  draft: string;
  low: string;
  shoulder: string;
  high: string;
}

const PROFILE_FIELDS: Record<string, { label: string; id: string }> = {
  name: { label: "Name", id: "profile-name" },
  cabins: { label: "Cabins", id: "profile-cabins" },
  lengthM: { label: "Length (m)", id: "profile-length" },
  beamM: { label: "Beam (m)", id: "profile-beam" },
  draftM: { label: "Draft (m)", id: "profile-draft" },
  "rates.lowMinor": { label: "Low season weekly rate (EUR)", id: "profile-low" },
  "rates.shoulderMinor": { label: "Shoulder season weekly rate (EUR)", id: "profile-shoulder" },
  "rates.highMinor": { label: "High season weekly rate (EUR)", id: "profile-high" },
};

function formOf(y: Yacht): ProfileForm {
  return {
    name: y.name,
    cabins: String(y.cabins),
    length: String(y.lengthM),
    beam: String(y.beamM),
    draft: String(y.draftM),
    low: minorToDecimal(y.rates.lowMinor),
    shoulder: minorToDecimal(y.rates.shoulderMinor),
    high: minorToDecimal(y.rates.highMinor),
  };
}

/** Typed metres as a number when they read as one; anything else goes as typed for the server to refuse. */
function metresValue(text: string): number | string {
  return /^\s*-?\d+(\.\d+)?\s*$/.test(text) ? Number(text) : text;
}

function figurePreview(text: string): string {
  const cm = metresToCentimetres(text);
  return cm === null ? "—" : formatFigure(cm);
}

export function Profile({ member, slug }: { member: Member; slug: string }) {
  const ws = member.workspaceSlug;
  const wide = useWide();
  const yacht = useLoad<{ yacht: Yacht }>(`/api/w/${ws}/yachts/${slug}`);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Yacht["status"] | null>(null);
  const save = useAction();
  const sale = useAction();
  const withdraw = useDialog();
  const back = useDialog();
  const bar = useRef<HTMLDivElement>(null);
  useDraft("profile", form);
  useKeepAboveBar(bar, !wide);

  useEffect(() => {
    if (yacht.data && !form) {
      setForm(takeDraft<ProfileForm>("profile") ?? formOf(yacht.data.yacht));
      setStatus(yacht.data.yacht.status);
    }
  }, [yacht.data]);

  if (yacht.result && !yacht.result.ok && yacht.result.status !== 401) return <NotFoundPage />;
  const y = yacht.data?.yacht;
  const set = (key: keyof ProfileForm) => (value: string) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const submit = (event: Event) => {
    event.preventDefault();
    if (!form) return;
    void save.run("Saving profile", async () => {
      const rate = (text: string) => parseMoneyText(text) ?? text;
      const result = await api<{ yacht: Yacht }>("PATCH", `/api/w/${ws}/yachts/${slug}`, {
        name: form.name,
        cabins: /^\s*\d+\s*$/.test(form.cabins) ? Number(form.cabins) : form.cabins,
        lengthM: metresValue(form.length),
        beamM: metresValue(form.beam),
        draftM: metresValue(form.draft),
        rates: { lowMinor: rate(form.low), shoulderMinor: rate(form.shoulder), highMinor: rate(form.high) },
      });
      if (result.ok) {
        setErrors({});
        await yacht.reload();
        return ok(COPY.profileSaved);
      }
      const found = result.body.errors ?? {};
      setErrors(found);
      save.focusLater(() => focusFirstError(Object.keys(PROFILE_FIELDS).filter((k) => found[k]).map((k) => PROFILE_FIELDS[k].id)));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  const changeSale = (path: "withdraw" | "return-to-sale") => {
    void sale.run("", async () => {
      const result = await api<{ yacht: Yacht }>("POST", `/api/w/${ws}/yachts/${slug}/${path}`);
      withdraw.hide();
      back.hide();
      if (result.ok) {
        setStatus(result.data.yacht.status);
        return ok(path === "withdraw" ? COPY.yachtWithdrawn(result.data.yacht.name) : COPY.yachtBack(result.data.yacht.name));
      }
      if (result.body.error === "already_withdrawn" || result.body.error === "already_on_sale") {
        await yacht.reload().then((r) => r.ok && setStatus(r.data.yacht.status));
        return null;
      }
      return bad(sharedCopy(result));
    });
  };

  const fieldError = (key: string) => errors[key];

  return (
    <section class="profile">
      <Loader active={!y || !form} />
      {y && form ? (
        <>
          <h1 class="rise">{y.name} profile</h1>
          <form class="two-col profile__grid" onSubmit={submit} noValidate>
            <div class="card form">
              <Problems errors={errors} labels={PROFILE_FIELDS} />
              <Field id="profile-name" label="Name" value={form.name} onInput={set("name")} error={fieldError("name")} />
              <Field id="profile-cabins" label="Cabins" type="number" inputMode="numeric" value={form.cabins} onInput={set("cabins")} error={fieldError("cabins")} />
              <div class="field-row">
                <Field id="profile-length" label="Length (m)" inputMode="decimal" value={form.length} onInput={set("length")} error={fieldError("lengthM")} />
                <Field id="profile-beam" label="Beam (m)" inputMode="decimal" value={form.beam} onInput={set("beam")} error={fieldError("beamM")} />
                <Field id="profile-draft" label="Draft (m)" inputMode="decimal" value={form.draft} onInput={set("draft")} error={fieldError("draftM")} />
              </div>
              <Field id="profile-low" label="Low season weekly rate (EUR)" inputMode="decimal" value={form.low} onInput={set("low")} error={fieldError("rates.lowMinor")} />
              <Field id="profile-shoulder" label="Shoulder season weekly rate (EUR)" inputMode="decimal" value={form.shoulder} onInput={set("shoulder")} error={fieldError("rates.shoulderMinor")} />
              <Field id="profile-high" label="High season weekly rate (EUR)" inputMode="decimal" value={form.high} onInput={set("high")} error={fieldError("rates.highMinor")} />
              <div class={wide ? "form__end" : "sticky-bar"} ref={bar}>
                <NoteLine note={save.note} />
                <Button type="submit" pending={save.pending} pendingLabel="Saving profile">Save profile</Button>
              </div>
            </div>
            <aside class="card preview">
              <h2>Figures</h2>
              <HullDrawing name={form.name || y.name} lengthM={Number(form.length) || y.lengthM} beamM={Number(form.beam) || y.beamM} />
              <dl class="details">
                <div><dt>Length</dt><dd class="fig">{figurePreview(form.length)}</dd></div>
                <div><dt>Beam</dt><dd class="fig">{figurePreview(form.beam)}</dd></div>
                <div><dt>Draft</dt><dd class="fig">{figurePreview(form.draft)}</dd></div>
                <div><dt>High season</dt><dd class="fig">{parseMoneyText(form.high) === null ? "—" : formatMoney("EUR", parseMoneyText(form.high)!)}</dd></div>
              </dl>
              <h2>Sale</h2>
              <p class="muted">{status === "on_sale" ? "On sale on the public fleet, broker pages and the sitemap." : "Withdrawn: its public page shows the gone page."}</p>
              {status === "on_sale" ? (
                <Button variant="danger" onClick={withdraw.show} aria-haspopup="dialog" disabled={sale.pending}>Withdraw yacht</Button>
              ) : (
                <Button onClick={back.show} aria-haspopup="dialog" disabled={sale.pending}>Put back on sale</Button>
              )}
              <NoteLine note={sale.note} />
            </aside>
          </form>
        </>
      ) : null}
      <Dialog handle={withdraw} title="Withdraw yacht">
        <p>{y?.name} leaves the public fleet, search, broker pages and the sitemap until it is back on sale.</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={withdraw.hide}>Cancel</Button>
          <Button variant="danger" onClick={() => changeSale("withdraw")}>Withdraw yacht</Button>
        </div>
      </Dialog>
      <Dialog handle={back} title="Put back on sale">
        <p>{y?.name} returns to the public fleet and broker pages.</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={back.hide}>Cancel</Button>
          <Button onClick={() => changeSale("return-to-sale")}>Put back on sale</Button>
        </div>
      </Dialog>
    </section>
  );
}

interface Marina {
  id: string;
  name: string;
  base: Base;
  today: string;
  tariffs: { id: string; effectiveDate: string; ratePerMetreMinor: number; currency: string }[];
}

interface ExchangeTable {
  id: string;
  effectiveDate: string;
  rates: { GBP: string; USD: string };
}

export function Tariffs({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const marinas = useLoad<{ marinas: Marina[] }>(`/api/w/${ws}/marinas`);
  const tables = useLoad<{ exchangeTables: ExchangeTable[] }>(`/api/w/${ws}/exchange-tables`);
  const canAdd = member.role === "finance_lead" || member.role === "fleet_director";
  const tariffDialog = useDialog();
  const tableDialog = useDialog();
  const page = useAction();
  const tariffAction = useAction();
  const tableAction = useAction();
  const [tariff, setTariff] = useState({ marina: "split-marina", date: "", rate: "" });
  const [table, setTable] = useState({ date: "", gbp: "", usd: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const tariffButton = useRef<HTMLButtonElement>(null);
  const tableButton = useRef<HTMLButtonElement>(null);

  const rows = (marinas.data?.marinas ?? []).flatMap((m) => m.tariffs.map((t) => ({ ...t, marina: m.name })));

  const addTariff = (event: Event) => {
    event.preventDefault();
    void tariffAction.run("Adding tariff", async () => {
      const result = await api("POST", `/api/w/${ws}/marinas/${tariff.marina}/tariffs`, {
        effectiveDate: tariff.date,
        ratePerMetreMinor: parseMoneyText(tariff.rate) ?? tariff.rate,
      });
      if (result.ok) {
        tariffDialog.hide();
        await marinas.reload();
        page.setNote(ok(COPY.tariffAdded(formatDay(tariff.date))));
        return null;
      }
      const found = result.body.errors ?? {};
      setErrors(found);
      tariffAction.focusLater(() =>
        focusFirstError([found.effectiveDate ? "tariff-date" : "", found.ratePerMetreMinor ? "tariff-rate" : ""].filter(Boolean), tariffButton.current));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  const addTable = (event: Event) => {
    event.preventDefault();
    void tableAction.run("Adding exchange table", async () => {
      const result = await api("POST", `/api/w/${ws}/exchange-tables`, { effectiveDate: table.date, rates: { GBP: table.gbp, USD: table.usd } });
      if (result.ok) {
        tableDialog.hide();
        await tables.reload();
        page.setNote(ok(COPY.tableAdded(formatDay(table.date))));
        return null;
      }
      const found = result.body.errors ?? {};
      setErrors(found);
      tableAction.focusLater(() =>
        focusFirstError([found.effectiveDate ? "table-date" : "", found["rates.GBP"] ? "table-gbp" : "", found["rates.USD"] ? "table-usd" : ""].filter(Boolean),
          tableButton.current));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  return (
    <section>
      <h1 class="rise">Tariffs and exchange tables</h1>
      <p class="lede">Prices in force from 00:00 local time on their date. Bookings and charters keep the prices they were made with.</p>
      <NoteLine note={page.note} />
      <Loader active={marinas.loading || tables.loading} />
      {marinas.loading || tables.loading ? null : (
      <div class="two-col two-col--even">
        <div class="card">
          <div class="card__head">
            <h2>Marina tariffs</h2>
            {canAdd ? (
              <Button variant="quiet" onClick={(e) => { setErrors({}); tariffAction.setNote(null); tariffDialog.show(e); }} aria-haspopup="dialog">Add tariff</Button>
            ) : null}
          </div>
          <DataTable
            name="Marina tariffs"
            captionHidden
            rows={rows}
            rowKey={(t) => t.id}
            empty="No tariffs yet."
            columns={[
              { label: "Marina", cell: (t) => t.marina },
              { label: "From", cell: (t) => <span class="fig">{formatDay(t.effectiveDate)}</span> },
              { label: "Rate per metre per night", numeric: true, cell: (t) => <span class="fig">{formatMoney(t.currency, t.ratePerMetreMinor)}</span> },
            ]}
          />
        </div>
        <div class="card">
          <div class="card__head">
            <h2>Exchange tables</h2>
            {canAdd ? (
              <Button variant="quiet" onClick={(e) => { setErrors({}); tableAction.setNote(null); tableDialog.show(e); }} aria-haspopup="dialog">Add exchange table</Button>
            ) : null}
          </div>
          <DataTable
            name="Exchange tables"
            captionHidden
            rows={tables.data?.exchangeTables ?? []}
            rowKey={(t) => t.id}
            empty="No exchange tables yet."
            columns={[
              { label: "From", cell: (t) => <span class="fig">{formatDay(t.effectiveDate)}</span> },
              { label: "EUR to GBP", numeric: true, cell: (t) => <span class="fig">{t.rates.GBP}</span> },
              { label: "EUR to USD", numeric: true, cell: (t) => <span class="fig">{t.rates.USD}</span> },
            ]}
          />
        </div>
      </div>
      )}
      <Dialog handle={tariffDialog} title="Add tariff">
        <form class="form" onSubmit={addTariff} noValidate>
          <SelectField
            id="tariff-marina"
            label="Marina"
            value={tariff.marina}
            onChange={(v) => setTariff({ ...tariff, marina: v })}
            options={(marinas.data?.marinas ?? []).map((m) => ({ value: m.id, label: m.name }))}
            first
          />
          <Field id="tariff-date" label="Effective date" value={tariff.date} onInput={(v) => setTariff({ ...tariff, date: v })} error={errors.effectiveDate} hint="YYYY-MM-DD, after the marina's local today" />
          <Field id="tariff-rate" label="Rate per metre per night (EUR)" inputMode="decimal" value={tariff.rate} onInput={(v) => setTariff({ ...tariff, rate: v })} error={errors.ratePerMetreMinor} />
          <NoteLine note={tariffAction.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={tariffAction.pending} pendingLabel="Adding tariff" buttonRef={tariffButton}>Add tariff</Button>
            <Button variant="quiet" onClick={tariffDialog.hide}>Cancel</Button>
          </div>
        </form>
      </Dialog>
      <Dialog handle={tableDialog} title="Add exchange table">
        <form class="form" onSubmit={addTable} noValidate>
          <Field id="table-date" label="Effective date" value={table.date} onInput={(v) => setTable({ ...table, date: v })} error={errors.effectiveDate} first hint="YYYY-MM-DD, after today in Split" />
          <Field id="table-gbp" label="EUR to GBP" inputMode="decimal" value={table.gbp} onInput={(v) => setTable({ ...table, gbp: v })} error={errors["rates.GBP"]} />
          <Field id="table-usd" label="EUR to USD" inputMode="decimal" value={table.usd} onInput={(v) => setTable({ ...table, usd: v })} error={errors["rates.USD"]} />
          <NoteLine note={tableAction.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={tableAction.pending} pendingLabel="Adding exchange table" buttonRef={tableButton}>Add exchange table</Button>
            <Button variant="quiet" onClick={tableDialog.hide}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
