import { COPY, formatDate, rupees } from "../../../shared/copy";
import type { NoticeDetail, NoticeVersion } from "../../../shared/types";
import { DataTable } from "../../lib/DataTable";
import { useWide } from "../../lib/hooks";

const PRINT: Record<NoticeVersion["printState"], string> = { pending: "Print pending", printable: "Printable", failed: "Print failed" };

export function PublishedNotices({ notices, retrying, onRetry, onCorrect }: { notices: NoticeDetail[]; retrying: Set<string>; onRetry: (number: string, version: number) => void; onCorrect: (number: string) => void }) {
  const wide = useWide();
  return (
    <section class="published" aria-label="Published notices">
      <h2>Published notices</h2>
      {notices.map((n) => {
        const latest = n.versions[0]!;
        return (
          <article key={n.number} class="published-notice">
            <h3>{n.number}</h3>
            <p class="version-line">
              {latest.title} · effective {formatDate(latest.effectiveDate)}
            </p>
            <DataTable
              label={`Rows of ${n.number}`}
              wide={wide}
              columns={[{ head: "Pack", lead: true }, { head: "Old MRP" }, { head: "Revised MRP" }, { head: "Kind" }]}
              rows={latest.rows.map((r) => ({ key: r.skuCode, cells: [r.name, `Rs ${rupees(r.oldMrpPaise)}`, `Rs ${rupees(r.revisedMrpPaise)}`, r.kind === "sticker" ? "Sticker" : "New print"] }))}
            />
            <ul role="list" class="version-states">
              {n.versions.map((v) => {
                const key = `${n.number}#${v.version}`;
                return (
                  <li key={v.version}>
                    <span>
                      Version {v.version}: {PRINT[v.printState]}
                    </span>
                    {v.supersededBy !== null && <span> · Superseded by version {v.supersededBy}</span>}
                    {v.printState === "failed" && <span class="pdf-note"> {COPY.printOutage}</span>}
                    {v.printState === "failed" && (
                      <button type="button" class="rect-button small" data-keep={`retry-${key}`} aria-disabled={retrying.has(key) ? "true" : undefined} aria-label={`Retry print ${n.number} version ${v.version}`} onClick={() => onRetry(n.number, v.version)}>
                        <span aria-hidden="true">Retry print</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" class="rect-button small" data-keep={`correct-${n.number}`} onClick={() => onCorrect(n.number)}>
              Correct notice {n.number}
            </button>
          </article>
        );
      })}
    </section>
  );
}
