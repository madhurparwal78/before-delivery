/** The cloth ledger: filter and page live in the address, and only the newest answer is ever shown. */
import { useEffect, type CSSProperties } from "react";
import { getJson } from "../api.js";
import { useLive } from "../live.js";
import { useRouter } from "../router.js";
import { answered, DataTable, EmptyState, SelectField, UnitPair, useCollection, useLoad } from "../ui.js";
import { PageHeading } from "./chrome.js";
import { instantText } from "../format.js";
import { EMPTY } from "../../shared/copy.js";
import { areaParts, areaText, lengthText } from "../../shared/units.js";
import type { LedgerPage as LedgerAnswer, Stock } from "../../shared/types.js";

/** An amount with a leading hyphen-minus when the line is negative, each unit kept whole on its line. */
function LineAmount({ mm2 }: { mm2: number }) {
  const [metric, imperial] = areaParts(Math.abs(mm2));
  return <UnitPair parts={[`${mm2 < 0 ? "-" : ""}${metric}`, imperial]} />;
}

export function LedgerPage() {
  const { location, navigate } = useRouter();
  const { refuse } = useLive();
  const params = new URLSearchParams(location.search);
  const stock = params.get("stock") ?? "";
  const cursor = params.get("cursor");
  const codes = useCollection<Stock>("/api/stock", Number.POSITIVE_INFINITY);
  const ledger = useLoad(
    (signal) => getJson<LedgerAnswer>(`/api/ledger?limit=20${stock ? `&stock=${encodeURIComponent(stock)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal),
    [location.search],
  );

  useEffect(() => {
    const message = ledger.error?.fields.cursor;
    if (!message) return;
    refuse(message);
    navigate(`/ledger${stock ? `?stock=${encodeURIComponent(stock)}` : ""}`, { replace: true, state: { alert: true } });
  }, [ledger.error, navigate, refuse, stock]);

  const go = (nextStock: string, nextCursor: string | null) => {
    const query = new URLSearchParams();
    if (nextStock) query.set("stock", nextStock);
    if (nextCursor) query.set("cursor", nextCursor);
    const text = query.toString();
    navigate(`/ledger${text ? `?${text}` : ""}`);
  };

  const options = [{ value: "", label: "All stock" }, ...[...codes.items].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((item) => ({ value: item.code, label: item.code }))];
  const answer = ledger.data;
  const footer = answer?.footer;
  return (
    <main className="page">
      <section className="field-ground">
        <PageHeading>Cloth ledger</PageHeading>
        <SelectField label="Stock" value={stock} onChange={(value) => go(value, null)} options={options} />
      </section>
      {!answered(codes, ledger) ? null : <>
      <section className="field-surface">
        {answer && answer.items.length === 0 ? (
          <EmptyState>{EMPTY.ledger}</EmptyState>
        ) : (
          <DataTable
            label="Ledger lines"
            headers={["Line", "Posted", "Account", "Stock", "Drawing", "Amount", "Actor", "Reason"]}
            rows={(answer?.items ?? []).map((line, index) => ({
              key: String(line.line_id),
              style: { "--n": Math.min(index + 1, 10) } as CSSProperties,
              groupStart: index === 0 || answer!.items[index - 1]!.pair_id !== line.pair_id,
              cells: [line.line_id, instantText(line.posted_at), line.account, line.stock_code, line.drawing_code, <LineAmount key="a" mm2={line.amount_mm2} />, line.actor_email, line.reason],
            }))}
          />
        )}
        <div className="actions">
          <button type="button" className="button" disabled={!answer?.next_cursor} onClick={() => answer?.next_cursor && go(stock, answer.next_cursor)}>
            Older lines
          </button>
          <button type="button" className="button" disabled={!cursor} onClick={() => go(stock, null)}>
            Newest lines
          </button>
        </div>
      </section>
      <section role="region" aria-label="Ledger footer" className="field-black footer-field">
        {footer ? (
          <dl className="figures">
            {footer.stock_code ? (
              <div>
                <dt>{`Remaining on ${footer.stock_code}`}</dt>
                <dd>{lengthText(footer.remaining_mm ?? 0)}</dd>
              </div>
            ) : null}
            <div>
              <dt>On hand</dt>
              <dd>{areaText(footer.on_hand_mm2)}</dd>
            </div>
            <div>
              <dt>Offcuts</dt>
              <dd>{footer.offcut_count}</dd>
            </div>
            <div>
              <dt>Lines</dt>
              <dd>{footer.lines}</dd>
            </div>
          </dl>
        ) : null}
      </section>
      </>}
    </main>
  );
}
