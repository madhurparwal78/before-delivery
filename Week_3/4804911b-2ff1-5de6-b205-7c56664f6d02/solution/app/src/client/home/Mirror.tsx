import type { Ref } from "preact";
import { COPY, formatDate, rupees } from "../../shared/copy";
import type { PackFacts } from "../../shared/types";
import { followLink } from "../lib/router";

const tenths = (mg: number): string => {
  const t = Math.floor((mg + 50) / 100);
  return `${Math.floor(t / 10)}.${t % 10} g`;
};

export function Mirror({ mirrorRef, facts }: { mirrorRef: Ref<HTMLElement>; facts: PackFacts | null }) {
  return (
    <section class="mirror" aria-label="Pack facts" ref={mirrorRef} data-mirror-swap="1">
      {facts && (
        <>
          {facts.dateNote && <p class="date-note">{facts.dateNote}</p>}
          <dl>
            <div class="pair"><dt>Batch</dt>
            <dd>
              <span class="fact">{facts.batchCode}</span>
              <em>The code printed near the best-before date, read off the carton.</em>
            </dd></div>
            <div class="pair"><dt>Printed MRP</dt>
            <dd>
              <span class="fact">Rs {rupees(facts.printedMrpPaise)}</span>
              <em>What the wrapper itself says, as it left the plant.</em>
            </dd></div>
            <div class="pair"><dt>Revised MRP</dt>
            <dd>
              <span class="fact">{facts.revisedMrpPaise === null ? (facts.stickerNote ?? COPY.noSticker) : `Rs ${rupees(facts.revisedMrpPaise)}`}</span>
              <em>A sticker goes beside the printed price and never over it.</em>
            </dd></div>
            <div class="pair"><dt>Unit sale price</dt>
            <dd>
              <span class="fact">{facts.unitSalePrice ? `Rs ${facts.unitSalePrice.rupees} per ${facts.unitSalePrice.per}` : "Same as the pack price"}</span>
              <em>Worked out from the retail price, rounded to the nearest paisa.</em>
            </dd></div>
            <div class="pair"><dt>Packed</dt>
            <dd>
              <span class="fact">{formatDate(facts.packedDate)}</span>
              <em>The day this pack was filled, by the house calendar.</em>
            </dd></div>
            <div class="pair"><dt>Best before</dt>
            <dd>
              <span class="fact">{formatDate(facts.bestBeforeDate)}</span>
              <em>The last good day, counted from the day it was packed.</em>
            </dd></div>
            <div class="pair"><dt>Sugar per pack</dt>
            <dd>
              <span class="fact">{tenths(facts.sugarMgPerPack)}</span>
              <em>Counted for the whole pack, not for a mouthful.</em>
            </dd></div>
            <div class="pair"><dt>Wrapper</dt>
            <dd>
              <span class="fact">{facts.wrapperNotice ? `Old wrapper under ${facts.wrapperNotice.number} v${facts.wrapperNotice.version}` : "Current print"}</span>
              <em>Either the print of the day or an old one the house has allowed.</em>
              {facts.wrapperNotice && (
                <a class="text-link" href={`/notices/${facts.wrapperNotice.number}`} onClick={(e) => followLink(e, `/notices/${facts.wrapperNotice!.number}`)}>
                  Read notice {facts.wrapperNotice.number}
                </a>
              )}
            </dd></div>
          </dl>
        </>
      )}
    </section>
  );
}
