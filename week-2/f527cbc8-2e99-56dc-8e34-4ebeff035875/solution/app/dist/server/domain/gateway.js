// The in-app card gateway: the three published test card tokens decide approval and decline by token alone, and a
// real-looking card number is refused before it can reach a log or a row (brief: Business rules, Test cards).
import { FIELD_COPY } from "../errors.js";
const TEST_CARDS = {
    tok_approve_4242: { last4: "4242", decline: null },
    tok_decline_0002: { last4: "0002", decline: { code: "do_not_honor", hard: true } },
    tok_funds_9995: { last4: "9995", decline: { code: "insufficient_funds", hard: false } },
};
/** The field error for a submitted `card_token`, or null when it is one of the test cards. */
export function cardTokenError(value) {
    if (value === undefined || value === null || value === "")
        return FIELD_COPY.required;
    if (typeof value !== "string")
        return FIELD_COPY.unknownCard;
    if (/\d{12,}/.test(value))
        return FIELD_COPY.cardNumber;
    return value in TEST_CARDS ? null : FIELD_COPY.unknownCard;
}
export const cardLast4 = (token) => TEST_CARDS[token]?.last4 ?? "";
/** Authorises a charge on a test card token that already passed cardTokenError. */
export function authorise(token) {
    const card = TEST_CARDS[token];
    if (!card)
        throw new Error("authorise needs a validated test card token");
    return card.decline
        ? { approved: false, last4: card.last4, declineCode: card.decline.code, hard: card.decline.hard }
        : { approved: true, last4: card.last4 };
}
