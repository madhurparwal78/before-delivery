// Price lists: every version with its standing, Withdraw on scheduled versions, and the New price list form.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PriceList, School } from "../../shared/api.js";
import { formatMoney, formatTaxPercent, parseDollars, parsePercent, plainDollars } from "../../shared/money.js";
import { priceListInForce, standingOf } from "../../shared/priceLists.js";
import { formatDate, storeDateOf } from "../../shared/storeTime.js";
import { INSTRUMENT_TYPES, instrumentName } from "../../shared/vocabulary.js";
import { call, isNetworkOrServerFailure, NETWORK_COPY } from "../api.js";
import { useFieldErrors } from "../components/fieldErrors.js";
import { errorNotice, Dialog, Field, info, quiet, Status, type Notice } from "../components/ui.js";
import { useBand } from "../hooks.js";

const MONEY_KEYS = [["base_rent_cents", "monthly rent"], ["waiver_cents", "waiver"], ["purchase_price_cents", "purchase price"]] as const;
type MoneyKey = (typeof MONEY_KEYS)[number][0];
interface TierDraft { name: string; from: string; to: string; percent: string }
type Draft = { effective: string; tax: string; items: Record<string, Record<MoneyKey, string>>; tiers: TierDraft[] };

function draftFrom(version: PriceList | undefined): Draft {
  return {
    effective: "",
    tax: version ? plainDollars(version.tax_rate_bp) : "",
    items: Object.fromEntries(INSTRUMENT_TYPES.map((t) => {
      const item = version?.items.find((i) => i.instrument_type === t);
      return [t, { base_rent_cents: item ? plainDollars(item.base_rent_cents) : "", waiver_cents: item ? plainDollars(item.waiver_cents) : "",
        purchase_price_cents: item ? plainDollars(item.purchase_price_cents) : "" }];
    })),
    tiers: version ? version.tiers.map((t) => ({ name: t.name, from: String(t.from_month), to: t.to_month === null ? "" : String(t.to_month),
      percent: String(t.percent) })) : [{ name: "", from: "0", to: "", percent: "" }],
  };
}

/** A whole number the form can read, or `null` so the server's message for that field comes back. */
function whole(text: string): number | null {
  return /^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) : null;
}

function formOrder(tiers: number): string[] {
  return ["effective_date", "tax_rate_bp",
    ...INSTRUMENT_TYPES.flatMap((t) => MONEY_KEYS.map(([k]) => `items.${t}.${k}`)),
    ...Array.from({ length: tiers }, (_, i) => ["name", "from_month", "to_month", "percent"].map((k) => `tiers.${i}.${k}`)).flat()];
}

