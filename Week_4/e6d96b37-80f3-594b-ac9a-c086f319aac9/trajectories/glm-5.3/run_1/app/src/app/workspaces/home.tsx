import { useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { awaitingReceiptCount, openOfferCount } from "../desk.js";

export function DeskHome({ namespace }: { namespace: string }): React.ReactElement {
  const desk = useDesk();
  const state = desk.state;
  const openOffers = state ? openOfferCount(state.offers) : 0;
  const awaiting = state ? awaitingReceiptCount(state.offers) : 0;
  const specimens = state
    ? Object.values(state.specimens).filter((s) => s.owner === "dealer" && s.status !== "transferred" && s.status !== "missing").length
    : 0;
  const filledCells = state ? Object.values(state.tray).filter((c) => c.specimen !== "").length : 0;

  const latest = state
    ? Object.entries(state.specimens)
        .filter(([, s]) => s.owner === "dealer")
        .sort((a, b) => a[0].localeCompare(b[0]))
        .at(-1)
    : undefined;

  return (
    <div>
      <div aria-label="day's lead line" style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 700, margin: 0 }}>Halloway Numismatics intake desk.</p>
        <p style={{ fontWeight: 700, margin: 0 }}>Every specimen photographed, attributed, shelved and traded in one place.</p>
      </div>
      <div className="tray-directory" aria-label="Tray directory" style={{ maxWidth: "50%", margin: "0 auto 16px" }}>
        <a className="specimen-chip" href={`/desk/${namespace}/tray-placement`} style={{ textDecoration: "none", marginBottom: 8 }}>
          <span className="coin-disc">F</span>
          <span>
            <span className="chip-label">Stock</span>
            <span className="chip-sub">{specimens} specimens</span>
            <span className="chip-sub">{filledCells} of 4 cells filled</span>
          </span>
        </a>
        <a className="specimen-chip" href={`/desk/${namespace}/offers`} style={{ textDecoration: "none" }}>
          <span className="coin-disc">E</span>
          <span>
            <span className="chip-label">Exchange</span>
            <span className="chip-sub">{openOffers} open offers</span>
            <span className="chip-sub">{awaiting} awaiting receipt</span>
          </span>
        </a>
        <p className="inline-note">{feedback("F_STATUS_LINE", { n: 0, m: 0 })}</p>
      </div>
      <div className="fact-pair">
        <div className="fact-box" aria-label="Obverse facts">
          <h3>Latest specimen</h3>
          <p>{latest ? latest[1].display_label : "No specimen yet."}</p>
        </div>
        <div className="fact-box" aria-label="Reverse facts">
          <h3>Catalogue record</h3>
          <p>{latest ? (latest[1].attribution.register === "stored" ? "Record stored." : "Catalogue record still pending.") : "—"}</p>
        </div>
      </div>
    </div>
  );
}
