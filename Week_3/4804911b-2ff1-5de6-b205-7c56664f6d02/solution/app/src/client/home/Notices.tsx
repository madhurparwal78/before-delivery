import { COPY, formatDate, rupees } from "../../shared/copy";
import type { Catalogue, NoticeVersion } from "../../shared/types";
import { DataTable } from "../lib/DataTable";
import type { Links } from "../lib/links";
import { useWide } from "../lib/hooks";
import { Icon } from "../lib/icons";

export interface NoticeSummary {
  number: string;
  state: "scheduled" | "in_effect";
  currentVersion: NoticeVersion;
}

export const linkKey = (number: string, version: number): string => `${number}-v${version}`;
export const linkPath = (number: string, version: number): string => `/api/notices/${number}/versions/${version}/link`;

function currentSources(notices: NoticeSummary[]): Map<string, string> {
  const best = new Map<string, { date: string; text: string }>();
  for (const n of notices) {
    if (n.state !== "in_effect") continue;
    for (const row of n.currentVersion.rows) {
      const date = n.currentVersion.effectiveDate;
      const have = best.get(row.skuCode);
      if (!have || have.date < date) best.set(row.skuCode, { date, text: `${n.number} v${n.currentVersion.version}` });
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.text]));
}

export function PdfSlot({ number, version, printState, links, label }: { number: string; version: number; printState: NoticeVersion["printState"]; links: Links; label?: string }) {
  const key = linkKey(number, version);
  const url = printState === "printable" ? links.url(key) : null;
  if (printState === "pending") return <p class="pdf-note">{COPY.stillPrinting}</p>;
  if (printState === "failed") return <p class="pdf-note">{COPY.printOutage}</p>;
  if (!url) return <p class="pdf-note pdf-wait">{links.sentence || ""}</p>;
  return (
    <a class="rect-button pdf-link" href={url} data-link-key={key} data-keep={`link-${key}`}>
      <Icon name="download" size={20} />
      <span>{label ?? `Download notice ${number} version ${version}`}</span>
    </a>
  );
}

export function PriceNotices({ catalogue, notices, links }: { catalogue: Catalogue | null; notices: NoticeSummary[]; links: Links }) {
  const wide = useWide();
  const ordered = [...notices].sort((a, b) => (a.currentVersion.effectiveDate < b.currentVersion.effectiveDate ? 1 : a.currentVersion.effectiveDate > b.currentVersion.effectiveDate ? -1 : 0));
  const sources = currentSources(notices);
  const skus = catalogue?.drinks.flatMap((d) => d.skus) ?? [];
  const failed = notices.some((n) => n.currentVersion.printState === "failed");
  const status = links.sentence || (failed ? COPY.printOutage : "");
  return (
    <section id="price-notices" class="reel price-notices" aria-label="Price Notices">
      <h2>Price Notices</h2>
      <div role="status" aria-label="Print status" class="status print-status focus-target" tabIndex={-1} ref={links.registerStatus}>
        {status}
      </div>
      {ordered.length === 0 && (
        <div class="slide">
          <p class="slide-line">REEL CHANGE</p>
          <p class="slide-sentence">One moment while the next reel is threaded.</p>
        </div>
      )}
      <div class="listings">
        {ordered.map((n) => {
          const v = n.currentVersion;
          return (
            <article class="listing" key={n.number}>
              <header>
                <h3>{v.title}</h3>
                <p class="when">
                  {n.number} · effective {formatDate(v.effectiveDate)}
                </p>
              </header>
              <div class="listing-body">
                <DataTable
                  label={`Revised prices ${n.number}`}
                  wide={wide}
                  columns={[{ head: "Pack", lead: true }, { head: "Old MRP" }, { head: "Revised MRP" }, { head: "Kind" }]}
                  rows={v.rows.map((r) => ({
                    key: r.skuCode,
                    cells: [r.name, `Rs ${rupees(r.oldMrpPaise)}`, `Rs ${rupees(r.revisedMrpPaise)}`, r.kind === "sticker" ? "Sticker" : "New print"],
                  }))}
                />
                {v.runOutUntil && <p class="run-out">Old wrappers allowed until {formatDate(v.runOutUntil)}</p>}
                <PdfSlot number={n.number} version={v.version} printState={v.printState} links={links} />
              </div>
            </article>
          );
        })}
      </div>
      <h3 class="current-heading">Current prices</h3>
      <div class="current">
        <DataTable
          label="Current prices"
          wide={wide}
          columns={[{ head: "Pack", lead: true }, { head: "Print MRP" }, { head: "Source notice" }]}
          rows={skus.map((s) => ({ key: s.code, cells: [s.name, `Rs ${rupees(s.currentMrpPaise)}`, sources.get(s.code) ?? "Launch print"] }))}
        />
      </div>
    </section>
  );
}