export function PriceLists(): ReactNode {
  const band = useBand();
  const [lists, setLists] = useState<PriceList[] | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<Notice>(quiet);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState<PriceList | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const succeeded = useRef(false);
  const fields = useFieldErrors("price-list");

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([call<{ price_lists: PriceList[] }>("GET", "/api/price-lists"),
      call<{ schools: School[]; server_now: string }>("GET", "/api/schools")]);
    if (!l.ok || !s.ok) {
      setNotice(errorNotice(NETWORK_COPY));
      return;
    }
    const day = storeDateOf(new Date(s.data.server_now));
    setLists(l.data.price_lists);
    setToday(day);
    setDraft((d) => d ?? draftFrom(priceListInForce(l.data.price_lists, day)));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const update = (change: (d: Draft) => Draft): void => setDraft((d) => (d ? change(d) : d));

  const publish = (): void => {
    if (!draft) return;
    setBusy(true);
    setNotice(info("Publishing…"));
    const body = {
      effective_date: draft.effective.trim(),
      tax_rate_bp: parsePercent(draft.tax),
      items: INSTRUMENT_TYPES.map((t) => ({ instrument_type: t, base_rent_cents: parseDollars(draft.items[t].base_rent_cents),
        waiver_cents: parseDollars(draft.items[t].waiver_cents), purchase_price_cents: parseDollars(draft.items[t].purchase_price_cents) })),
      tiers: draft.tiers.map((t) => ({ name: t.name, from_month: whole(t.from), to_month: t.to.trim() === "" ? null : whole(t.to),
        percent: whole(t.percent) })),
    };
    void call<{ price_list: PriceList }>("POST", "/api/price-lists", body).then(async (r) => {
      setBusy(false);
      if (r.ok) {
        fields.clear();
        setNotice(info(`Price list ${r.data.price_list.id} takes effect ${formatDate(r.data.price_list.effective_date)}. Contracts signed before then keep their terms.`));
        update((d) => ({ ...d, effective: "" }));
        await load();
      } else if (r.status === 422 && r.error?.fields) {
        const shown: Record<string, string> = { ...r.error.fields };
        const attach = (whole: string, to: string): void => {
          if (shown[whole]) shown[to] = shown[to] ? `${shown[to]} ${shown[whole]}` : shown[whole];
        };
        attach("items", "items.flute.base_rent_cents");
        attach("tiers", "tiers.0.name");
        setNotice(errorNotice("Check the highlighted fields."));
        fields.show(shown, formOrder(draft.tiers.length));
      } else {
        setNotice(errorNotice(isNetworkOrServerFailure(r) ? NETWORK_COPY : "Check the highlighted fields."));
      }
    });
  };

  const withdraw = (version: PriceList): void => {
    setBusy(true);
    setNotice(info("Withdrawing…"));
    void call("POST", `/api/price-lists/${encodeURIComponent(version.id)}/withdraw`, {}).then(async (r) => {
      setBusy(false);
      if (r.ok) {
        succeeded.current = true;
        setWithdrawing(null);
        setNotice(info(`Price list ${version.id} withdrawn before it took effect.`));
        await load();
      } else if (r.error?.code === "price_list_in_force") {
        setNotice(errorNotice(`${version.id} is already in force and can't be withdrawn.`));
      } else if (r.error?.code === "price_list_withdrawn") {
        setNotice(errorNotice(`${version.id} was already withdrawn.`));
      } else {
        setNotice(errorNotice(NETWORK_COPY));
      }
    });
  };

  const input = (key: string, label: string, value: string, set: (v: string) => void, figure = true, group?: string): ReactNode => (
    <Field label={label} group={group} htmlFor={fields.bind(key).id} error={fields.errors[key]} errorId={fields.errorId(key)}>
      <input {...fields.bind(key)} className={figure ? "figure" : undefined} value={value} onChange={(e) => set(e.currentTarget.value)} />
    </Field>
  );

  return (
    <section className="page price-lists">
      <header className="page__head">
        <p className="eyebrow">Keel &amp; Bell Music</p>
        <h1>Price lists</h1>
        <p className="lede">Each version sets rents, the sales tax rate and the buyout discount schedule from its effective date. Signed contracts keep the version they were signed under; tax always follows the rate in force when billed.</p>
        <Status ref={status} label="Price list status" notice={notice} />
      </header>
      {lists === null || today === null ? <p className="muted">Loading price lists…</p> : (
        <table className={`price-table price-table--${band}`} aria-label="Price lists" role="table">
          <thead role="rowgroup">
            <tr role="row">
              {["ID", "Effective date", "Tax rate", "Status", ...INSTRUMENT_TYPES.map(instrumentName)].map((h) => <th key={h} scope="col" role="columnheader">{h}</th>)}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {lists.map((v) => {
              const standing = standingOf(v, lists, today);
              return (
                <tr key={v.id} role="row" className={`price-row price-row--${standing.toLowerCase().replace(" ", "-")}`}>
                  <td role="cell" data-label="ID">
                    <span className="figure">{v.id}</span>
                    <ul className="tier-list tier-list--compact">{v.tiers.map((t) => <li key={t.from_month}><span className="label-caps">{t.name}</span> <span className="figure">{t.from_month}{t.to_month === null ? "+" : `–${t.to_month}`}</span> · {t.percent}%</li>)}</ul>
                  </td>
                  <td role="cell" data-label="Effective date" className="figure">{formatDate(v.effective_date)}</td>
                  <td role="cell" data-label="Tax rate" className="figure">{formatTaxPercent(v.tax_rate_bp)}</td>
                  <td role="cell" data-label="Status">
                    <span className={`standing standing--${standing.toLowerCase().replace(" ", "-")}`}>{standing}</span>
                    {standing === "Scheduled" && (
                      <button type="button" className="button button--danger button--small" onClick={(event) => {
                        opener.current = event.currentTarget;
                        succeeded.current = false;
                        setWithdrawing(v);
                      }}>Withdraw {v.id}</button>
                    )}
                  </td>
                  {INSTRUMENT_TYPES.map((t) => {
                    const item = v.items.find((i) => i.instrument_type === t);
                    return (
                      <td key={t} role="cell" data-label={instrumentName(t)} className="figure">
                        {item ? formatMoney(item.base_rent_cents) : ""}
                        {item && <span className="cell-note">buy {formatMoney(item.purchase_price_cents)}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {draft && (
        <form className="form price-form" aria-label="New price list" noValidate onSubmit={(event) => {
          event.preventDefault();
          publish();
        }}>
          <h2>New price list</h2>
          <div className="price-form__row">
            {input("effective_date", "Effective date", draft.effective, (v) => update((d) => ({ ...d, effective: v })))}
            {input("tax_rate_bp", "Sales tax rate", draft.tax, (v) => update((d) => ({ ...d, tax: v })))}
          </div>
          <p className="muted">Dates as YYYY-MM-DD, today or later. The tax rate is a percent such as 8.25; money is in dollars.</p>
          <div className="price-form__items">
            {INSTRUMENT_TYPES.map((t) => (
              <fieldset key={t} className="price-form__item">
                <legend className="label-caps">{instrumentName(t)}</legend>
                {MONEY_KEYS.map(([k, word]) => (
                  <div key={k}>{input(`items.${t}.${k}`, word, draft.items[t][k],
                    (v) => update((d) => ({ ...d, items: { ...d.items, [t]: { ...d.items[t], [k]: v } } })), true, instrumentName(t))}</div>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="price-form__tiers">
            {draft.tiers.map((tier, i) => (
              <fieldset key={i} className="price-form__tier">
                <legend className="label-caps">Tier {i + 1}</legend>
                {input(`tiers.${i}.name`, "name", tier.name, (v) => update((d) => ({ ...d, tiers: d.tiers.map((t, j) => (j === i ? { ...t, name: v } : t)) })), false, `Tier ${i + 1}`)}
                {input(`tiers.${i}.from_month`, "from month", tier.from, (v) => update((d) => ({ ...d, tiers: d.tiers.map((t, j) => (j === i ? { ...t, from: v } : t)) })), true, `Tier ${i + 1}`)}
                {input(`tiers.${i}.to_month`, "to month", tier.to, (v) => update((d) => ({ ...d, tiers: d.tiers.map((t, j) => (j === i ? { ...t, to: v } : t)) })), true, `Tier ${i + 1}`)}
                {input(`tiers.${i}.percent`, "percent", tier.percent, (v) => update((d) => ({ ...d, tiers: d.tiers.map((t, j) => (j === i ? { ...t, percent: v } : t)) })), true, `Tier ${i + 1}`)}
              </fieldset>
            ))}
          </div>
          <div className="form__actions">
            <button type="button" className="button button--secondary" onClick={() => update((d) => ({ ...d, tiers: [...d.tiers, { name: "", from: "", to: "", percent: "" }] }))}>Add tier</button>
            <button type="submit" className="button button--primary" disabled={busy}>Publish price list</button>
          </div>
        </form>
      )}
      <Dialog open={withdrawing !== null} title="Confirm withdrawal" onClose={() => setWithdrawing(null)}
        returnFocus={() => (succeeded.current ? status.current : opener.current)}>
        {withdrawing && (
          <>
            <p>Withdraw {withdrawing.id} before it takes effect on {formatDate(withdrawing.effective_date)}? Contracts and reservations keep the terms in force without it.</p>
            <div className="dialog__actions">
              <button type="button" className="button button--danger" disabled={busy} onClick={() => withdraw(withdrawing)}>Withdraw price list</button>
              <button type="button" className="button button--secondary" onClick={() => setWithdrawing(null)}>Cancel</button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}
