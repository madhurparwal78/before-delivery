import { useEffect, useState } from "react";
import { ERRORS } from "../../../shared/copy.js";
import { plateOf, type PublicBoxState } from "../../../shared/domain.js";
import { formatDkk } from "../../../shared/money.js";
import { get } from "../api.js";
import { edition } from "../state/market.js";
import { useStore } from "../state/store.js";
import { BOX_HINT, BOX_WORDS, LABELS } from "./copy.js";
import { PlateArt } from "./PlateArt.js";
import { PublicSheet } from "./PublicSheet.js";

interface BoxBody {
  state: PublicBoxState;
  artUrl: string | null;
}

/** One box: its number, plate and art, the words for its state, and what it costs. */
export const BoxSheet = ({ number }: { number: number }) => {
  const plate = plateOf(number);
  const price = useStore(edition);
  const [box, setBox] = useState<BoxBody | "missing" | null>(null);

  useEffect(() => {
    let current = true;
    setBox(null);
    get<BoxBody>(`/api/boxes/${number}`).then(
      (reply) => current && setBox(reply.body),
      () => current && setBox("missing"),
    );
    return () => {
      current = false;
    };
  }, [number]);

  return (
    <PublicSheet closeLabel={LABELS.sheet.toShelf}>
      <h1>Box {number}</h1>
      <p className="sheet__plate">{plate}</p>
      <div className="box">
        {box !== null && box !== "missing" && box.artUrl !== null ? (
          <img className="art" src={box.artUrl} width="240" height="240" alt={`Plate art for ${plate}`} />
        ) : (
          <PlateArt plate={plate} />
        )}
        <div>
          <dl className="facts">
            <dt>State</dt>
            <dd>{box === "missing" ? ERRORS.not_found.message() : box ? BOX_WORDS[box.state] : ""}</dd>
            <dt>Price</dt>
            <dd>{price ? formatDkk(price.priceOre) : ""}</dd>
            <dt>Charity share</dt>
            <dd>{price ? formatDkk(price.charityOre) : ""}</dd>
          </dl>
          {box !== null && box !== "missing" && box.state === "available" ? <p className="muted">{BOX_HINT}</p> : null}
        </div>
      </div>
    </PublicSheet>
  );
};
