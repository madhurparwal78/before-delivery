import { Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiFailure, idempotencyKey } from "../api.js";
import { Delayed, Live, type Message } from "../app.js";
import { PACK_PRODUCT } from "../../shared/pricing.js";
import { hours, money } from "../format.js";
import type { Pack } from "../types.js";

const MOVEMENT_WORDS: Record<string, string> = { purchase: "Purchase", reserve: "Reserve", release: "Release", use: "Use", forfeit: "Forfeit" };

export function PackPage() {
  const [pack, setPack] = useState<Pack | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setPack(await api<Pack>("GET", "/api/me/pack")), []);
  useEffect(() => { void load(); }, [load]);

  const buy = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage({ text: "Buying pack…", tone: "pending" });
    try {
      const result = await api<{ available_minutes: number }>("POST", "/api/packs", { product: "20h" }, idempotencyKey());
      setMessage({ text: `20 hours added. ${hours(result.available_minutes)} h available.`, tone: "success" });
    } catch (error) {
      setMessage({ text: error instanceof ApiFailure && error.code === "billing_unavailable" ? "Card payments are delayed while billing is unreachable. Nothing was charged." : error instanceof ApiFailure ? error.detail : "Buying failed. Try again.", tone: "error" });
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <main className="page pack-page">
      <header className="page-head">
        <h1>Hour pack</h1>
        <p className="lede">Prepaid station hours, usable on any station of your kitchen. Pack hours cover a booking before any card charge.</p>
      </header>
      <section className="pack slip" aria-label="Hour pack">
        <div className="pack-figures">
          <p><span className="pack-number mono">{pack ? hours(pack.available_minutes) : "—"}</span> h available</p>
          <p><span className="pack-number mono">{pack ? hours(pack.reserved_minutes) : "—"}</span> h reserved</p>
          <p><span className="pack-number mono">{pack ? hours(pack.used_minutes) : "—"}</span> h used</p>
        </div>
        <button type="button" className="button button-primary" aria-label="Buy 20-hour pack" aria-describedby="pack-price" aria-busy={busy} onClick={() => void buy()}>
          <Package aria-hidden="true" size={18} /><span>Buy 20-hour pack</span><span aria-hidden="true" id="pack-price"> · <span className="mono">{money(PACK_PRODUCT.priceCents)}</span></span><Delayed />
        </button>
        <Live label="Pack status" message={message} />
      </section>
      <div className="table-frame" role="region" aria-label="Pack ledger entries" tabIndex={0}>
        <table aria-label="Pack ledger">
          <thead><tr><th scope="col">When</th><th scope="col">Movement</th><th scope="col">Account</th><th scope="col">Hours</th><th scope="col">Booking</th></tr></thead>
          <tbody>
            {!pack ? <tr><td colSpan={5} className="loading-row">Loading…</td></tr> : pack.entries.length === 0
              ? <tr><td colSpan={5} className="empty-row">No pack movements yet. Buy a pack to add hours.</td></tr>
              : pack.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.created_at.slice(0, 16).replace("T", " ")} UTC</td>
                  <td>{MOVEMENT_WORDS[entry.reason] ?? entry.reason}</td>
                  <td>{entry.account}</td>
                  <td className="mono num">{entry.minutes < 0 ? "−" : "+"}{hours(Math.abs(entry.minutes))}</td>
                  <td className="mono">{entry.booking_id ?? "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
