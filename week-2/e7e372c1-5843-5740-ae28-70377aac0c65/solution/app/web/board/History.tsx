import { formatEth, formatPerThousand, formatShares } from "../../shared/decimal.ts";
import type { HistoryRow } from "../../shared/domain.ts";
import { isoWallDate } from "../../shared/newyork.ts";

function Eth({ value }: { value: string }) {
  const [amount = "", unit = ""] = formatEth(value).split(" ");
  return (
    <>
      {amount}
      <span className="unit">{unit}</span>
    </>
  );
}

function HistoryItem({ row }: { row: HistoryRow }) {
  const restated = row.restated;
  return (
    <tr className={row.state === "superseded" ? "history-row superseded" : "history-row"} id={`history-${row.restatement_id}`} tabIndex={-1} role="row">
      <td data-label="Week ending" role="cell">{row.week_ending}</td>
      <td className="num" data-label="Beginning balance" role="cell"><Eth value={row.beginning_balance} /></td>
      <td className="num" data-label="ETH acquired" role="cell"><Eth value={row.eth_acquired} /></td>
      <td className="num" data-label="Staking rewards" role="cell"><Eth value={row.staking_rewards} /></td>
      <td className="num" data-label="Ending balance" role="cell"><Eth value={row.ending_balance} /></td>
      <td className="num" data-label="Cumulative rewards" role="cell"><Eth value={row.cumulative_staking_rewards} /></td>
      <td className="num" data-label="Diluted shares" role="cell">{formatShares(row.diluted_shares)}</td>
      <td className="num" data-label="ETH per 1,000 diluted shares" role="cell">{formatPerThousand(row.eth_per_1000_diluted.value)}</td>
      <td data-label="Exhibit" role="cell">
        <a href={`/api/exhibits/${row.exhibit.sha256}`} download={`${row.exhibit.accession}.pdf`} aria-label={`Exhibit ${row.exhibit.accession}`}>
          {row.exhibit.accession}
        </a>
      </td>
      <td data-label="Status" role="cell">
        <span className="status-cell">
          {restated ? (
            <>
              <span className="badge">Restated</span>
              <span className="restated-line">Restated on {restated.on}: {restated.reason}</span>
              <a href={`#history-${restated.superseded_by}`}>View superseding entry</a>
            </>
          ) : (
            <span>Published {isoWallDate(row.published_at)}</span>
          )}
        </span>
      </td>
    </tr>
  );
}

const HEADINGS: ReadonlyArray<readonly [string, boolean]> = [
  ["Week ending", false],
  ["Beginning balance", true],
  ["ETH acquired", true],
  ["Staking rewards", true],
  ["Ending balance", true],
  ["Cumulative rewards", true],
  ["Diluted shares", true],
  ["ETH per 1,000 diluted shares", true],
  ["Exhibit", false],
  ["Status", false],
];

function GhostRow() {
  return (
    <tr className="history-row ghost" aria-hidden="true">
      {HEADINGS.map(([name, numeric]) => (
        <td key={name} className={numeric ? "num" : undefined}>
          {numeric ? "000,000.000" : "0000-00-00"}
          {numeric && <span className="unit"> ETH</span>}
        </td>
      ))}
    </tr>
  );
}

export function History({ rows }: { rows: HistoryRow[] | null }) {
  return (
    <section className="history" aria-label="Weekly history">
      <h2>Weekly history</h2>
      <div className="history-scroll">
        <table className="ledger" aria-label="Weekly holdings restatements" role="table">
          <thead role="rowgroup">
            <tr role="row">
              {HEADINGS.map(([name, numeric]) => (
                <th key={name} scope="col" role="columnheader" className={numeric ? "num" : undefined}>{name}</th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows ? rows.map((row) => <HistoryItem key={row.restatement_id} row={row} />) : [0, 1, 2].map((index) => <GhostRow key={index} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
