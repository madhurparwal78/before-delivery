import { useState, type ReactNode } from "react";
import { rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import type { SavedLine } from "../../lib/types";
import { fieldMessage, useBusy, useCartActions } from "./actions";

function SavedRow({ line }: { line: SavedLine }): ReactNode {
  const actions = useCartActions();
  const [busy, run] = useBusy();
  const [error, setError] = useState<string | null>(null);

  const move = (): void => {
    setError(null);
    void run(async () => {
      try {
        await actions.moveToCart(line.line_id);
      } catch (failure) {
        setError(fieldMessage(failure));
      }
    });
  };

  return (
    <li className="card card--black saved__row">
      <img src={line.image_url} alt={line.title} width={72} height={72} />
      <div className="saved__text">
        <p className="saved__title">{line.title}</p>
        <p className="bill">
          <span className="amount">{rupees(line.unit_price_paise)}</span>
        </p>
        {!line.in_stock && <p className="saved__stock">Sold out.</p>}
        {error && <p className="field-error">{error}</p>}
      </div>
      <Button small busy={busy} aria-label={`Move ${line.title} to cart`} onClick={move}>
        move to cart
      </Button>
    </li>
  );
}

export function SavedForLater({ lines }: { lines: SavedLine[] }): ReactNode {
  return (
    <section aria-label="Saved for later" className="panel panel--raised saved">
      <h2>saved for later</h2>
      <ul className="saved__list">
        {lines.map((line) => (
          <SavedRow key={line.line_id} line={line} />
        ))}
      </ul>
    </section>
  );
}
