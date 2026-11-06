import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatAmount, formatTime, plainAmount, type Currency } from "../../../../shared/format";
import { patch, post } from "../../api";
import { linkClick, navigate, useLocation } from "../../router";
import { NOT_FOUND } from "../copy";
import { useOffice } from "../context";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { amountInput, ErrorSummary, TextField, useFormId, type Errors } from "../fields";
import { ActionButton, focusId, TableRegion } from "../layout";
import { useResource } from "../resource";
import { OfficeShell } from "../shell";
import { TenderStatusBlock, TenderTitle, type StudioTender } from "../tenderkit";

// /office/tenders/<tender id>/levelling: the levelling table, its view kept in the URL (sort, dir, unpriced, q),
// per-bid levelling and the award.

interface LevelledBid {
  id: string;
  reference: string;
  companyName: string;
  baseCents: number;
  provisionalSums: { label: string; amountCents: number }[];
  provisionalSumsCents: number;
  allowances: { label: string; amountCents: number }[];
  allowancesCents: number;
  exclusions: { id: string; label: string; priceCents: number | null }[];
  pricedExclusionsCents: number;
  unpricedExclusions: number;
  subtotalCents: number;
  contingencyCents: number;
  levelledTotalCents: number;
  finalSubmittedAt: string;
  rank: number;
}

interface Levelling {
  contingencyPercent: string;
  currency: Currency;
  bids: LevelledBid[];
}

type SortKey = "rank" | "bidder" | "base" | "provisional" | "allowances" | "exclusions" | "levelled" | "submitted";

const COLUMNS: { key: SortKey | null; label: string; value?: (bid: LevelledBid) => number | string }[] = [
  { key: "rank", label: "Rank", value: (b) => b.rank },
  { key: "bidder", label: "Bidder", value: (b) => `${b.reference} ${b.companyName}` },
  { key: "base", label: "Base", value: (b) => b.baseCents },
  { key: "provisional", label: "Provisional sums", value: (b) => b.provisionalSumsCents },
  { key: "allowances", label: "Allowances", value: (b) => b.allowancesCents },
  { key: "exclusions", label: "Priced exclusions", value: (b) => b.pricedExclusionsCents },
  { key: null, label: "Contingency" },
  { key: "levelled", label: "Levelled total", value: (b) => b.levelledTotalCents },
  { key: "submitted", label: "Submitted", value: (b) => b.finalSubmittedAt },
];
const SORTS = COLUMNS.flatMap((column) => (column.key ? [column.key] : []));

interface View {
  sort: SortKey;
  dir: "asc" | "desc";
  unpriced: "" | "only" | "hide";
  q: string;
}

function readView(search: string): View {
  const query = new URLSearchParams(search);
  const sort = query.get("sort") as SortKey | null;
  const unpriced = query.get("unpriced");
  return {
    sort: sort && SORTS.includes(sort) ? sort : "rank",
    dir: query.get("dir") === "desc" ? "desc" : "asc",
    unpriced: unpriced === "only" || unpriced === "hide" ? unpriced : "",
    q: query.get("q") ?? "",
  };
}

