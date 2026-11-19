import type { Ledger } from "../../shared/api.ts";
import { formatDateTime, formatFern, formatFernUnit } from "../../shared/units.ts";
import { Page } from "../components/Page.tsx";
import { LinkPill } from "../components/Pill.tsx";
import { Empty, Loading } from "../components/StrandCanvas.tsx";
import { display } from "../lib/config.ts";
import { useJson } from "../lib/resource.ts";
import { useMe } from "../lib/session.tsx";
import { useWorkspace } from "../lib/workspace.tsx";

export function LedgerPage() {
  const { id } = useWorkspace();
  const me = useMe();
  const ledger = useJson<Ledger>(`/api/w/${id}/ledger?account=member:${me.user.id}`);

  const rows = (() => {
    if (!ledger.data) return [];
    let balance = 0;
    const chronological = [...ledger.data.entries].reverse().map((entry) => {
      balance += entry.amountUfern;
      return { entry, balance };
    });
    return chronological.reverse();
  })();

  return (
    <Page title="Ledger">
      {ledger.data && <p className="readout">Balance {formatFernUnit(ledger.data.balanceUfern)}</p>}
      <section className="panel" tabIndex={0}>
        {ledger.data ? (
          <>
            <table aria-label="Ledger">
              <thead><tr><th scope="col">Time</th><th scope="col">Height</th><th scope="col">Entry</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Balance after</th></tr></thead>
              <tbody>
                {rows.map(({ entry, balance }) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.at, display.timeZone)} </td>
                    <td>{entry.height} </td>
                    <td>{entry.label} </td>
                    <td className="num">{formatFern(entry.amountUfern)} </td>
                    <td className="num">{formatFern(balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <Empty sentence="No ledger entries yet."><LinkPill to={`/w/${id}/explorer`} variant="outline">Open the explorer</LinkPill></Empty>
            )}
          </>
        ) : <Loading label="Ledger loading" />}
      </section>
    </Page>
  );
}
