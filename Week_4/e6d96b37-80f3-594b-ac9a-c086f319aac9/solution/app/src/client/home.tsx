// Desk home: the day's lead line, the tray directory with its lockup tiles and the pending
// catalogue note, then the intake and pending fact boxes for today's latest specimen.

import { deskCounts } from "../shared/counts";
import { exchangeLines, stockLines } from "../shared/feedback";
import { useDesk } from "./desk";
import { EmptyFacts, label } from "./parts";
import { follow } from "./route";

export function Home() {
  const { ns, state, clock, session } = useDesk();
  if (!state || !session) return null;
  const counts = deskCounts(state, clock);
  const dealer = session.role === "dealer";
  const today = clock?.slice(0, 10);
  const latest = [...state.events].reverse().find((e) => e.type === "specimen.created" && e.at.slice(0, 10) === today);
  // The state lists specimens in creation order, so today's latest intake is the last dealer specimen.
  const latestKey = latest ? Object.keys(state.specimens).filter((k) => state.specimens[k]!.owner === "dealer").at(-1) : undefined;
  const specimen = latestKey ? state.specimens[latestKey] : undefined;
  const [stockOne, stockTwo] = stockLines(counts.stock, counts.cellsFilled);
  const [exchangeOne, exchangeTwo] = exchangeLines(counts.openOffers, counts.awaitingReceipt);
  return (
    <div className="home">
      <p className="lead">
        <strong>{dealer ? "Halloway Numismatics: the working desk for every specimen you hold." : "Your exchange desk with Halloway Numismatics."}</strong>
        <strong>{dealer ? "Take coins in, attribute and shelve them, then settle swaps without a coin in two offers." : "Review offers, confirm receipts against frozen evidence and raise disputes."}</strong>
      </p>
      <section className="directory" aria-label="Tray directory">
        <h2 className="directory-heading">Open a desk:</h2>
        <div className="lockups">
          {dealer && (
            <a className="lockup" href={`/desk/${ns}/intake`} aria-describedby="lockup-stock" onClick={follow}>
              <span className="sr-only">Open stock</span>
              <span className="lockup-face" aria-hidden="true">
                <span className="lockup-name">Stock</span>
                <span className="lockup-label figures">
                  <span>{stockOne}</span>
                  <span>{stockTwo}</span>
                </span>
              </span>
              <span id="lockup-stock" className="lockup-text" aria-hidden="true">Intake, attribution, trays, album, condition, keepers and audits.</span>
            </a>
          )}
          <a className="lockup" href={`/desk/${ns}/offers`} aria-describedby="lockup-exchanges" onClick={follow}>
              <span className="sr-only">Open exchanges</span>
            <span className="lockup-face" aria-hidden="true">
              <span className="lockup-name">Exchange</span>
              <span className="lockup-label figures">
                <span>{exchangeOne}</span>
                <span>{exchangeTwo}</span>
              </span>
            </span>
            <span id="lockup-exchanges" className="lockup-text" aria-hidden="true">Reciprocal offers, dispatch evidence, receipts and disputes.</span>
          </a>
        </div>
        {dealer && (
          <div className="note catalogue-note">
            <a className="action-link" href={`/desk/${ns}/reconciliation`} onClick={follow}>
              Catalog reconciliation
            </a>
            <p className="figures">
              {counts.pendingRecords === 0
                ? "Every specimen's register record is stored."
                : `${counts.pendingRecords} specimens are waiting for their register record.`}
            </p>
          </div>
        )}
      </section>
      <div className="fact-pair home-facts">
        <section className="fact-box" aria-label="Obverse facts">
          {specimen && latestKey ? (
            <>
              <h2>Today's intake:</h2>
              <ul>
                <li>{`${label(latestKey)} was taken in at ${latest!.at.slice(11, 16)} UTC.`}</li>
                <li>{`${specimen.photos.filter((p) => p.label === "obverse" || p.label === "reverse").length} face photographs stored.`}</li>
                <li>{`Holder: ${specimen.holder.kind} ${specimen.holder.width_mm} × ${specimen.holder.height_mm} mm.`}</li>
              </ul>
            </>
          ) : (
            <EmptyFacts heading="Today's intake:" steps={["Nothing has been taken in today.", "Open Intake to photograph both faces of the next coin."]} />
          )}
        </section>
        <section className="fact-box" aria-label="Reverse facts">
          {specimen && latestKey ? (
            <>
              <h2>Catalog record:</h2>
              <ul>
                <li>{specimen.attribution.register === "pending" ? `${label(latestKey)} is waiting for its catalog record.` : `Register record ${specimen.attribution.reference} is stored.`}</li>
                <li>{specimen.attribution.register === "pending" ? "Type its catalog reference at Catalog reconciliation." : `Mintmark ${specimen.attribution.mintmark}.`}</li>
              </ul>
            </>
          ) : (
            <EmptyFacts heading="Catalog record:" steps={["No catalog record is waiting on today's intake.", "Reconcile a specimen once you know its catalog reference."]} />
          )}
        </section>
      </div>
    </div>
  );
}
