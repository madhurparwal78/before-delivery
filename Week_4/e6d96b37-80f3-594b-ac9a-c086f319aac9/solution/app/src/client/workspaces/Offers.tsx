// Offer assembly: the dealer fills their basket and the counterpart's basket, verifies with a
// one-time code and sends through "Send reciprocal offer". Both baskets stay visibly separate.

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { windowText } from "../../shared/counts";
import { F } from "../../shared/feedback";
import type { Party, Specimen } from "../../shared/types";
import { jsonCommand } from "../commands";
import { type CommandRequest, useDesk } from "../desk";
import { useMoves } from "../moves";
import { CoinDisc, EmptyFacts, FactBoxes, label, useSelectedOffer, Workspace } from "../parts";
import { Review } from "../Review";
import { CoinImage } from "../viewers";

const STATUS_WORDS: Partial<Record<Specimen["status"], string>> = {
  quarantined: "Quarantined",
  reserved: "Reserved",
  outbound: "Outbound",
  pending_catalogue: "Catalog pending",
};

type Baskets = Record<Party, string[]>;

export function Offers() {
  const { state, session, send, stepUp } = useDesk();
  const [offerKey, offer] = useSelectedOffer(["draft"], true);
  const [baskets, setBaskets] = useState<Baskets>({ dealer: [], counterpart: [] });
  const [reviewing, setReviewing] = useState(false);
  const [needsStepUp, setNeedsStepUp] = useState<CommandRequest | null>(null);
  const moves = useMoves((source, destination) => {
    const owner = state?.specimens[source]?.owner;
    const [kind, side] = destination.split(":") as ["basket" | "pool", Party];
    if (owner !== side) return;
    setBaskets((b) => {
      const without = b[side].filter((k) => k !== source);
      return { ...b, [side]: kind === "basket" ? [...without, source] : without };
    });
  });
  if (!state || !session) return null;
  const dealerView = session.role === "dealer";
  const assembling = dealerView && offer?.status === "draft";

  if (!offerKey || !offer) {
    return (
      <Workspace name="Offer assembly workspace" heading="Offers" list="exchange" className="ws-offers">
        <EmptyFacts heading="Offers:" steps={["There is no offer on this desk yet.", "Offers appear here once the dealer sends one."]} />
      </Workspace>
    );
  }

  const shown: Baskets = assembling ? baskets : { dealer: offer.dealer_items, counterpart: offer.counterpart_items };
  const pool = (side: Party) =>
    Object.entries(state.specimens).filter(([key, s]) => s.owner === side && s.status !== "transferred" && !s.missing && !shown[side].includes(key));

  const chip = (key: string) => {
    const s = state.specimens[key]!;
    return (
      <button type="button" className="chip" {...moves.source(key)}>
        <CoinDisc mintmark={s.attribution.mintmark} />
        <span className="chip-label">{label(key)}</span>
        {STATUS_WORDS[s.status] && <span className="chip-status" aria-hidden="true">{STATUS_WORDS[s.status]}</span>}
      </button>
    );
  };

  const basket = (side: Party) => {
    const title = side === "dealer" ? "Dealer basket" : "Counterpart basket";
    const items = shown[side];
    return (
      <section className={`basket basket-${side}`} aria-label={title} tabIndex={assembling ? 0 : undefined} {...(assembling ? moves.destination(`basket:${side}`) : {})}>
        <h2 className="basket-heading">
          {title}
          <span className="basket-sub">{side === "dealer" ? "Halloway Numismatics gives" : "Marsh & Tallow Coins gives"}</span>
        </h2>
        {items.length === 0 ? (
          <p className="basket-empty">{assembling ? "Move specimens here." : "Nothing in this basket."}</p>
        ) : (
          <ul className="basket-items">
            {items.map((key) => {
              const photo = state.specimens[key]?.photos.filter((p) => p.label === "obverse").at(-1);
              return (
                <li key={key} className="basket-item">
                  {assembling ? chip(key) : (
                    <figure className="slot-figure">
                      <span className="slot-photo-frame">{photo && <CoinImage photo={photo} alt={`${label(key)} obverse`} displayWidth={120} />}</span>
                      <figcaption>{label(key)}</figcaption>
                    </figure>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

  const candidates = (side: Party) => (
    <section className="candidates" aria-label={side === "dealer" ? "Dealer candidates" : "Counterpart candidates"} {...moves.destination(`pool:${side}`)}>
      <h2 className="box-heading">{side === "dealer" ? "Your duplicates:" : "Counterpart specimens:"}</h2>
      <ul className="chips">
        {pool(side).map(([key]) => (
          <li key={key}>{chip(key)}</li>
        ))}
      </ul>
    </section>
  );

  const request = () => jsonCommand("send", "POST", `/offers/${offerKey}/send`, { expected_version: offer.version, dealer_items: baskets.dealer, counterpart_items: baskets.counterpart });

  const confirm = async () => {
    const pending = needsStepUp ?? request();
    const outcome = await send(pending);
    if (outcome.ok) {
      setBaskets({ dealer: [], counterpart: [] });
      setNeedsStepUp(null);
      return "close" as const;
    }
    if (outcome.ok === false && outcome.stepUp) {
      setNeedsStepUp(pending);
      return "stay" as const;
    }
    return "close" as const;
  };

  return (
    <Workspace
      name="Offer assembly workspace"
      heading={`Offers · ${offerKey}`}
      list="exchange"
      className="ws-offers"
      facts={shown.dealer[0] && <FactBoxes specimenKey={shown.dealer[0]} specimen={state.specimens[shown.dealer[0]]} />}
    >
      <p className="area-status offer-state figures">
        <strong>Status:</strong> {offer.status}
        {windowText(offer) ? ` · ${windowText(offer)}` : ""}
      </p>
      {assembling && <div className="area-dealer-pool">{candidates("dealer")}</div>}
      <div className="area-dealer-basket">{basket("dealer")}</div>
      {assembling && <div className="area-counterpart-pool">{candidates("counterpart")}</div>}
      <div className="area-counterpart-basket">{basket("counterpart")}</div>
      {assembling && (
        <div className="area-review actions">
          <button type="button" className="button primary" onClick={() => setReviewing(true)}>
            Review offer
          </button>
        </div>
      )}
      {reviewing && (
        <Review
          label="Send reciprocal offer"
          onClose={() => {
            setReviewing(false);
            setNeedsStepUp(null);
          }}
          onConfirm={confirm}
          summary={
            <div className="review-baskets">
              <section className="review-basket">
                <h3>Dealer basket</h3>
                <p>{baskets.dealer.length ? `${baskets.dealer.map(label).join(", ")}.` : F.BASKET_EMPTY}</p>
              </section>
              <section className="review-basket">
                <h3>Counterpart basket</h3>
                <p>{baskets.counterpart.length ? `${baskets.counterpart.map(label).join(", ")}.` : F.BASKET_EMPTY}</p>
              </section>
              <p>Sending reserves every specimen in both baskets together.</p>
            </div>
          }
        >
          {needsStepUp && (
            <div className="note step-up-note">
              <button type="button" className="action-link" onClick={() => stepUp(needsStepUp)}>
                <ShieldCheck aria-hidden="true" size={16} /> Verify identity
              </button>
              <p>{F.MFA_REQUIRED}</p>
            </div>
          )}
        </Review>
      )}
    </Workspace>
  );
}
