import { useEffect, useState } from "preact/hooks";
import type { CataloguePlayer, HistoryView, LedgerKind, LedgerView, TransferRecord } from "../../shared/api.ts";
import { request } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { HistoryTable } from "../components/HistoryTable.tsx";
import { leagueStamp, millions, money } from "../format.ts";
import { useLive } from "../live.ts";

// History: gameweek rows with receipts, the transfers, the bank ledger and its reconciliation (brief: History).
const KIND: Record<LedgerKind, string> = { opening_budget: "Opening budget", purchase: "Purchase", sale: "Sale", reversal: "Reversal" };

export function HistoryPage() {
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [updates, announce] = useAnnouncer();

  const load = async () => {
    const [h, t, l] = await Promise.all([
      request<HistoryView>("GET", "/api/history"),
      request<{ transfers: TransferRecord[] }>("GET", "/api/history/transfers"),
      request<LedgerView>("GET", "/api/history/ledger"),
    ]);
    if (h.ok) setHistory(h.data);
    if (t.ok) setTransfers(t.data.transfers);
    if (l.ok) setLedger(l.data);
  };
  useEffect(() => {
    void load();
    void request<{ players: CataloguePlayer[] }>("GET", "/api/players").then((result) => {
      if (result.ok) setNames(new Map(result.data.players.map((player) => [player.id, player.name])));
    });
  }, []);
  useLive((message) => {
    if (message.t !== "league" && message.t !== "notice") void load();
  });
  const name = (id: string | null) => (id ? names.get(id) ?? id : "—");

  return (
    <main class="wide">
      <div class="page-head">
        <h1>History</h1>
        {history && <p class="mono">Season total {history.season_total}</p>}
      </div>
      <p class={`updates result-strip${updates.error ? " is-error" : ""}`} role="status" aria-label="History updates">
        {updates.text}
      </p>
      {!history || !ledger ? (
        <p class="loading board-loading">Loading history…</p>
      ) : (
        <>
      <HistoryTable rows={history.rows} playerName={name} snapshotUrl={(gameweek) => `/api/history/${gameweek}/snapshot`} announce={announce} />
      <h2>Transfers</h2>
      <div class="table-frame" tabIndex={0} role="region" aria-label="Transfers, scrollable">
        <table aria-label="Transfers">
          <thead>
            <tr>
              <th scope="col">Gameweek</th>
              <th scope="col">Out</th>
              <th scope="col" class="num">
                Sold for
              </th>
              <th scope="col">In</th>
              <th scope="col" class="num">
                Bought for
              </th>
              <th scope="col">Made</th>
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 && (
              <tr>
                <td colSpan={6}>No transfers yet.</td>
              </tr>
            )}
            {transfers.map((transfer) => (
              <tr key={transfer.id}>
                <td class="mono">
                  GW {transfer.gameweek}
                  {transfer.free_hit && <span class="hint"> Free Hit</span>}
                </td>
                <td>{transfer.out.name}</td>
                <td class="num">{money(transfer.out.sell_price_tenths)}</td>
                <td>{transfer.in.name}</td>
                <td class="num">{money(transfer.in.price_tenths)}</td>
                <td class="mono">{leagueStamp(transfer.made_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Bank ledger</h2>
      <div class="table-frame" tabIndex={0} role="region" aria-label="Bank ledger, scrollable">
        <table aria-label="Bank ledger">
          <thead>
            <tr>
              <th scope="col">Entry</th>
              <th scope="col">Player</th>
              <th scope="col">Gameweek</th>
              <th scope="col" class="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger?.entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {KIND[entry.kind]}
                  {entry.transfer_id !== null && <span class="hint mono"> T{entry.transfer_id}</span>}
                </td>
                <td>{name(entry.player_id)}</td>
                <td class="mono">GW {entry.gameweek}</td>
                <td class={`num${entry.amount_tenths < 0 ? " negative" : ""}`}>
                  {entry.amount_tenths > 0 ? "+" : ""}
                  {money(entry.amount_tenths)}
                </td>
              </tr>
            ))}
            {ledger && (
              <tr class="balance">
                <td>Balance</td>
                <td />
                <td />
                <td class="num">{money(ledger.bank_tenths)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p class="reconcile">
        Bank {millions(ledger.bank_tenths)}m · Squad selling value {millions(ledger.squad_selling_value_tenths)}m · Ledger balance{" "}
        {millions(ledger.bank_tenths)}m
      </p>
        </>
      )}
    </main>
  );
}