function viewUrl(pathname: string, view: View, explicitSort: boolean): string {
  const query = new URLSearchParams();
  if (explicitSort) {
    query.set("sort", view.sort);
    query.set("dir", view.dir);
  }
  if (view.unpriced) query.set("unpriced", view.unpriced);
  if (view.q) query.set("q", view.q);
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

export function LevellingPage({ id }: { id: string }) {
  const office = useOffice();
  const location = useLocation();
  const view = readView(location.search);
  const explicitSort = new URLSearchParams(location.search).has("sort");
  const tender = useResource<{ tender: StudioTender }>(office.member ? `/api/tenders/${id}` : null);
  const levelling = useResource<Levelling>(office.member ? `/api/tenders/${id}/levelling` : null);
  const searching = useRef(false);
  const canAct = office.member?.role === "director" || office.member?.role === "project_lead";
  const [levelBid, setLevelBid] = useState<LevelledBid | null>(null);
  const [awarding, setAwarding] = useState(false);

  const change = (next: Partial<View>, fromSearch = false): void => {
    const url = viewUrl(location.pathname, { ...view, ...next }, explicitSort || "sort" in next);
    navigate(url, { replace: fromSearch && searching.current });
    searching.current = fromSearch;
  };

  const sortBy = (key: SortKey): void => change({ sort: key, dir: view.sort === key && view.dir === "asc" ? "desc" : "asc" });

  const data = levelling.data;
  const column = COLUMNS.find((c) => c.key === view.sort) ?? COLUMNS[0];
  const needle = view.q.trim().toLowerCase();
  const rows = (data?.bids ?? [])
    .filter((bid) => !needle || bid.reference.toLowerCase().includes(needle) || bid.companyName.toLowerCase().includes(needle))
    .filter((bid) => (view.unpriced === "only" ? bid.unpricedExclusions > 0 : view.unpriced === "hide" ? bid.unpricedExclusions === 0 : true))
    .sort((a, b) => {
      const x = column.value?.(a) ?? 0;
      const y = column.value?.(b) ?? 0;
      const order = x < y ? -1 : x > y ? 1 : a.rank - b.rank;
      return view.dir === "asc" ? order : -order;
    });
  const money = (cents: number): string => (data ? formatAmount(data.currency, cents) : "");
  const zone = tender.data?.tender.timeZone ?? "Asia/Hong_Kong";

  let body;
  if (levelling.failure || tender.failure) {
    const notOpened = levelling.failure?.error === "tender_not_opened";
    body = (
      <section className="panel panel-body">
        <h1>{notOpened ? "Bids not opened yet" : "Not found"}</h1>
        <p>{notOpened ? "The levelling table appears once the bids are opened after close." : NOT_FOUND}</p>
      </section>
    );
  } else if (!data || !tender.data) {
    body = <p className="loading-line">Loading levelling…</p>;
  } else {
    const t = tender.data.tender;
    body = (
      <>
        <div className="page-head">
          <div>
            <p className="eyebrow">
              <a href={`/office/tenders/${t.id}`} onClick={(event) => linkClick(event, `/office/tenders/${t.id}`)}>{t.project.reference} {t.title}</a>
            </p>
            <h1>Levelling</h1>
          </div>
          <div className="actions">
            <a className="button" href={`/api/tenders/${t.id}/levelling.csv`} download>Export levelling CSV</a>
            {canAct && t.actions.includes("award") && (
              <button id="award" type="button" className="button button-primary" onClick={() => setAwarding(true)}>Award</button>
            )}
          </div>
        </div>
        <section className="panel">
          <TenderTitle projectId={t.project.id} />
          <div className="panel-body">
            <TenderStatusBlock status={t.status} />
            <p className="muted">Levelled total = base − provisional sums + allowances + priced exclusions, plus {data.contingencyPercent}% contingency.
              Unpriced exclusions count as zero until priced.</p>
            <div className="levelling-controls">
              <div className="field">
                <label htmlFor="find-bidder">Find bidder</label>
                <input id="find-bidder" className="input" type="search" value={view.q} onChange={(event) => change({ q: event.target.value }, true)} />
              </div>
              <div className="field">
                <label htmlFor="unpriced-filter">Unpriced exclusions</label>
                <select id="unpriced-filter" className="input" value={view.unpriced || "all"}
                  onChange={(event) => change({ unpriced: event.target.value === "all" ? "" : (event.target.value as View["unpriced"]) })}>
                  <option value="all">Show all</option>
                  <option value="only">Only unpriced</option>
                  <option value="hide">Hide unpriced</option>
                </select>
              </div>
            </div>
          </div>
          <TableRegion label="Levelling table, scrolls sideways" className="levelling-region">
            <table className="levelling-table" aria-label="Levelling">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.label} scope="col" className={c.key === "bidder" ? "pin" : c.key && c.key !== "rank" ? "num" : undefined}
                      aria-sort={c.key && c.key === view.sort ? (view.dir === "asc" ? "ascending" : "descending") : undefined}>
                      {c.key ? (
                        <button type="button" className="sort-button" onClick={() => c.key && sortBy(c.key)}>
                          {c.label}
                          <span className="sort-mark" aria-hidden="true">{c.key === view.sort ? (view.dir === "asc" ? "▲" : "▼") : ""}</span>
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((bid) => (
                  <tr key={bid.id}>
                    <td>{bid.rank}</td>
                    <td className="pin">
                      <span className="bidder-name">{bid.reference} {bid.companyName}</span>
                      {canAct && t.actions.includes("level") && (
                        <button id={`level-${bid.reference}`} type="button" className="button level-button" onClick={() => setLevelBid(bid)}>
                          Level {bid.reference}
                        </button>
                      )}
                    </td>
                    <td className="num">{money(bid.baseCents)}</td>
                    <td className="num">{money(bid.provisionalSumsCents)}</td>
                    <td className="num">{money(bid.allowancesCents)}</td>
                    <td className="num">
                      {money(bid.pricedExclusionsCents)}
                      {bid.unpricedExclusions > 0 && <span className="unpriced">{bid.unpricedExclusions} unpriced</span>}
                    </td>
                    <td className="num">{money(bid.contingencyCents)}</td>
                    <td className="num total">{money(bid.levelledTotalCents)}</td>
                    <td>{formatTime(bid.finalSubmittedAt, zone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
          {!rows.length && <p className="panel-body empty-line">No bids match this view.</p>}
        </section>
        {levelBid && (
          <LevelDialog key={levelBid.id} bid={levelBid} onClose={() => setLevelBid(null)} reload={levelling.reload} />
        )}
        <AwardDialog open={awarding} tenderId={t.id} bids={data.bids} onClose={() => setAwarding(false)}
          reload={async () => {
            await tender.reload();
            await levelling.reload();
          }} />
      </>
    );
  }
  return <OfficeShell title="Levelling">{body}</OfficeShell>;
}

interface SumDraft {
  label: string;
  amount: string;
}

function LevelDialog({ bid, onClose, reload }: { bid: LevelledBid; onClose: () => void; reload: () => Promise<unknown> }) {
  const office = useOffice();
  const form = useFormId("level");
  const [open, setOpen] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [allowances, setAllowances] = useState<SumDraft[]>(bid.allowances.map((a) => ({ label: a.label, amount: plainAmount(a.amountCents) })));
  const [prices, setPrices] = useState<string[]>(bid.exclusions.map((e) => (e.priceCents === null ? "" : plainAmount(e.priceCents))));

  const close = (): void => {
    flushSync(() => setOpen(false));
    onClose();
  };

  const save = async (): Promise<void> => {
    office.announce("Saving…");
    const result = await patch(`/api/bids/${bid.id}/levelling`, {
      allowances: allowances.filter((a) => a.label || a.amount).map((a) => ({ label: a.label, amountCents: amountInput(a.amount) })),
      exclusionPrices: bid.exclusions.map((e, index) => ({ exclusionId: e.id, priceCents: prices[index].trim() ? amountInput(prices[index]) : null })),
    });
    if (result.ok) {
      office.announce(`Levelling for ${bid.reference} saved.`);
      close();
      await reload();
      focusId(`level-${bid.reference}`);
      return;
    }
    office.announce("");
    const refusal = office.refused(result, { id: `level-${bid.reference}`, values: { allowances, prices } });
    if (!refusal) return;
    flushSync(() => setErrors(refusal.errors ?? {}));
    if (!refusal.errors) office.alert("That can't be done once the tender is awarded.");
    focusRefusal(openDialog());
  };

  return (
    <Dialog title={`Level ${bid.reference}`} open={open} onCancel={close}
      actions={<ActionButton primary type="submit" pending="Saving…" onAction={save}>Save levelling</ActionButton>}>
      <ErrorSummary errors={errors} form={form} />
      <p className="muted">{bid.reference} {bid.companyName}</p>
      <h3>Practice allowances</h3>
      {allowances.map((allowance, index) => (
        <div key={index} className="pair">
          <TextField form={form} name={`allowances[${index}].label`} label="Allowance label" value={allowance.label}
            onChange={(label) => setAllowances((list) => list.map((a, i) => (i === index ? { ...a, label } : a)))} error={errors[`allowances[${index}].label`]} />
          <TextField form={form} name={`allowances[${index}].amountCents`} label="Allowance amount" inputMode="decimal" value={allowance.amount}
            onChange={(amount) => setAllowances((list) => list.map((a, i) => (i === index ? { ...a, amount } : a)))} error={errors[`allowances[${index}].amountCents`]} />
        </div>
      ))}
      <button type="button" className="button" onClick={() => setAllowances((list) => [...list, { label: "", amount: "" }])}>Add allowance</button>
      <h3 className="spaced">Exclusions</h3>
      {!bid.exclusions.length && <p className="muted">This bid lists no exclusions.</p>}
      {bid.exclusions.map((exclusion, index) => (
        <TextField key={exclusion.id} form={form} name={`exclusionPrices[${index}].priceCents`} label={`Price for ${exclusion.label}`}
          inputMode="decimal" value={prices[index]} onChange={(value) => setPrices((list) => list.map((p, i) => (i === index ? value : p)))}
          error={errors[`exclusionPrices[${index}].priceCents`]} />
      ))}
    </Dialog>
  );
}

function AwardDialog({ open, tenderId, bids, onClose, reload }: {
  open: boolean; tenderId: string; bids: LevelledBid[]; onClose: () => void; reload: () => Promise<unknown>;
}) {
  const office = useOffice();
  const form = useFormId("award");
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const ranked = [...bids].sort((a, b) => a.rank - b.rank);

  const award = async (): Promise<void> => {
    office.announce("Awarding…");
    const result = await post<{ tender: StudioTender; contract: { companyName: string } }>(`/api/tenders/${tenderId}/award`,
      { bidId: choice, ...(reason.trim() ? { reason } : {}) });
    if (result.ok) {
      office.announce(`Awarded to ${result.data.contract.companyName}.`);
      flushSync(() => {
        setErrors({});
        setError("");
        onClose();
      });
      await reload();
      focusId("tender-status");
      return;
    }
    office.announce("");
    const refusal = office.refused(result, { id: "award", values: { choice, reason } });
    if (!refusal) return;
    let copy = "";
    if (refusal.error === "unpriced_exclusions") copy = `Price every exclusion before awarding. ${String(refusal.count)} are still unpriced.`;
    else if (refusal.error === "contract_exists") copy = "This project already has a contract.";
    else if (!refusal.errors) copy = "That can't be done while this tender is awarded.";
    if (copy) office.alert(copy);
    flushSync(() => {
      setErrors(refusal.errors ?? {});
      setError(copy);
    });
    focusRefusal(openDialog());
  };

  return (
    <Dialog title="Award tender" open={open} onCancel={onClose} error={error}
      actions={<ActionButton primary type="submit" pending="Awarding…" onAction={award}>Confirm award</ActionButton>}>
      <ErrorSummary errors={errors} form={form} />
      <fieldset>
        <legend>Award to</legend>
        {ranked.map((bid) => (
          <label key={bid.id} className="check">
            <input type="radio" name={`${form}-bid`} value={bid.id} checked={choice === bid.id} onChange={() => setChoice(bid.id)} />
            {bid.reference} {bid.companyName}
          </label>
        ))}
        {errors.bidId && <span className="field-error" tabIndex={-1}>{errors.bidId}</span>}
      </fieldset>
      <TextField form={form} name="reason" label="Reason for not awarding the lowest" multiline value={reason} onChange={setReason} error={errors.reason}
        hint="Needed only when the bid you choose isn't ranked first." />
    </Dialog>
  );
}
