import { carriageLine, coverEndLine, editionLine, ownerText, paidLine, partAmountLine, refundedLine, revisionHeading, totalLine } from "../shared/copy";
import type { DeclineView, Lang, RulingView, ShareQuote } from "../shared/types";

/** The ruling with its edition and the `edition` source caption beneath it. */
export function RulingFigure({ ruling, lang }: { ruling: Pick<RulingView, "inside" | "edition" | "cover_ends_at"> | null; lang: Lang }) {
  if (!ruling) {
    return (
      <div class="figure">
        <p class="line">{ownerText("notYetRuled", lang)}</p>
      </div>
    );
  }
  return (
    <div class="figure">
      <p class="line">{ownerText(ruling.inside ? "inside" : "outside", lang)}</p>
      <p class="line">{coverEndLine(ruling.cover_ends_at, lang)}</p>
      <p class="line">{editionLine(ruling.edition, lang)}</p>
      <p class="caption">{ownerText("captionEdition", lang)}</p>
    </div>
  );
}

/** The current quote revision: part, carriage (band from the carrier, amount from billing) and total. */
export function QuoteFigures({ quote, lang }: { quote: Pick<ShareQuote, "revision" | "part_line_minor" | "carriage_minor" | "total_minor" | "band">; lang: Lang }) {
  const billing = ownerText("captionBilling", lang);
  return (
    <>
      <h3>{revisionHeading(quote.revision, lang)}</h3>
      <div class="figure">
        <p class="line">{partAmountLine(quote.part_line_minor, lang)}</p>
        <p class="caption">{billing}</p>
      </div>
      <div class="figure">
        <p class="line">{carriageLine(quote.band, quote.carriage_minor, lang)}</p>
        <p class="caption caption-pair">
          <span>{ownerText("captionCarrier", lang)}</span>
          <span>{billing}</span>
        </p>
      </div>
      <div class="figure">
        <p class="line">{totalLine(quote.total_minor, lang)}</p>
        <p class="caption">{billing}</p>
      </div>
    </>
  );
}

/** What billing says was paid, refunded or not charged. */
export function SettlementFigures({ paidMinor, decline, lang }: { paidMinor: number | null; decline: Pick<DeclineView, "refunded_minor"> | null; lang: Lang }) {
  const billing = ownerText("captionBilling", lang);
  return (
    <>
      {paidMinor !== null ? (
        <div class="figure">
          <p class="line">{paidLine(paidMinor, lang)}</p>
          <p class="caption">{billing}</p>
        </div>
      ) : null}
      {decline ? (
        <div class="figure">
          {decline.refunded_minor > 0 ? (
            <>
              <p class="line">{refundedLine(decline.refunded_minor, lang)}</p>
              <p class="caption">{billing}</p>
            </>
          ) : (
            <p class="line">{ownerText("nothingCharged", lang)}</p>
          )}
        </div>
      ) : null}
    </>
  );
}
