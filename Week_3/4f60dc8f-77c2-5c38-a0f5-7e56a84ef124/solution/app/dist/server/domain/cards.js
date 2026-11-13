// The studio's test cards: validation and the approve/decline decision. Card details are never stored or sent on.
import { FIELD_COPY, FieldErrors } from "../errors.js";
const APPROVES = "4242424242424242";
const DECLINES = "4000000000000002";
/** Validates a Card body (422 with field copy) and says whether it approves. */
export function checkCard(card, now) {
    const errors = new FieldErrors();
    const value = card && typeof card === "object" ? card : {};
    const number = typeof value.number === "string" ? value.number.replace(/\s+/g, "") : "";
    if (number !== APPROVES && number !== DECLINES)
        errors.add("card.number", FIELD_COPY.card_number);
    const expiry = typeof value.expiry === "string" ? /^(\d{2})\/(\d{2})$/.exec(value.expiry.trim()) : null;
    const month = expiry ? Number(expiry[1]) : 0;
    const year = expiry ? 2000 + Number(expiry[2]) : 0;
    const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
    if (!expiry || month < 1 || month > 12 || year * 12 + (month - 1) < current)
        errors.add("card.expiry", FIELD_COPY.card_expiry);
    if (typeof value.cvc !== "string" || !/^\d{3}$/.test(value.cvc.trim()))
        errors.add("card.cvc", FIELD_COPY.card_cvc);
    if (typeof value.name !== "string" || value.name.trim().length < 1 || value.name.trim().length > 120)
        errors.add("card.name", FIELD_COPY.card_name);
    errors.throwIfAny();
    return { approves: number === APPROVES };
}
