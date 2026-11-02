import { validation } from "../http.js";
function luhn(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        let d = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) {
            d *= 2;
            if (d > 9)
                d -= 9;
        }
        sum += d;
    }
    return sum % 10 === 0;
}
function brandOf(digits) {
    if (digits.startsWith("4"))
        return "Visa";
    if (/^(5[1-5]|2[2-7])/.test(digits))
        return "Mastercard";
    if (/^3[47]/.test(digits))
        return "American Express";
    if (/^6(011|5)/.test(digits))
        return "Discover";
    return "Card";
}
function behaviourOf(digits) {
    if (digits === "4000000000000002")
        return "decline";
    if (digits === "4000000000000341")
        return "first_only";
    return "approve";
}
/** Whether a charge goes through: `entering` is true for a charge in the request that entered the card. */
export function approves(behaviour, entering) {
    return behaviour === "approve" || (behaviour === "first_only" && entering);
}
/** The current month in America/Toronto as [year, month]. */
function torontoMonth(now) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit" }).formatToParts(now);
    return [Number(parts.find((p) => p.type === "year")?.value), Number(parts.find((p) => p.type === "month")?.value)];
}
/** Validates a card object; `prefix` names the fields (`card.` inside checkout). */
export function parseCard(value, prefix, now = new Date()) {
    const errors = {};
    const body = (value !== null && typeof value === "object" && !Array.isArray(value) ? value : {});
    const number = typeof body.number === "string" ? body.number.replace(/ /g, "") : "";
    if (!/^\d{13,19}$/.test(number) || !luhn(number))
        errors[`${prefix}number`] = "Enter a valid card number.";
    const month = body.expiry_month;
    const year = body.expiry_year;
    const [nowYear, nowMonth] = torontoMonth(now);
    if (typeof month !== "number" ||
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12 ||
        typeof year !== "number" ||
        !Number.isInteger(year) ||
        year < 1000 ||
        year > 9999 ||
        year * 12 + month < nowYear * 12 + nowMonth) {
        errors[`${prefix}expiry`] = "Enter a future expiry date as MM/YY.";
    }
    if (typeof body.cvc !== "string" || !/^\d{3}$/.test(body.cvc))
        errors[`${prefix}cvc`] = "Enter the 3-digit security code.";
    if (Object.keys(errors).length > 0)
        return { errors };
    return {
        errors,
        card: {
            expiryMonth: month,
            expiryYear: year,
            brand: brandOf(number),
            last4: number.slice(-4),
            behaviour: behaviourOf(number),
        },
    };
}
export function requireCard(value) {
    const { card, errors } = parseCard(value, "");
    if (!card)
        throw validation(errors);
    return card;
}
